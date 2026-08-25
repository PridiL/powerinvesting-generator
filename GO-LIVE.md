# Going live — two steps, about a minute

Everything is pushed and ready. These two steps have to be done by you: making
a repository public and switching on Pages both need account-owner action.

## 1. Make the repository public

<https://github.com/PridiL/powerinvesting-generator/settings>

Scroll to **Danger Zone → Change repository visibility → Change to public**.

GitHub Pages only serves public repositories unless you are on a paid plan.

## 2. Turn on Pages

<https://github.com/PridiL/powerinvesting-generator/settings/pages>

Set **Source** to **GitHub Actions**. Nothing else to configure.

Then run the workflow once:

<https://github.com/PridiL/powerinvesting-generator/actions> →
*Refresh data and publish* → **Run workflow**

## The address

    https://pridil.github.io/powerinvesting-generator/

Free, permanent, and anyone can open it. It refreshes itself every weekday at
18:00 Bangkok.

## What is public once you do this

This repository holds only what the website needs:

* the deck artwork (`template.jpg`)
* the data snapshot (`data.json`) — closing prices, warrants, and the margin and
  block-trade figures derived from the Yuanta reference documents
* the page itself and two fonts/scripts

Yuanta's source documents — the marginable announcement PDF, the
SSF-Calculation workbook and the deck template `.pptx` — are **not** here. They
stay in the private `powerinvesting-generator-source` repository.

The derived figures are still Yuanta's published client-facing numbers, and the
artwork is their branding. Worth a word with compliance before you flip it, and
worth a thought about whether an unbranded template would suit a public tool
better.

## If you want a nicer address later

`https://pridil.github.io/powerinvesting-generator/` is free forever. A shorter
name costs money (a `.com` is about USD 10-15/year) — see `set_domain.py` in the
source repository, which writes the `CNAME` and prints the DNS records.

One genuinely free alternative: **js.org** gives open-source JavaScript projects
a `yourname.js.org` subdomain, by pull request to
<https://github.com/js-org/js.org>. It is free but needs their review, and the
project has to be public first.
