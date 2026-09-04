/* Power Investing deck - built in the browser.
 *
 * Mirrors power_investing/ticks.py and power_investing/deck.py. The layout
 * constants below are the ones measured off the template artwork, so a deck
 * built here lands on the same grid as the Python build.
 */

/* ---------- SET tick table (mirrors ticks.py) ---------- */

const TICK_TABLE = [
  [0, 0.01], [2, 0.02], [5, 0.05], [10, 0.10],
  [25, 0.25], [100, 0.50], [200, 1.00], [400, 2.00],
];

// Work in integer "satang" so repeated ticking cannot drift.
const SC = 100;
const r2 = v => Math.round(v * SC);

function tickAt(priceCents) {
  let tick = TICK_TABLE[0][1];
  for (const [floor, t] of TICK_TABLE) {
    if (priceCents >= r2(floor)) tick = t; else break;
  }
  return r2(tick);
}

// A price sitting exactly on a band floor takes the band below when stepping down.
function tickBelow(priceCents) {
  let tick = TICK_TABLE[0][1];
  for (const [floor, t] of TICK_TABLE) {
    if (r2(floor) < priceCents) tick = t; else break;
  }
  return r2(tick);
}

function step(close, n, dir) {
  let p = r2(close);
  for (let i = 0; i < n; i++) {
    p = dir > 0 ? p + tickAt(p) : p - tickBelow(p);
    if (p <= 0) return 0;
  }
  return p / SC;
}

const fmt2 = v => Number(v).toFixed(2);

function technicalLevels(close, rule) {
  // Both read outward from the closing price, as in the source deck:
  //   Support    1 (higher) / 2 (lower)   e.g. 46.25/45.75
  //   Resistance 1 (lower)  / 2 (higher)  e.g. 47.75/48.75
  // Sorted rather than taken in rule order, so the labels stay true even if
  // the tick counts are entered the other way round.
  const s = [step(close, rule.s1, -1), step(close, rule.s2, -1)].sort((a, b) => b - a);
  const r = [step(close, rule.r1, +1), step(close, rule.r2, +1)].sort((a, b) => a - b);
  return {
    tick: fmt2(tickAt(r2(close)) / SC),
    support: `${fmt2(s[0])}/${fmt2(s[1])}`,
    resistance: `${fmt2(r[0])}/${fmt2(r[1])}`,
    stop_loss: fmt2(step(close, rule.stop, -1)),
  };
}

/* ---------- card assembly ---------- */

function buildCard(symbol, data, opts) {
  const notes = [];
  const stock = data.stocks[symbol];
  // Every listed share is priced, so a miss here means the symbol is not on
  // SET at all - a stock merely absent from the reference files still gets a
  // card, with "-" in the rows it has no data for.
  if (!stock) return { error: `${symbol} is not a SET-listed symbol` };

  const close = stock.close;
  const lv = technicalLevels(close, opts.rule);

  const card = {
    symbol,
    name: stock.name,
    close: close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    _close: close,
    tick: lv.tick,
    support: lv.support,
    resistance: lv.resistance,
    stop_loss: lv.stop_loss,
    eln_strike: '-', eln_yield: '-',
  };

  // Margin loan
  const m = data.margin[symbol];
  if (m) {
    card.margin_im = `${m.im_percent}%`;
    card.margin_gearing = m.gearing.toFixed(2);
  } else {
    // Not in the announcement: leave the two Margin Loan rows blank rather than
    // inventing a rate. Closing price and the technical levels still fill in.
    card.margin_im = '-';
    card.margin_gearing = '-';
    notes.push('not in the marginable announcement - Margin Loan left blank');
  }

  // Derivative warrant: sensitivity closest to 1
  let pool = (data.warrants[symbol] || []).filter(w => w.type === opts.dwType);
  const live = pool.filter(w => (w.ltd || 0) >= opts.dwMinDays);
  if (live.length) pool = live;

  let chosen = null;
  if (pool.length) {
    const rank = list => list.slice().sort((a, b) => Math.abs(a.sen - 1) - Math.abs(b.sen - 1))[0];
    if (opts.dwIssuer) {
      const pref = pool.filter(w => (w.issuer || '').toUpperCase() === opts.dwIssuer.toUpperCase());
      if (pref.length) chosen = rank(pref);
    }
    if (!chosen) chosen = rank(pool);
  }

  if (chosen) {
    card.dw_symbol = chosen.symbol;
    card.dw_price = fmt2(chosen.price);
    card.dw_gearing = chosen.gearing != null ? fmt2(chosen.gearing) : '-';
    card.dw_sensitivity = chosen.sen != null ? fmt2(chosen.sen) : '-';
    card.dw_iv = chosen.iv != null ? `${Math.round(chosen.iv)}%` : '-';
    card._dw = chosen;
    if (opts.dwIssuer && chosen.issuer && chosen.issuer.toUpperCase() !== opts.dwIssuer.toUpperCase()) {
      notes.push(`no ${opts.dwIssuer} warrant listed; used ${chosen.issuer}`);
    }
  } else {
    notes.push('no listed derivative warrant');
  }

  // Block trade
  const bt = (data.block_trade[symbol] || {})[opts.series];
  if (bt) {
    const gearing = (close * bt.multiplier * bt.min_contracts) / bt.im_per_block;
    card.bt_symbol = bt.ssf_symbol;
    card.bt_min_contracts = bt.min_contracts.toLocaleString('en-US');
    card.bt_im_per_block = Math.round(bt.im_per_block).toLocaleString('en-US');
    card.bt_gearing = gearing.toFixed(2);
    card._bt = bt;
  } else {
    notes.push('no single-stock futures listed');
  }

  card.notes = notes;
  return card;
}

/* ---------- slide layout (mirrors deck.py) ---------- */

const LAYOUT = {
  W: 13.3333333, H: 7.5,
  rowPitch: 0.2211125,
  row2Top: 2.073,
  closeTop: 1.553,
  valueCenters: [3.6115, 7.6395, 11.6715],
  titleCenters: [2.6455, 6.6735, 10.7055],
  valueWidth: 1.80,
  titleWidth: 3.309,
  dateLeft: 10.429, dateTop: 0.501, dateWidth: 2.962,
  cardsPerSlide: 3,
  valueColor: '404041',
};

const ROWS = {
  close: 0, support: 2, resistance: 3, stop_loss: 4,
  eln_strike: 6, eln_yield: 7,
  margin_im: 9, margin_gearing: 10,
  dw_symbol: 11, dw_price: 12, dw_gearing: 13, dw_sensitivity: 14, dw_iv: 15,
  bt_symbol: 16, bt_min_contracts: 17, bt_im_per_block: 18, bt_gearing: 19,
};

const VALUE_FIELDS = Object.keys(ROWS).filter(k => k !== 'close');

const rowTop = n => LAYOUT.row2Top + LAYOUT.rowPitch * (n - 2);

function chunkCards(cards) {
  const out = [];
  for (let i = 0; i < cards.length; i += LAYOUT.cardsPerSlide) {
    out.push(cards.slice(i, i + LAYOUT.cardsPerSlide));
  }
  return out.length ? out : [[]];
}

function dateLabel(iso) {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getDate()} ${d.toLocaleString('en-US', { month: 'long' })} ${d.getFullYear()}`;
}

// TFEX quarterly delivery months. SSF contracts settle at the end of their
// delivery month, so a contract stays the front month for all of that month.
const QUARTER_CODES = { 3: 'H', 6: 'M', 9: 'U', 12: 'Z' };

function frontSeries(available, today = new Date()) {
  let year = today.getFullYear(), month = today.getMonth() + 1;
  for (let i = 0; i < 8; i++) {
    if (QUARTER_CODES[month]) {
      const code = QUARTER_CODES[month] + String(year % 100).padStart(2, '0');
      // Only offer it if the workbook actually carries that series.
      if (!available || !available.length || available.includes(code)) return code;
    }
    if (++month > 12) { month = 1; year++; }
  }
  // Nothing matched (an unusual workbook) - fall back to what it does have.
  return available && available.length ? available[0] : null;
}

/* ---------- PowerPoint ---------- */

async function buildPptx(cards, isoDate, artDataUrl) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'PI', width: LAYOUT.W, height: LAYOUT.H });
  pptx.layout = 'PI';

  // Put the artwork on a master rather than on each slide, so it is stored
  // once no matter how many slides the deck ends up with.
  pptx.defineSlideMaster({
    title: 'PI_MASTER',
    background: { data: artDataUrl },
  });

  const label = dateLabel(isoDate);
  const common = { fontFace: 'Quark', bold: true, margin: 0, isTextBox: true };

  for (const chunk of chunkCards(cards)) {
    const slide = pptx.addSlide({ masterName: 'PI_MASTER' });

    slide.addText(label, {
      ...common, x: LAYOUT.dateLeft, y: LAYOUT.dateTop,
      w: LAYOUT.dateWidth, h: 0.438, fontSize: 20, color: 'FFFFFF', align: 'left',
    });

    chunk.forEach((card, i) => {
      slide.addText(card.symbol, {
        ...common,
        x: LAYOUT.titleCenters[i] - LAYOUT.titleWidth / 2, y: 1.192,
        w: LAYOUT.titleWidth, h: 0.438, fontSize: 20, color: 'FFFFFF', align: 'center',
      });
      slide.addText(String(card.close ?? '-'), {
        ...common,
        x: LAYOUT.valueCenters[i] - LAYOUT.valueWidth / 2, y: LAYOUT.closeTop,
        w: LAYOUT.valueWidth, h: 0.404, fontSize: 18, color: 'FFFFFF', align: 'center',
      });
      for (const f of VALUE_FIELDS) {
        slide.addText(String(card[f] ?? '-'), {
          ...common,
          x: LAYOUT.valueCenters[i] - LAYOUT.valueWidth / 2, y: rowTop(ROWS[f]),
          w: LAYOUT.valueWidth, h: 0.286, fontSize: 11,
          color: LAYOUT.valueColor, align: 'center',
        });
      }
    });
  }

  return pptx.write({ outputType: 'blob' });
}

/* ---------- PDF ---------- */

// PowerPoint puts the first baseline this far below the box top; fitted against
// a PowerPoint-produced PDF, same constants as pdfrender.py.
const PT = 72;
const TOP_INSET = 0.05 * PT;
const ASCENT_RATIO = 0.8211;
const BASELINE_NUDGE = 0.088;

// jsPDF measures y downwards from the top of the page, so this is the distance
// from the top - no flip, unlike reportlab's bottom-up canvas in pdfrender.py.
function baselineY(boxTopIn, size) {
  return boxTopIn * PT + TOP_INSET + size * ASCENT_RATIO + BASELINE_NUDGE;
}

// Carlito is metrically identical to Calibri, the face PowerPoint substitutes
// for the template's Quark. Embedding it keeps the PDF matching the deck on
// machines that have no Calibri of their own.
let FONT_B64 = null;

async function loadFont(embedded = null, url = 'Carlito-Bold.ttf') {
  if (FONT_B64) return FONT_B64;
  if (embedded) { FONT_B64 = embedded; return FONT_B64; }
  const buf = await (await fetch(url)).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  FONT_B64 = btoa(s);
  return FONT_B64;
}

function buildPdf(cards, isoDate, artDataUrl) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt',
                          format: [LAYOUT.W * PT, LAYOUT.H * PT] });

  if (FONT_B64) {
    doc.addFileToVFS('Carlito-Bold.ttf', FONT_B64);
    doc.addFont('Carlito-Bold.ttf', 'Carlito', 'bold');
    doc.setFont('Carlito', 'bold');
  } else {
    doc.setFont('helvetica', 'bold');
  }
  const label = dateLabel(isoDate);
  const chunks = chunkCards(cards);

  chunks.forEach((chunk, page) => {
    if (page > 0) doc.addPage([LAYOUT.W * PT, LAYOUT.H * PT], 'landscape');
    // 'FAST' reuses the same embedded copy on every page via the alias.
    doc.addImage(artDataUrl, 'JPEG', 0, 0, LAYOUT.W * PT, LAYOUT.H * PT,
                 'deckArt', 'FAST');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.text(label, LAYOUT.dateLeft * PT + 0.1 * PT, baselineY(LAYOUT.dateTop, 20));

    chunk.forEach((card, i) => {
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(20);
      doc.text(String(card.symbol), LAYOUT.titleCenters[i] * PT,
               baselineY(1.192, 20), { align: 'center' });
      doc.setFontSize(18);
      doc.text(String(card.close ?? '-'), LAYOUT.valueCenters[i] * PT,
               baselineY(LAYOUT.closeTop, 18), { align: 'center' });

      doc.setTextColor(0x40, 0x40, 0x41);
      doc.setFontSize(11);
      for (const f of VALUE_FIELDS) {
        doc.text(String(card[f] ?? '-'), LAYOUT.valueCenters[i] * PT,
                 baselineY(rowTop(ROWS[f]), 11), { align: 'center' });
      }
    });
  });

  return doc;
}

/* ---------- on-screen preview ----------
 * Drawn straight onto a canvas rather than by rasterising the PDF: it is far
 * quicker, and it keeps the page from depending on a PDF rendering library.
 */

function drawSlide(canvas, chunk, isoDate, artImage, cssWidth = 1400) {
  const scale = cssWidth / LAYOUT.W;          // px per inch
  canvas.width = Math.round(LAYOUT.W * scale);
  canvas.height = Math.round(LAYOUT.H * scale);

  const ctx = canvas.getContext('2d');
  ctx.drawImage(artImage, 0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const face = size => `bold ${size * scale / PT}px Calibri, CarlitoDeck, Carlito, "Segoe UI", sans-serif`;
  const baseline = (topIn, size) =>
    (topIn * PT + TOP_INSET + size * ASCENT_RATIO + BASELINE_NUDGE) * scale / PT;

  ctx.fillStyle = '#fff';
  ctx.font = face(20);
  ctx.textAlign = 'left';
  ctx.fillText(dateLabel(isoDate), (LAYOUT.dateLeft + 0.1) * scale,
               baseline(LAYOUT.dateTop, 20));
  ctx.textAlign = 'center';

  chunk.forEach((card, i) => {
    ctx.fillStyle = '#fff';
    ctx.font = face(20);
    ctx.fillText(String(card.symbol), LAYOUT.titleCenters[i] * scale, baseline(1.192, 20));
    ctx.font = face(18);
    ctx.fillText(String(card.close ?? '-'), LAYOUT.valueCenters[i] * scale,
                 baseline(LAYOUT.closeTop, 18));

    ctx.fillStyle = '#' + LAYOUT.valueColor;
    ctx.font = face(11);
    for (const f of VALUE_FIELDS) {
      ctx.fillText(String(card[f] ?? '-'), LAYOUT.valueCenters[i] * scale,
                   baseline(rowTop(ROWS[f]), 11));
    }
  });

  return canvas;
}

window.PowerInvesting = {
  buildCard, buildPptx, buildPdf, drawSlide, loadFont, technicalLevels, frontSeries,
  chunkCards, dateLabel, LAYOUT, ROWS, VALUE_FIELDS,
};
