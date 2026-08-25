# Power Investing Generator

Type in stock symbols, get back a Power Investing deck as **PowerPoint** and
**PDF**.

**→ [Open the site](https://pridil.github.io/powerinvesting-generator/)**

Everything runs in your browser. Nothing you type or upload is sent anywhere.

## What it fills in

| Row | Source |
| --- | --- |
| Closing Price | Previous session's official close from set.or.th |
| Support / Resistance / Stop Loss | Stepped off the close using the SET tick table |
| Bull ELN — Strike, Yield | Left blank; there is no feed for it |
| Margin Loan — IM, Gearing | The marginable-securities announcement |
| Derivative Warrant | dw19club.com — the warrant whose sensitivity is closest to 1 |
| Block Trade | The SSF-Calculation workbook |

### Technical levels

Measured in **ticks** from the closing price, and editable on the page:

* Support — 2 and 4 ticks below
* Resistance — 4 and 8 ticks above
* Stop loss — 8 ticks below

Tick size follows the SET spread table (0.01 below ฿2 up to 2.00 at ฿400+) and
is re-read at every step, so a level that crosses a price band stays valid —
one tick below ฿100.00 is 99.75, not 99.50.

These are mechanical levels, not a view on the stock.

### Block trade gearing

```
IM per block = IM per contract × minimum contracts
gearing      = close × multiplier × minimum contracts ÷ IM per block
```

Multipliers other than 1,000 (a stock that has had a corporate action) are read
from the workbook rather than assumed.

## Using newer margin / block-trade files

The *Reference files* panel takes a newer marginable announcement (`.pdf`) or
SSF-Calculation workbook (`.xls`/`.xlsx`). They are parsed **in your browser**,
never uploaded, and remembered on your computer until you reset them. The panel
shows which file each figure is coming from.

## How the data stays current

`.github/workflows/publish.yml` refreshes closing prices and warrant data every
weekday at 18:00 Bangkok — after the SET close — and redeploys. Margin and
block-trade figures are carried over from the committed snapshot, since those
change rarely and can be updated from the page itself.

A failed scrape leaves the previous snapshot in place rather than replacing it
with something worse.

## Disclaimer

Not investment advice. Figures are derived from public market data and from the
reference documents loaded into the page; check anything you rely on against
the source before trading.
