# What the canvases ask for that the product cannot currently produce

**Owner's question, 2026-09-03:** *"There are new data on the design handoff that does not exist on the past design right?"*

Yes. Repeatedly, and it has been discovered one issue at a time — which means it keeps getting re-derived by whoever hits it next. This is the register.

**Read this before building any screen against its canvas.** A canvas can specify layout. It cannot invent a data source, and it cannot silently overturn a product decision. Every row below is a place where building the frame literally would require one or the other.

## The owner's ruling on all of this, 2026-09-03

> *"We have 2 options either make it work or use it as reference meaning we dont need to put the correct data in there it might be different data but it will only happen if and only if the data propose on the handoff cant be achieved."*

So the order of preference is fixed, and it is not what this project has been doing:

1. **Make it work.** Build the data the canvas asks for. This is the default and it is tried first.
2. **Only if that genuinely cannot be achieved** — substitute *different* real data in that slot. The canvas becomes a reference for the *shape*, not a contract for the *content*.

**What this changes.** The prior habit was to leave an unachievable slot em-dashed and call it honest — "two honest bars beat four where half are invented." That was right about never inventing a number, and wrong about the conclusion: an empty slot is not the only alternative to a fabricated one. A **different real metric** in the same slot is better than a permanent em dash, because it keeps the layout the canvas designed *and* tells the user something true.

The line that does not move: **never fabricate.** Substituting a real measurement is not inventing one. A placeholder, a zero, or a plausible-looking number with no source behind it remains forbidden, and so does putting a *label* on data that doesn't match it — the mislabelling that #589 and the `Liq 24h`/`LIQ 15M` relabel were both about.

Every "No source" row below therefore now carries an open question it did not have before: **what real data should go in this slot instead?** Those are product calls, not QA's, and they are listed rather than answered.

---

The distinction that matters on every row is **why** it can't be built, because the four reasons need completely different answers:

| category | what it means | what to do |
|---|---|---|
| **No source** | Nothing in the codebase can compute it | Per the ruling above: propose a real substitute for the slot. Em dash only while that decision is outstanding — it is a holding state now, not an answer. |
| **Ruled against** | A prior product decision says no | Do not rebuild it because a frame draws it — amend the frame |
| **Needs new work** | Buildable, but requires new plumbing or a contract change | Own decision, own issue, own estimate |
| **Buildable now** | Data already exists, just not wired to that slot | Ordinary work, no decision needed |

---

## No source — the codebase cannot produce these

| what the canvas draws | where | why not |
|---|---|---|
| **`CB prem`** value | arena evidence, dashboard signals | No source has ever been wired. Renders an em dash **always**, by spec. |
| **`Liq 24h` / `LIQ 15M`** | arena evidence | No liquidation-*volume* feed exists. The only liquidation endpoint is `coinglass-liq`, a **heatmap** — different provider, window and shape — and `/api/version` reports `coinglass: false`, so it isn't configured either. |
| **Trend strength** bar | dashboard, Market conditions | No ADX-shaped computation anywhere in the codebase. |
| **Liquidity** bar | dashboard, Market conditions | No orderbook or depth data anywhere in the codebase. |
| **Entry / Stop / Target** | dashboard, Best setup today | No local computation produces them. Only Arena's per-request AI call does, and that result is unpersisted and not necessarily for the coin/timeframe on screen. |
| **`⌘K`** chip | shell nav, every terminal route | There is no command palette. Grepped for `cmdk`, palette, and the glyph — nothing. Omitted rather than shipping a keyboard hint for a shortcut that does nothing. |

**Three of the eight arena evidence rows are currently em-dashed** (`CB PREM`, `BASIS`, `LIQ 15M`), where the spec's acceptance criteria were written expecting one. Criterion 12's "2 of 8 rows carry colour" is therefore testable against only 5 candidate rows.

### Substitutes to decide on

Per the ruling, each of these needs a proposal rather than a permanent dash. Candidates below are **suggestions for the product owner, not decisions** — every one is real data already in the codebase, so none of them requires inventing anything:

| empty slot | real data that could fill it instead |
|---|---|
| `CB prem` | Coinbase premium is genuinely unavailable, but `store.cbPremiumPct` feeds the dashboard's own CB premium card — worth confirming whether that source can serve arena too, before substituting something else |
| `Liq 15m` | `store.btcLiqLevels` (cluster data) or the taker-flow ratio already rendered elsewhere |
| Trend strength | RSI-based multi-timeframe bias — `MultiTFAlignment` already computes it across 15m/1h/4h |
| Liquidity | Taker buy/sell ratio (`takerBuyRatio`), already used for the sidebar pressure bars |
| Entry / Stop / Target | Nothing local produces trade levels. The honest substitute may be a different *kind* of row entirely rather than three empty level cells |

**These are the "what goes there instead" questions the ruling creates. They are product decisions and they are open.**

## Ruled against — a prior decision says no, and the frame is what changes

| what the canvas draws | where | the decision |
|---|---|---|
| **`Basis +0.18%`** | arena evidence | Removed from computation on **#343**. `lib/perpSpot.ts` returns `OHLCVLike`, which deliberately carries **no price field**, with a comment saying price cannot enter "without someone widening it deliberately" — added specifically to stop this returning. |
| **"Spot leading perp by +0.18%"** | dashboard rail | Perps-vs-spot measures **volume**, not price — the owner's own words in the source, twice. Ruled on **#588**; the canvas copy was amended to describe the volume relationship instead. Both `Dashboard 2a` variants updated in the repo *and* in the live design project. |

These two are the reason the register exists. Building either "because the canvas draws it" would have used a frame to reverse a decision the owner made deliberately.

## Needs new work — buildable, but not for free

| what the canvas draws | where | what it needs |
|---|---|---|
| **Headline, meta row, section heads** | briefing main column | `/api/briefing`'s system prompt says *"no bullet points, no headers"*, so the three section heads and the 32px headline have no source **by instruction**. Needs an output-contract change (prose blob → `{headline, meta[], sections[{head, body}]}`) affecting **both designs**, since they share the endpoint. Built once on a branch, then parked — **#620**. |
| **Levels rail + 220px candle chart** | briefing rail | Neither `/briefing` route has levels data or any chart. Every piece exists elsewhere (`computeFibLevels`, `store.btcLiqLevels`, `KLineProChart`), so it is plumbing rather than invention — but it is real work, and which four levels belong there is a product choice. **#620**. |

## Buildable now — data exists, just not wired

| what the canvas draws | where | source |
|---|---|---|
| **24h volume** | arena snapshot band | `CoinData.vol24` |
| **24h range** | arena snapshot band | `CoinData.high` / `CoinData.low` |
| **Next funding** countdown | arena snapshot band | `nextFundingTime` (unix ms of next settlement) |

Tracked on **#631**. Listed here only so nobody files them alongside the rows above — these need no decision, just building.

---

## The canvases are also wrong in places, which cuts the other way

Worth stating plainly, because "mirror the canvas" is the standing instruction and these are the exceptions to it.

- **The light frames are stale on colour.** They still draw pre-#559 tokens — `--txt3 #6a6e73` (4.237:1) and `--red #cf222e` (4.420:1) — which design has since moved to `#5e6267` (5.069) and `#9d1a23` (6.651). **Mirroring those hexes literally would regress accessibility.** Measured by `qa/canvas-contrast.mjs`; 15 occurrences in the dashboard light frame, 30 in arena's.
- **The canvas can specify a contrast failure.** Its grade-badge rule tints green text with green at 15%, which measures 4.171 / 3.886 in light — below AA. Built at 3% instead, knowingly. Same shape as #559's amber. **AA beats literal fidelity**; that is not a judgement call, it is what #559 already established.
- **A canvas can carry a leftover.** `Journal.dc.html`'s logo has `border-radius: 5px` against the design's own "radius is an absence" rule. Build 0.

## Still unanswered by anyone

Colour values the specs flagged and nobody has ruled on: `--accent-2` and the C-band hex (markets), `#d4b483` and the duplicated `--green-2` (funding), and the five non-token category hexes in the alerts dot table. Each is "is this an intentional addition to the palette or a leftover" — recorded, not resolved.

---

*Kept by QA. Add a row when a canvas asks for something the product cannot produce, and say which of the four categories it is — the category is the useful part, not the list.*
