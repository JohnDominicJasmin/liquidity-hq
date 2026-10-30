# Proposal: AI chart structures — deep research draws on the chart

**Status: PHASE 0 SCHEDULED AND ASSIGNED, 2026-10-30 13:26 UTC. Tracked on `#1818`.**

**Both owner instructions, in order, because this document's status line stopped being true within
ten hours of being written:**

1. 2026-10-30 ~03:00 UTC — *"document it and make sure it's achievable. We're not working on it
   right now."* So §1–§9 below were written as a feasibility study, not a build plan.
2. 2026-10-30 13:19 UTC — **"start it."** Having asked what had become of the proposal, the owner
   read the verdict and ordered the work started.

**What that changes, and what it does not.** Phase 0 (`lib/chartStructures.ts` — pivots, line fit,
fit quality; pure functions, no UI, no AI, no network) is assigned to Dev, with QA owning the
fixture tests. **Phases 1–4 are sequenced, not started.** Nothing in §2 is relaxed by the work
starting — the geometry stays in code, and Phase 0 is deliberately the half that cannot
hallucinate. §4a is a hard constraint on Phase 2, not advice.

**It does not displace the `priority: high` reliability work** (`#1631`, `#1649`, `#1651`). The
owner's standing order of work — data reliability first, then payments and users, then polish — is
unchanged; this is a new `priority: medium` lane item that runs alongside it.

**Owner's description, in his words:** when the user hits deep research, it generates a technical
analysis **on the chart** — "either a parallel line channel or this descending action line, you
know, these traders, what they're doing on chart, like a bull flag or what flag, bear flag" — with
different timeframes, and *"higher time frame has the highest also accuracy."*

---

## 1. Verdict: achievable, and most of the plumbing already exists

Three things this feature needs, all three already in the repository today:

| What it needs | What is already there | Evidence |
|---|---|---|
| A chart that can be drawn on programmatically | **klinecharts `10.0.0-beta3`** exposes a full overlay API: `registerOverlay(template)`, `chart.createOverlay({ name, points, styles, lock, visible, groupId })`, `getOverlays(filter)`, `removeOverlay(filter)`. Points are `{ timestamp, value }` — price/time, not pixels, so an overlay stays correct through pan and zoom. | `node_modules/klinecharts/dist/index.d.ts` lines 831, 868–869, 895–896, 1200; chart host is `components/KLineProChart.tsx` |
| A deep-research button with billing, entitlement and metering | `app/api/strategy-research/route.ts` — Pro-gated server-side (`hasProFeatures`), metered (`incrementToolUsage`, `recordAiCall`), rate-limited (`rateLimitMessage`) | existing route, 121 lines |
| Candles at every timeframe, with a second source if the first fails — **with one exclusion that this feature walks straight into, see §4a** | `app/api/market/klines/route.ts` + `lib/klinesFailover.ts`. Bybit is the default source; a Binance request fails over to Bybit on any non-2xx — **but only for a fixed-limit request.** `canFailoverForRequest(isRange)` returns `!isRange`, so a RANGE request never fails over | existing routes |

So this is **not** a new subsystem. It is a new computation plus a new render layer on a chart that
already supports being drawn on.

**One dependency caveat:** klinecharts is on a **beta** release (`10.0.0-beta3`). The overlay API is
the part of v10 that changed most from v9. Pin the exact version before this work starts, and treat
a klinecharts upgrade during the build as a blocking change, not a chore.

---

## 2. The one design decision that decides whether this ships or embarrasses us

> **Geometry is computed in code. The AI only names, ranks and explains what the code measured.**

The tempting shortcut is to hand the model the candles and ask it for a trendline. **It will answer,
and the answer will be wrong in a way the user can see.** A language model given OHLC values
produces plausible-looking levels that do not actually touch the candles. A channel drawn 0.4% off
is not a soft inaccuracy on a price chart — the user's own eyes are the test instrument, and they
will fail us in public.

There is already a precedent in this codebase to **not** repeat: `app/api/smc-snapshot/route.ts`
passes the model the last 20 candles and asks it to output `KEY_LEVELS` and order-block ranges.
Those numbers are model output, not measurements. That is acceptable for a prose "read"; it is not
acceptable for a line we draw on the chart and invite the user to trade against.

This is the standing data-integrity rule (`#1651`, owner 2026-10-21: never sell inaccurate data —
every number needs a source, an age, and an unknown state) applied to geometry.

### The pipeline

1. **Pivots — deterministic.** Fractal swing highs/lows with configurable left/right strength. Pure
   function over candles, no AI, no network.
2. **Fits — deterministic.** For each candidate pivot set: least-squares line, slope, R², touch
   count, first and last touch timestamp, distance of current price from the line.
3. **Classification — deterministic rules, not AI.** A shape is a channel/flag/wedge because it
   satisfies stated numeric conditions, not because a model called it one.
4. **AI layer — the part the model is actually good at.** Given the *measured* structures as a
   table, it selects the one to three that matter, writes the plain-English read, and states what
   would invalidate each. It never returns a coordinate.
5. **Render.** One overlay per accepted structure, `lock: true` (the user cannot drag our line and
   then believe the moved line is ours), all sharing one `groupId` so a single `removeOverlay` call
   clears the whole analysis.

### What this buys us

- The drawn lines are **reproducible**: same candles in, same lines out, every time.
- QA can test steps 1–3 with fixture candles and exact expected output, with no AI call and no
  network. That is the difference between a testable feature and one we can only eyeball.
- Step 4 is cacheable, so the expensive part runs rarely.

---

## 3. Pattern catalogue

Phase 1 is deliberately the set whose geometry is unambiguous.

| Pattern | Deterministic rule | Must be measured and shown | Phase |
|---|---|---|---|
| Trendline — ascending support | Line through ≥3 swing lows, R² ≥ threshold, positive slope | touches, R², first/last touch, invalidation = close below | 1 |
| Trendline — descending resistance ("descending action line") | Line through ≥3 swing highs, negative slope | same | 1 |
| Parallel channel (ascending / descending / horizontal) | Two lines, slopes equal within tolerance, ≥2 touches each side, no closes outside beyond tolerance | touches per side, width, slope, which side price sits on | 1 |
| Range box | Horizontal high and low, ≥k touches each, slope ≈ 0 | touches, range height, time in range | 1 |
| Bull flag | Impulse leg (≥N candles, ≥X% move up) followed by a channel whose slope is negative and whose height is a fraction of the impulse | impulse size, flag slope, breakout level | 2 |
| Bear flag | Mirror of the above | same | 2 |
| Rising / falling wedge | Two converging lines, slopes the same sign | convergence rate, apex distance | 2 |
| Triangle — symmetric / ascending / descending | Two converging lines, slopes opposite sign or one flat | same | 2 |
| Double top / double bottom | Two peaks within a price tolerance and a minimum time separation, with a neckline | peak gap, neckline, tolerance used | 3 |
| Head and shoulders | Three peaks, centre highest, shoulders within tolerance | each peak, neckline | 3 |

Anything that does not clear its thresholds **is not drawn**. "No clean structure on this timeframe
right now" is a correct and shippable answer, and it is the honest one. Drawing a weak line because
the user pressed a button is how a tool loses its credibility in one session.

---

## 4. Multiple timeframes

The owner's point — higher timeframe carries more weight — is the design, not a footnote.

- Detection runs on a fixed ladder: **1W, 1D, 4H, 1H, 15M.**
- Every structure carries its source timeframe, and confidence is weighted by it. A weekly trendline
  with four touches outranks a 15-minute one with four touches.
- **Default render is the user's current timeframe plus any higher-timeframe structure whose price
  range is inside the visible window.** The daily trendline drawn on the 15-minute chart is the one
  that is actually worth money; a 15-minute line on the weekly chart is noise.
- Each overlay is labelled with the timeframe it came from. An unlabelled line is a line the user
  cannot judge.
- When timeframes disagree (4H says descending channel, 1D says ascending support), **both are
  shown and the disagreement is stated.** Silently picking a winner is the product lying about its
  own confidence.

---

## 4a. THE LADDER MUST NOT BECOME A RANGE WALK — a hard constraint, found by Dev on review

**This is the one place where this proposal's own design would reintroduce a dependency that §1
claims it does not have, and it sits on the path the design most needs.** Recorded as a named
constraint rather than a footnote, because a reader who skims §1 will take the failover as given.

The §1 claim — that this feature does not depend on Binance — is true for a **live chart**, which
asks for the most recent N candles. That is a fixed-limit request and it fails over to Bybit.

**It is not true for a range request.** `lib/klinesFailover.ts:39`:

```ts
export function canFailoverForRequest(isRange: boolean): boolean {
  return !isRange;
}
```

`app/api/market/klines/route.ts:380-384` gates the Bybit fallback on it, so **a range request that
fails on Binance returns a 502 and nothing else.** That is deliberate, and it is this project's own
rule: never splice exchanges inside one candle series, because a series that is Binance for pages
1–3 and Bybit for page 4 carries a seam invisible to any indicator computed over it.

**A timeframe ladder reading history is exactly the shape that becomes a range walk.** Fitting a
weekly trendline needs enough weekly candles to put a line through three or more pivots — the
paginated-backfill pattern `lib/backtestEngine.ts` already uses, on the one path with no fallback.
So the structure detector would be the first consumer to depend on a single exchange with no second
source, and the deterministic half of the feature — which §2 argues is its main virtue *because* it
cannot hallucinate — would inherit a single point of failure instead.

### The constraint

**Fetch each rung of the ladder as its own fixed-limit request, never as a range.** One request per
timeframe for the most recent N candles of that timeframe, N being whatever the pivot detector
needs. That keeps the Bybit failover on every rung **and** keeps the no-splicing rule, because each
rung is one atomic request answered entirely by one exchange.

**It also bounds the ladder's depth to what a fixed-limit request returns**, which is a real design
limit and belongs in the Phase 2 estimate rather than being discovered mid-build. If a rung needs
more history than one request can return, that rung needs an explicit decision about which exchange
owns it — not a quiet range walk.

**How this was missed, since the pattern matters more than the instance:** §1's table said "Bybit
failover on any non-2xx". That was the behaviour I had checked for the live chart, generalised to
every request shape without reading the gate that qualifies it. The same shape as reading one
Supabase project's region and generalising to the account — on the same day, in the same document
set. Caught by Dev reading the failover's gate rather than its summary.

---

## 5. Honesty requirements — non-negotiable

Every structure the product draws carries, visibly:

- the **timeframe** it was measured on
- **touch count** and **fit quality**
- **first and last touch** time, so the user can see whether it is live or stale
- the **invalidation price** — the level at which this structure is void
- its **age**

And the two standing rules apply unchanged:

- The UI says "AI". It never names the vendor or the model (`docs/OWNER-RULES.md`).
- No price prediction, no "buy here", no auto-trading. The feature **labels and draws what is
  measurable** and says what would break it. Tracker for the honesty-labelling work this inherits:
  `#1631`.

---

## 6. Cost

- Steps 1–3 are pure math. **Zero AI cost**, zero network beyond the candles we already fetch.
- Step 4 is one AI call per `(coin, timeframe ladder, structure-set hash)`, cached. Unchanged
  structures reuse the cached read, so panning and re-opening the panel cost nothing.
- Reuses the existing Pro gate and the existing usage meter. **No new vendor, no new subscription.**
- The decider stays the same one as every other AI feature here: cost per call against the margin
  recorded in `docs/PRICING_AND_LIMITS.md`.

---

## 7. Build order

Estimates come from Dev, not from PM. This is sequence only.

| Phase | Deliverable | Notes |
|---|---|---|
| 0 | `lib/chartStructures.ts` — pivots, line fit, fit quality. Pure functions. | QA writes the fixture tests (QA owns every test). No UI. |
| 1 | Trendlines, parallel channel, range box — current timeframe, rendered as locked overlays | The proof the render layer works |
| 2 | Flags, wedges, triangles + the multi-timeframe ladder | The owner's headline ask |
| 3 | AI read layer + caching, wired into deep research | Needs the honesty labels from `#1631` |
| 4 | Double top/bottom, head and shoulders | Highest tolerance-tuning cost, lowest certainty |

Phases 0 and 1 are worth shipping on their own: deterministic structure detection with no AI call is
already a feature competitors charge for, and it is the part that can never hallucinate.

---

## 8. Open questions for the owner — not blocking, answer when convenient

1. **Auto-draw or offer? — ANSWERED BY THE OWNER, 2026-10-30, and this one was never ours.**
   **A list; nothing is drawn until the user taps it.** He was shown three options with mock-ups
   (list-then-tap; draw everything at once; draw the strongest and list the rest) and chose
   list-then-tap, which was also the recommendation. **This is a Phase 1 requirement now, not a
   preference:** the chart stays untouched until a tap, and a structure that is never tapped is
   never drawn. It was put to him rather than decided here because it is visual, and this project
   built the Arena redesign three times on sessions deciding for themselves what he would accept.
2. **Pro-only? — DECIDED, not asked: Pro.** Deep research is already Pro-gated server-side in
   `app/api/strategy-research/route.ts`, so keeping it there is the existing behaviour rather than
   a new choice, and it is not a visual decision. Asking him would have been asking him to confirm
   what the code already does.
3. **Phase 0+1 alone, early?** The deterministic half with no AI could ship well before the rest.
   *Recommendation: yes, once paying users exist and the queue clears.*

---

## 9. Why this is a strong bet for us specifically

Hand-drawn structure is the single most common thing a retail trader does on a chart, and it is the
thing they are least consistent at. We already hold the candles, the chart, the AI access and the
paywall. The honest version of this feature — measured geometry, labelled timeframe, stated
invalidation, and silence when there is nothing clean — is also the version nobody else ships,
because everyone else lets the model make the levels up.

**Related:** `#1263` (Arena tracker), `#1631` (AI honesty labels), `#1651` (data integrity),
`#1592` (roadmap, parked until paying users), `#1662` (real liquidation levels proposal — same
"deterministic first, AI second" shape).
