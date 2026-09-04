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

BANGKOK = dt.timezone(dt.timedelta(hours=7))


def market_today():
    """Today's date on the exchange, not on the CI runner (which is UTC)."""
    return dt.datetime.now(BANGKOK).date()


# Phases in which trading is under way or still to come, so `last` is not a
# final close. SET reports plain "Closed" both before the open and after it.
_TRADING_PREFIXES = ("open", "intermission", "auction", "pre", "call")


def is_trading(status):
    return str(status or "").strip().lower().startswith(_TRADING_PREFIXES)


def pick_close(prior, last, status):
    """Most recent session's close, and whether it is today's.

    Mirrors power_investing/fetchers.pick_close. NOT keyed off
    `highlight-data.asOfDate`: that lags for hours after the close - at 21:51
    Bangkok on a Thursday it still read Wednesday, which published T-2.
    """
    if last is not None and not is_trading(status):
        return float(last), True
    if prior is not None:
        return float(prior), False
    if last is not None:
        return float(last), False
    return None, False


def market_as_of(page):
    """Date of the most recent completed SET session."""
    try:
        status, body = page.evaluate(
            """async () => {
                const r = await fetch('/api/set/stock/PTT/highlight-data?lang=en',
                                      {headers: {accept: 'application/json'}});
                return [r.status, await r.text()];
            }""")
        if status == 200:
            raw = (json.loads(body) or {}).get("asOfDate")
            if raw:
                return dt.date.fromisoformat(raw[:10])
    except Exception:
        pass
    return None


UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
SET_WARMUP = "https://www.set.or.th/en/market/product/stock/quote/PTT/price"
DW_WARMUP = "https://www.dw19club.com/"


def listed_symbols(page):
    """Every ordinary share currently listed on SET/mai."""
    status, body = page.evaluate(
        """async () => {
            const r = await fetch('/api/set/stock/list?securityType=S&lang=en',
                                  {headers: {accept: 'application/json'}});
            return [r.status, await r.text()];
        }""")
    if status != 200:
        return []
    return sorted({s["symbol"].strip().upper()
                   for s in (json.loads(body).get("securitySymbols") or [])
                   if s.get("symbol")})


def main(target):
    snap = json.loads(Path(target).read_text(encoding="utf-8"))
    known = sorted(snap.get("stocks", {}))
    if not known:
        print("no stocks in the snapshot to refresh")
        return 1

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent=UA)

        # set.or.th sits behind bot protection: load a real page first, then
        # call the JSON API from inside that page.
        page = ctx.new_page()
        page.goto(SET_WARMUP, wait_until="domcontentloaded", timeout=90_000)
        page.wait_for_timeout(4000)

        # Follow the live listing so newly listed shares appear on their own;
        # fall back to what the snapshot already holds if that call fails.
        symbols = listed_symbols(page) or known
        added = len(set(symbols) - set(known))
        print(f"refreshing {len(symbols)} stocks"
              f"{f' ({added} newly listed)' if added else ''}", flush=True)

        as_of = market_as_of(page)
        trade_date = None

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
                close, from_today = pick_close(
                    d.get("prior"), d.get("last"), d.get("marketStatus"))
                if close is None:
                    failed.append(sym)
                    continue
                if trade_date is None:
                    trade_date = market_today() if from_today else as_of
                    print(f"quoting the close of {trade_date}"
                          f" ({'today, just closed' if from_today else 'the last completed session'})",
                          flush=True)
                stocks[sym] = {"close": float(close), "tick": d.get("tickSize"),
                               "name": d.get("nameEN"), "market": d.get("marketName")}
            except Exception:
                failed.append(sym)
            if i % 50 == 0:
                print(f"   {i}/{len(symbols)} ({i/max(time.time()-started,1e-6):.1f}/s)", flush=True)

        if len(stocks) < len(known) * 0.8:
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
    snap["trade_date"] = trade_date.isoformat() if trade_date else None
    snap["generated_at"] = dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")

    Path(target).write_text(json.dumps(snap, separators=(",", ":")), encoding="utf-8")
    print(f"\nwrote {target}: closes dated {snap.get('trade_date')}, "
          f"{len(stocks)} stocks, "
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
