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


---

## Working. Both directions, with a control.

```
✓ fixtures are actually served (guards against a vacuous pass)
✓ funding-positive puts POSITIVE rates on screen
✓ funding-negative puts NO positive rate on screen
✓ an upstream 500 does not blank the page
```

**The first tests in this suite that assert the product against a known market
input.** `TEST_GAPS.md` §1 has said since it was written that this was
impossible; it is no longer.

### The last bug was mine, not the app's

After six attempts hunting the data source, the final failure —
`funding-positive` reporting "no rates rendered at all" — was **the collector's
regex**:

```diff
- if (/^-?\d+\.\d{3,4}\s*%$/.test(t))
+ if (/^[+-]?\d+\.\d{3,4}\s*%$/.test(t))
```

The page renders positive funding as **`+0.0027%`**, with an explicit plus. A
`-?` class cannot see that, so every positive rate was invisible to the thing
asserting on positive rates.

Which also retires the theory that preceded it: the symbol mapping was never
wrong. All 49 symbols `BYBIT_SYMS` expects are present in the trimmed fixture,
none missing — checked rather than assumed, after assuming it in the previous
commit message.

### Why the pair is not vacuous

`funding-positive` requires at least one positive rate on screen;
`funding-negative` requires none. Same fixture, same symbols, opposite sign. A
broken interception fails both — which is what happened when the route pattern
did not match, and the `byKey['bybit-tickers']` guard reported it precisely
rather than passing quietly.


---

## Wiring the contrast sweep to fixtures: tried, reverted, and why

All 17 endpoints are now recorded (20 payloads, 299 KB). `contrast.spec.ts` was
wired to `installMarketFixtures` and **both themes passed**.

**The wiring is reverted anyway.** It passed for the wrong reason.

| | dark tokens |
|---|---|
| baseline (live data) | **16** |
| measured with fixtures | **11** |
| never rendered | `#3a3d48` `#3b3e49` `#6c6d72` `#733738` `#745a16` |

The spec fails when a **new** token appears. A token *disappearing* is
indistinguishable from someone genuinely fixing it, so five surfaces silently
stopped being measured and the run went green.

**That is a worse outcome than the flakiness it was meant to fix**: the sweep
would have looked more stable while covering less, and the tokens it stopped
seeing are exactly the data-dependent ones — `#733738` and `#745a16` were first
seen on `/econ-calendar`, `#3a3d48`/`#3b3e49` on the same route.

### Why they stopped rendering

The fixtures cover the **third-party** boundary. `/econ-calendar` and several
other surfaces are fed by our own `/api/*` routes — `econ-calendar`, `cmc`,
`macro`, `labels`, `news` — which are served from route handlers, so the browser
never issues the upstream call and there is nothing for `page.route` to
intercept at that boundary.

Serving a stale or empty `/api/econ-calendar` means the calendar renders empty,
and an empty calendar has no coloured rows to fail contrast on.

### What closing it needs

Recording the app's own `/api/*` responses as well, and accepting that those are
shapes we control and change — which is the exact coupling `FIXTURES.md` argued
against at the start. That argument was about *assertions*; for *rendering* it
does not apply, because a route that renders nothing measures nothing.

### The check that caught it

Comparing the measured token set against `BASELINE.contrast.darkTokens` by hand
after the run went green. Nothing in the suite does that automatically, and if I
had trusted the green I would have shipped a sweep that covers two thirds of
what it used to and reports the same.

**Worth adding to the spec regardless of fixtures:** when a token disappears,
say so loudly rather than silently. A real fix and a surface that stopped
rendering look identical today.


---

## CORRECTION: the fixtures did not lose coverage. I was wrong.

The section above says wiring `contrast.spec.ts` to fixtures dropped the dark
sweep from 16 tokens to 11, and that five surfaces stopped rendering as a result.
**That attribution is wrong**, and the bidirectional assertion added in the same
change is what disproved it.

Ran the sweep on **live data** with a synthetic token added to the baseline, to
prove the new assertion fires. It fired — and reported **six** missing tokens,
not one:

```
#3a3d48  #3b3e49  #6c6d72  #733738  #745a16  #deadbe(synthetic)
```

Those five are exactly the five I blamed on the fixtures.

| run | dark tokens observed |
|---|---|
| live data | **11** of 16 |
| with fixtures | **11** of 16 |

**Identical.** The fixtures changed nothing. Those five tokens are data-dependent
surfaces that were present when the baseline was measured and are not rendering
now — `#733738` and `#745a16` were first seen on `/econ-calendar`, which has no
events to render today.

### What actually happened

I measured a token count, compared it to the baseline, found it short, and
attributed the shortfall to the change I had just made. The change was the most
recent thing, not the cause. **I never ran the control — the same measurement
without the fixtures — which is the one comparison that would have separated
them, and it is the discipline I have applied to everyone else's work all week.**

The fixture wiring was reverted for no reason and should go back.

### What the assertion is really telling us

The baseline has **five entries that a live run does not observe**. That is not a
fixture problem and never was — it is the data-dependence the fixtures were meant
to fix, showing up as stale baseline entries nobody could see before.

So the new assertion is doing exactly its job on its first real run, and its
first finding is that the baseline has been quietly wrong for some time.

**It will be noisy until those surfaces are deterministic**, which is the
argument for fixtures rather than against them.
