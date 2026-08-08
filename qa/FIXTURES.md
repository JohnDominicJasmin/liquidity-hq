# Controlling market data — the enumeration, and what it costs

**Owner: QA. Measured 2026-08-08 against production.**

Closing [`TEST_GAPS.md`](TEST_GAPS.md) §1 — *"market data and the clock cannot be
controlled"* — starts here. §1 has been the top item on that list since it was
written, and the reason it never moved is that nobody knew what would have to be
intercepted. This file is that answer.

**Step 1 is enumeration, not recording.** You cannot intercept what you have not
listed, and the list turned out to be larger and more lopsided than expected.

---

## What a browser actually requests

Five routes (`/arena`, `/correlation`, `/funding`, `/liq`, `/dashboard`), 12
seconds of dwell each, signed out, on production.

| Calls | Max bytes | Endpoint | Seen on |
|---|---|---|---|
| 222 | 15 KB | `api.bybit.com/v5/market/kline` | arena, correlation, liq, dashboard |
| 197 | 233 B | `api.bybit.com/v5/market/account-ratio` | arena, correlation, liq, dashboard |
| 196 | 495 B | `api.bybit.com/v5/market/open-interest` | arena, correlation, liq, dashboard |
| 180 | 24 KB | `api.binance.com/api/v3/aggTrades` | correlation, funding, liq, dashboard |
| 51 | 30 KB | `api.binance.com/api/v3/klines` | correlation, dashboard |
| 45 | 5 KB | `fapi.binance.com/fapi/v1/fundingRate` | funding |
| 24 | 103 KB | `api.bybit.com/v5/market/recent-trade` | arena, correlation, liq, dashboard |
| 10 | 131 KB | `liquidity-hq.com/api/cmc` | all five |
| 8 | 3 KB | `api.binance.com/api/v3/depth` | correlation, funding, liq, dashboard |
| 7 | 213 KB | `fapi.binance.com/fapi/v1/klines` | arena |
| 5 | 190 KB | `fapi.binance.com/fapi/v1/premiumIndex` | all five |
| 5 | 173 KB | `liquidity-hq.com/api/labels` | all five |
| 5 | 22 KB | `liquidity-hq.com/api/market/snapshot` | all five |
| 5 | 4 KB | `liquidity-hq.com/api/market/rsi` | all five |
| 4 | **600 KB** | `api.bybit.com/v5/market/tickers` | arena, correlation, liq, dashboard |
| 3 | 2 KB | `fapi.binance.com/futures/data/openInterestHist` | arena, dashboard |
| 2 | **369 KB** | `www.deribit.com/api/v2/public/get_book_summary_by_currency` | liq, dashboard |
| 2 | 121 B | `fapi.binance.com/futures/data/globalLongShortAccountRatio` | liq, dashboard |
| 1 | 4 KB | `liquidity-hq.com/api/funding` | arena |
| 1 | 121 B | `fapi.binance.com/futures/data/topLongShortPositionRatio` | liq |
| 1 | 2 KB | `liquidity-hq.com/api/econ-calendar` | dashboard |

Plus `/api/config`, `/api/proxy`, `/api/macro`, `/api/coinbase-price`,
`/api/forex/jpy` — small, five calls each — and 14 GlitchTip envelopes, which are
[#73](https://github.com/JohnDominicJasmin/liquidity-hq/issues/73) and not market
data.

**27 distinct endpoints. 16 third-party, called directly from the browser. 11 on
our own `/api` surface.**

---

## Three things this changes

**1. Fixtures are feasible, and no dev work is required.** All four data-heavy
pages are client components, so every one of those 27 requests originates in the
browser and `page.route` can intercept it. Nothing is fetched server-side at
render, which was the one outcome that would have made this hard.

**2. Intercept at the third-party boundary, not at `/api`.** Sixteen patterns
covers the bulk of it, and those payload shapes are contracts Binance and Bybit
publish. Our own `/api` responses are shapes we control and change; pinning tests
to them would make every internal refactor a test failure. `/api/cmc`,
`/api/labels` and `/api/market/*` still need stubs, but as a second layer.

**3. The volume is the headline.** Roughly **1,000 third-party requests across
five pageviews** — around 44 Bybit kline calls per page load. That is polling, not
fetching.

That last one explains something QA has been working around for weeks:
`playwright.config.ts` pins `workers: 1` because parallel specs trip Binance and
Bybit per-IP rate limits, and the resulting 429s look like product bugs. **The
suite is slow because the app is chatty**, and the workaround has been treated as
a Playwright quirk rather than a measurement of the product.

Not filing that as a defect — per-IP limits mean real users each have their own
budget, so this is not a production outage waiting to happen. But it is worth
someone deciding deliberately, because it is also battery, mobile data, and
whatever the CMC plan costs.

---

## What fixtures buy, restated concretely

Today a green suite means *"nothing crashed given today's prices"*. None of these
have ever been asserted:

- funding rate crossing **negative**, and the UI that is supposed to react
- RSI crossing overbought / oversold
- squeeze and flush scores **at** their alert boundaries
- a `null` price, an empty array, a string where a number was expected
- Binance returning 429 or 500 — which the suite currently reads as its own flake
- liquidation map at extremes

The last two matter most for launch: **the app's behaviour when its data source
fails has never been tested**, and it is the failure mode most likely to happen
in public.

---

## Order of work

| | Step | State |
|---|---|---|
| 1 | Enumerate every intercepted endpoint | **done — this file** |
| 2 | Record one representative payload per endpoint | **6 of 7 recorded**, see below |
| 3 | `qa/e2e/_fixtures.ts` — `page.route` layer, one scenario per file | |
| 4 | First scenarios: negative funding, RSI extremes, upstream 500 | |
| 5 | Fake clock for the time-dependent paths | last, and separable |

Step 2 is most of the work, exactly as `TEST_GAPS.md` §1 predicted. Steps 3 and 4
are the payoff and are small once the payloads exist.

**Recording scripts live in the session scratchpad, not in the repo** — same as
the audit harness in `pendings/QA_AUDIT_2026-08-04.md` §9. The enumeration above
is the durable part; the script that produced it is twenty lines of Playwright
response listener and is cheaper to rewrite than to maintain.


---

## Step 2, and what recording actually taught us

Six payloads recorded from production (64 KB total, in `qa/fixtures/`):
`binance-fundingRate`, `bybit-kline`, `bybit-open-interest`, `lhq-funding`,
`lhq-market-rsi`, `lhq-market-snapshot`.

**`fapi/v1/premiumIndex` is now recorded**, trimmed from 857 symbols to the 48
the app displays — 10 KB instead of 190 KB. `bybit/v5/market/funding/history` too.
Eight payloads, 78 KB total.

`qa/e2e/_fixtures.ts` serves them via `page.route`, and
`qa/e2e/market-scenarios.spec.ts` has the two assertions that are currently
honest: interception genuinely happens, and an upstream 500 does not blank the
page. Both run locally with no auth fixtures.

### The funding scenario is written and NOT asserted on

Three controls killed three versions of it, and the third is the useful one:

| | Assertion | Result |
|---|---|---|
| 1 | page contains `/-\s?\d/` | **Passed on POSITIVE data** — the page already renders 18 strings like `"-0"` |
| 2 | no positive funding percentage rendered | **Passed on unmodified data** — the recorded Binance payload has 9 of 42 rows already negative |
| 3 | force every Binance row positive, expect positives on screen | **Failed** — all 18 rendered rates stayed negative |

**(3) is the finding.** The rates on `/funding` do not come from
`fapi/v1/fundingRate`, which is intercepted. They come from something that is
not — almost certainly `premiumIndex`, the one endpoint skipped in step 2 for
size.

So the gap is exactly where the shortcut was taken, and none of the three
versions would have revealed it. Each passed. Only deliberately trying to make
the test fail did.

**The transferable part:** `served.count > 0` is not a sufficient interception
guard. It was satisfied by an unrelated route while the values under test still
came from live data. `_fixtures.ts` now returns `byKey` so a spec can assert the
*specific* endpoint was intercepted.

### What closes it

Record `premiumIndex` trimmed to the tested symbols, confirm the rendered rates
follow it, then the `funding-positive` / `funding-negative` pair becomes a real
test with a working control in both directions.


---

## Five attempts at the funding scenario, and why it is still not asserted on

Recorded, wired, and **deliberately left without an assertion.**

| | Attempt | Result |
|---|---|---|
| 1 | assert the page contains a negative number | passed on POSITIVE data — the page renders 18 strings like `"-0"` |
| 2 | narrow to funding percentages | passed on unmodified data — the recorded Binance payload had 9 of 42 rows already negative |
| 3 | force `fapi/v1/fundingRate` positive | screen unchanged |
| 4 | add `premiumIndex`, trimmed | screen unchanged |
| 5 | add `bybit/v5/market/funding/history`, found by tracing every request | screen unchanged |

**The tell, present throughout and noticed too late: the rendered values shift
between runs.** Fixtures are static. Anything that moves is live. Four of those
five attempts could have been skipped by checking that first.

Attempt 5 is the only one that used a method rather than a guess — logging every
request the page makes and diffing against what was intercepted. That found
`bybit/v5/market/funding/history` in one run, and also showed that
**`/api/funding` is never requested by this page at all**, so intercepting it was
dead weight from the start.

**What remains unknown:** which source the number on screen is derived from. The
interception layer is sound and its accounting (`byKey`) is trustworthy; the gap
is knowledge of the data flow, not tooling.

**What would close it:** trace with every intercepted route *blocked* rather than
fulfilled. Whatever still renders is coming from somewhere unlisted, and the
absence will be louder than the presence.

**Why it is not shipped green.** `funding-negative` passes today — every rendered
rate is negative. It would pass just as well against the live market on a day
when funding happens to be negative, which is most days. That is a test asserting
the weather.
