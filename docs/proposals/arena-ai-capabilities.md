# Proposal: new capabilities for the Arena page, and where AI is actually the right tool

**Status: PROPOSED. Nothing scheduled.** Written on the owner's instruction, 2026-10-30: *"For the
Arena page… not a new feature, but a new capability of the page, because that's our selling feature,
that page… give me a suggestion when we should leverage AI."*

Tracker for Arena work: **`#1263`**. Items accepted from this list become checkboxes there, not new
issues.

---

## 1. What Arena already does today

Measured from `app/(main)/arena/page.tsx` (2,931 lines) and its imports, 2026-10-30 — so this list
is what the page *is*, not what it was planned to be:

- **Chart:** `KLineProChart`
- **Signals and structure:** `StrategyPanel`, `EMASignal`, `ConfluenceScore`, `MarketStructure`,
  `MultiTFAlignment`, `HigherTfMoveBadge`
- **Flow:** `AbsorptionDetector`, `LiqFeed`, funding rate, `CoinMarketSnapshot`, JPY forex
- **AI:** one read via `/api/grok`, with `AiDisclaimer`, `UsageMeter`, `GrokUsageProvider`
- **Actions:** price alerts, Telegram send
- **Paywall:** `UpgradeGateModal`, `UpgradePill`

So the page is already dense with *measurements*. What it is thin on is **judgement** — turning
those measurements into "so what, and what do I do with it."

---

## 2. The rule for when to use AI

This is the part worth internalising, because it decides which of the ideas below are good:

> **Use AI where the job is judgement, language, or ranking many weak signals.
> Never use AI where the job is measurement.**

A model that is asked to *measure* will produce a confident number that is slightly wrong, and a
slightly wrong number on a trading product is worse than no number. A model asked to *explain,
rank, or connect* is doing what it is uniquely good at, and a human can check it.

Every row in the table below is marked with which side of that line it falls on.

---

## 3. Suggested capabilities, ranked

Ranked by **value to a paying trader ÷ build cost**, highest first.

| # | Capability | What the user gets | AI's job | Why it ranks here | Cost |
|---|---|---|---|---|---|
| 1 | **"Why did it move?"** — headline-to-candle attribution | A 2.5% drop appears on the chart with the headline that caused it, timestamped to the candle | **Judgement.** Matching free text to a price event is exactly what rules cannot do | Highest-value gap on the page. A trader opens the app on a red candle and the first question is always *why*. Today we show the move and leave them to go find out elsewhere. We already carry news feeds (Finnhub, Yahoo Finance, Politico, Al Jazeera RSS) and never connect them to price | Low–med |
| 2 | **Chart structures drawn on the chart** | Channels, trendlines, flags, labelled with timeframe and invalidation | **Hybrid.** Code measures the geometry, AI picks which matter and writes the read | The owner's own ask. Full spec: `docs/proposals/ai-chart-structures.md` | Med–high |
| 3 | **Alert triage** | "You had 41 alerts since yesterday. Three mattered. Here is why" | **Ranking weak signals** | Fixes a *measured* problem, not a guessed one: `lhq_alert_fires` holds ~56,591 rows from 6 users. At that rate alerts are noise, and noise is a churn reason. Ties to `#1651` | Low |
| 4 | **Pre-trade risk check** | User says "long BTC here, stop there"; gets the specific ways that trade dies — funding drag, nearest liquidation cluster, the level that invalidates it | **Judgement over data we already hold** | Converts existing panels into a decision. Also the most defensible "Pro" feature on the page | Med |
| 5 | **Trade journal auto-review** | "Across 23 closed trades, you cut winners at 1.1R and let losers run to 2.4R" | **Pattern recognition over the user's own history** | Personal, so no competitor can copy it, and it is the strongest retention mechanic on the list. Needs the Journal to have enough rows first | Med |
| 6 | **Liquidation cascade narration** | When a cascade fires, one line on what is happening and what usually follows | **Language over a measured event** | We already detect cascades and show raw feed. The feed is unreadable to a beginner | Low |
| 7 | **Macro context strip** | "Crypto is down with risk assets, not on its own" — Fed, oil, equities | **Judgement** | Stops the user mistaking a macro day for a coin-specific signal. Directly relevant this week | Low–med |
| 8 | **Scan ranking across coins** | "Of 50 coins, these 3 have the cleanest setup right now" | **Hybrid** — deterministic score first, AI writes the top-3 reasons only | Powerful, but scoring must be code or it becomes a slot machine. AI over 50 coins per request is also the most expensive thing on this list if done naively | Med |
| 9 | **Panel coach** | "What is this telling me?" on any panel, answered in plain words at the user's level | **Language** | Cheapest conversion help on the page — a beginner who understands a panel is a beginner who renews. Complements `/learn` instead of duplicating it | Low |

### Deliberately **not** AI

Worth building, but as code. If any of these get handed to a model we will be shipping numbers we
cannot reproduce:

| Capability | Why it must be code |
|---|---|
| Position sizing / R:R calculator | Arithmetic. A model doing arithmetic is a liability with no upside |
| Market regime classifier (trending / ranging / compressing) | ATR, ADX, Bollinger width. Deterministic, testable, free. AI may *name* the output, never compute it |
| Correlation and divergence watcher (BTC up, alt not following) | Rolling correlation. Pure math |
| Volume profile / value area | Pure math |
| Session high/low, open levels | Pure math |

---

## 4. If only one thing gets built

**#1, "Why did it move?"** It is the question every trader asks first, we already pay for the
inputs, no competitor in our segment answers it inside the chart, and it is unambiguously a job for
a language model rather than a rule.

It also demos in one screenshot, which matters for marketing.

---

## 5. Constraints that apply to every row above

- The UI says "AI". It never names the vendor or the model — `docs/OWNER-RULES.md`.
- Every AI output carries its honesty label and refuses rather than guessing when the input is
  unreadable — `#1631`.
- Every number carries a source and an age, and has a defined unknown state — `#1651`.
- Each capability must pass the cost-per-call test against the margin in
  `docs/PRICING_AND_LIMITS.md` before it is scheduled.
- Anything the owner will see on screen needs his visual approval before it merges.
