"""Refresh prices and warrants in an existing data.json, in place.

Written for the published site, which deliberately does not carry Yuanta's
source .pdf / .xls documents. The margin and block-trade figures already in the
snapshot are carried straight over - they change rarely, and anyone can load a
newer file through the page's upload panel.

    python tools/refresh_snapshot.py [path/to/data.json]
"""

import datetime as dt
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from playwright.sync_api import sync_playwright   # noqa: E402

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
SET_WARMUP = "https://www.set.or.th/en/market/product/stock/quote/PTT/price"
DW_WARMUP = "https://www.dw19club.com/"


def main(target):
    snap = json.loads(Path(target).read_text(encoding="utf-8"))
    symbols = sorted(snap.get("stocks", {}))
    if not symbols:
        print("no stocks in the snapshot to refresh")
        return 1
    print(f"refreshing {len(symbols)} stocks", flush=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent=UA)

        # set.or.th sits behind bot protection: load a real page first, then
        # call the JSON API from inside that page.
        page = ctx.new_page()
        page.goto(SET_WARMUP, wait_until="domcontentloaded", timeout=90_000)
        page.wait_for_timeout(4000)

        stocks, failed, started = {}, [], time.time()
        for i, sym in enumerate(symbols, 1):
            try:
                status, body = page.evaluate(
                    """async (s) => {
                        const r = await fetch(`/api/set/stock/${encodeURIComponent(s)}/info?lang=en`,
                                              {headers: {accept: 'application/json'}});
                        return [r.status, await r.text()];
                    }""", sym)
                if status != 200:
                    failed.append(sym)
                    continue
                d = json.loads(body)
                close = d.get("prior") or d.get("last")
                if not close:
                    failed.append(sym)
                    continue
                stocks[sym] = {"close": float(close), "tick": d.get("tickSize"),
                               "name": d.get("nameEN"), "market": d.get("marketName")}
            except Exception:
                failed.append(sym)
            if i % 50 == 0:
                print(f"   {i}/{len(symbols)} ({i/max(time.time()-started,1e-6):.1f}/s)", flush=True)

        if len(stocks) < len(symbols) * 0.8:
            print(f"only {len(stocks)}/{len(symbols)} priced - refusing to overwrite")
            browser.close()
            return 1

        dw = ctx.new_page()
        dw.goto(DW_WARMUP, wait_until="domcontentloaded", timeout=90_000)
        dw.wait_for_timeout(3000)
        rows = dw.evaluate("""async () => {
            const body = {underlying:'', callorput:'', issuer:['All'],
                gearing_start:'', gearing_end:'', sensitivity_start:'', sensitivity_end:'',
                price_start:'', price_end:'', moneyness_start:'', moneyness_end:'',
                days_ltd_start:'', days_ltd_end:'', offset:1, limit:5000};
            const r = await fetch('/api/search/advance', {method:'POST',
                headers:{'content-type':'application/json'}, body: JSON.stringify(body)});
            return r.ok ? (await r.json()).result_set : null;
        }""")
        browser.close()

    if not rows:
        print("warrant fetch failed - keeping the previous warrants")
    else:
        warrants = {}
        for r in rows:
            if r.get("sen") is None or not r.get("price"):
                continue
            under = underlying_of(r["symbol"], stocks)
            if not under:
                continue
            warrants.setdefault(under, []).append({
                "symbol": r["symbol"], "price": r.get("price"),
                "gearing": r.get("gearing"), "sen": r.get("sen"),
                "iv": r.get("implied_vol"), "issuer": r.get("issuer"),
                "ltd": r.get("ltd"), "type": r.get("type"),
            })
        snap["warrants"] = warrants
        print(f"   {len(rows)} warrants over {len(warrants)} underlyings", flush=True)

    snap["stocks"] = stocks
    snap["generated_at"] = dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")

    Path(target).write_text(json.dumps(snap, separators=(",", ":")), encoding="utf-8")
    print(f"\nwrote {target}: {len(stocks)} stocks, "
          f"{len(snap.get('margin', {}))} margin rates (carried over), "
          f"{len(snap.get('block_trade', {}))} SSF stocks (carried over)")
    if failed:
        print(f"   {len(failed)} without a price: {', '.join(failed[:12])}"
              f"{' ...' if len(failed) > 12 else ''}")
    return 0


def underlying_of(dw_symbol, stocks):
    for cut in range(len(dw_symbol) - 1, 0, -1):
        head = dw_symbol[:cut]
        if head in stocks:
            return head
    return None


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "data.json"
    sys.exit(main(target))
