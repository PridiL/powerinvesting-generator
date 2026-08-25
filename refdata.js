/* Parsing the two Yuanta reference files in the browser.
 *
 * Mirrors power_investing/refdata.py. Doing this client-side keeps the site
 * static and means an uploaded file never leaves the machine it was opened on.
 */

/* ---------- Block trade: the SSF-Calculation .xls ---------- */

const BT_SHEET = 'Margin and Min con';

function parseBlockTradeWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[BT_SHEET];
  if (!ws) {
    throw new Error(`no "${BT_SHEET}" sheet - found: ${wb.SheetNames.join(', ')}`);
  }

  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  if (grid.length < 3) throw new Error('sheet looks empty');

  // Row 0 groups the columns (Multiplier x4, IM x4); row 1 carries the series
  // codes. Read them rather than assuming, so a reissued workbook still works.
  const group = (grid[0] || []).map(v => String(v).trim());
  const header = (grid[1] || []).map(v => String(v).trim());

  const multCols = {}, imCols = {};
  let minCol = null;
  header.forEach((h, c) => {
    const code = h.toUpperCase();
    const g = (group[c] || '').toLowerCase();
    if (g.startsWith('multiplier') && code) multCols[code] = c;
    else if ((group[c] || '').trim().toUpperCase() === 'IM' && code) imCols[code] = c;
    else if (h.toLowerCase().startsWith('minimum contract')) minCol = c;
  });

  const series = Object.keys(multCols).filter(s => s in imCols);
  if (!series.length) throw new Error('could not find the Multiplier / IM series columns');
  if (minCol === null) throw new Error('could not find the "Minimum Contracts" column');

  const rows = {};
  for (const r of grid.slice(2)) {
    const sym = String(r[0] ?? '').trim().toUpperCase();
    if (!sym) continue;
    const minContracts = num(r[minCol]);
    const entry = {};
    for (const code of series) {
      const mult = num(r[multCols[code]]);
      const im = num(r[imCols[code]]);
      if (mult && im && minContracts) {
        entry[code] = {
          series: code,
          ssf_symbol: sym + code,
          multiplier: mult,
          im_per_contract: im,
          min_contracts: Math.round(minContracts),
          im_per_block: im * minContracts,
        };
      }
    }
    if (Object.keys(entry).length) rows[sym] = entry;
  }

  if (!Object.keys(rows).length) throw new Error('no stock rows found');
  return { series, block_trade: rows };
}

/* ---------- Margin loan: the marginable announcement PDF ---------- */

const IM_SECTION =
  /IM\s*=\s*(\d+)\s*%\s*\(\s*Call\s*=\s*(\d+)\s*%\s*Force\s*=\s*(\d+)\s*%\s*\)/g;

// The single-file build has no separate worker file to point at, so it injects
// the worker source and we hand pdf.js a blob URL instead.
let workerReady = false;
function ensureWorker() {
  if (workerReady) return;
  if (window.PDFJS_WORKER_CODE) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
      new Blob([window.PDFJS_WORKER_CODE], { type: 'text/javascript' }));
  } else if (window.PDFJS_WORKER_SRC) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = window.PDFJS_WORKER_SRC;
  }
  workerReady = true;
}

async function pdfText(arrayBuffer) {
  ensureWorker();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    // Rebuild lines by the y of each text item, then order across by x.
    const lines = new Map();
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push({ x: item.transform[4], s: item.str });
    }
    for (const y of [...lines.keys()].sort((a, b) => b - a)) {
      text += lines.get(y).sort((a, b) => a.x - b.x).map(p => p.s).join('') + '\n';
    }
  }
  return text;
}

async function parseMarginablePdf(arrayBuffer) {
  const text = await pdfText(arrayBuffer);
  IM_SECTION.lastIndex = 0;
  const hits = [...text.matchAll(IM_SECTION)];
  if (!hits.length) {
    throw new Error('no "IM = n% (Call = n% Force = n%)" sections found - is this the marginable announcement?');
  }

  const margin = {};
  let listed = 0;

  hits.forEach((m, i) => {
    const im = +m[1], call = +m[2], force = +m[3];
    let body = text.slice(m.index + m[0].length,
                          i + 1 < hits.length ? hits[i + 1].index : text.length);
    const cut = body.search(/(รวม|หมายเหตุ|\*\s?ไม่อนุญาต)/);
    if (cut >= 0) body = body.slice(0, cut);

    // Entries read "<index> <SYMBOL>"; the index is its own token here.
    const toks = body.split(/\s+/).filter(Boolean);
    for (let k = 0; k < toks.length; k++) {
      if (/^\d+$/.test(toks[k]) && k + 1 < toks.length) {
        const sym = toks[k + 1].replace(/\*+$/, '').toUpperCase();
        k++;
        if (!/^[A-Z0-9][A-Z0-9&.\-]*$/.test(sym)) continue;
        listed++;
        // First listing wins, as in the Python parser.
        if (!(sym in margin)) {
          margin[sym] = { im_percent: im, gearing: 100 / im, call, force };
        }
      }
    }
  });

  if (!Object.keys(margin).length) throw new Error('sections found but no symbols in them');

  // The document states its own total; surface it so the UI can show a match.
  const stated = text.match(/รวม\s*(\d+)\s*หล/);
  return {
    margin,
    listed,
    stated: stated ? +stated[1] : null,
    sections: hits.length,
    announcement: (text.match(/ประกาศที่\s*\S+/) || [null])[0],
  };
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

window.PowerInvestingRefData = { parseBlockTradeWorkbook, parseMarginablePdf, BT_SHEET };
