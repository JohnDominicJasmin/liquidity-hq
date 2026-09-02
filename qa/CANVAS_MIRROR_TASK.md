# Canvas mirror — every screen matches its handoff canvas

**Set by the owner on 2026-09-02.** Long-running. Read this before touching any
redesign screen.

---

## 1. The requirement, in the owner's terms

He put `/dashboard` next to `design_files/Dashboard 2a.dc.html` and they were
plainly different screens. What he wants is **exactly what is in the design
handoff, mirrored, when he compares the two.**

Not the current UI with terminal colours applied. Not "the same sections in the
same order". The screen in the canvas.

> **This overrides `specs/dashboard-restructure-finding.md`.** That note framed
> frame 2A as a *restyle* of production's structure — production's components,
> restyled. The owner has reversed that: **the canvas is the target and
> production matches it.**

---

## 2. Why a full session of QA did not catch it

Recorded plainly because the same trap will be available on every screen.

The conformance checker derived its expected sections **by reading the rendered
page**:

```js
{ name: 'market read',  re: /market read/i },
{ name: 'best setup',   re: /best setup/i },
{ name: 'signal cards', re: /coin signals/i },
```

Those strings were taken off the implementation. So C1 and C2 confirmed the page
matched *itself*, and passed. **A test whose expectations come from the thing
under test cannot fail.**

Consequence: every colour, contrast, radius, tap-target and dialog PASS reported
on 2026-09-02 is a statement about **the current layout**, not about conformance
to the design. That work is still valid and still needed. It was never an answer
to "is this the designed screen", and it was not labelled as such.

**Rule going forward:** expected values come from the canvas, the spec or a
ruling. Never from the running system. Before writing a check, say where each
expected value came from; if the answer is "the page", stop.

---

## 3. Build target

`app/dashboard/page.tsx:519` — `if (mode === 'terminal') return <DashboardTerminal />;`

So **`DashboardTerminal.tsx` is what gets rebuilt**; everything below that line
is the non-terminal branch and stays as the current design. Expect the same
split on other routes — find the terminal component, not the page.

---

## 4. Branching — one per screen, isolated

Owner's instruction: every screen gets its **own** branch so they are separable.

```
feature/dashboard-canvas-mirror
feature/landing-canvas-mirror
feature/arena-canvas-mirror
…
```

**Do not batch these.** One screen, one branch, one PR. A screen must be able to
land, be reviewed, or be reverted without dragging the others.

This is a deliberate exception to the batching preference that governs ordinary
fix work.

---

## 5. `/dashboard` — the known gap

Canvas `Dashboard 2a.dc.html` vs live, dark:

| section | canvas | live |
|---|---|---|
| ticker | horizontal sym/px/chg strip, 34px | **absent**; coins are a vertical right rail |
| market read | mono 24px/700 verdict + one 12.5px sub-line, max-width 680 | headline + `59/100` gauge + 5 stat boxes |
| best setup | `BTC · LEAN BULLISH · 68`, 3px bar 68% filled, E/S/T levels | `PLAYBOOK #3 of 55` + prose + "new play" |
| selected coin | price row **+ `OPEN ARENA →`**, 26×26 coin mark | price row, no Arena action |
| coin signals | `grid-template-columns: repeat(3,1fr)`, label/value/sig | 6 cards, different labels and layout |
| market conditions | 4 labelled bars (Volatility, Trend strength, Breadth, Liquidity) | Fear & Greed semicircle dial |
| next events | rows, 2px × 24px colour bar, padding 10px 20px | Economic calendar, dated rows |
| rail header | `Coins · 3 FIRING · 28 →` | none |
| rail footer | `+21 MORE COINS` | `+43 more coins` |

Canvas shell geometry, read off the file:

```
frame        1440×1080, background #08090a, 1px #1f2225 border
nav          height 44, border-bottom 1px #1f2225, padding 0 16px, gap 28
ticker       height 34, border-bottom 1px #1f2225, IBM Plex Mono
cascade      height 36, border-bottom 1px #1f2225 (conditional)
main column  flex:1, border-right 1px #1f2225
section hdr  height 28, padding 0 20px, border-bottom 1px #1f2225
coin row     padding 12px 20px, coin mark 26×26, 1px #5e646b
event row    padding 10px 20px, gap 11, 2px × 24px colour bar
```

The cascade banner is **not** a gap: the canvas shows its active state, and
`dashboard-2a.md` C7 requires it absent when no cascade is firing.

---

## 6. `/dashboard` — canvas-sourced criteria, current state

`spec-conformance.mjs` now extracts C1/C2's section names from the canvas at
runtime. On `838471c` it correctly fails:

```
C1 main column [canvas-sourced]  4/5  MISSING "Next events"
C2 rail        [canvas-sourced]  1/2  MISSING "Macro backdrop"
```

Both are real renames: the live page renders **"Economic calendar"** where the
canvas says *Next events*, and **"Global Macro Context"** where the canvas says
*Macro backdrop*. Section naming is part of mirroring — a section that is
present under a different name is not the designed screen.

Known gap in the extraction: *Perp vs spot*'s label does not carry
`font-size:10px`, so C2 checks 2 rail sections rather than 3.

---

## 7. Tooling, and what it cannot tell you

`qa/canvas-diff.mjs` — pulls the static labels out of each `.dc.html` (skipping
`{{ handlebars }}`, which are data placeholders) and reports which the live
route does not render.

> **A clean result means "nothing obviously absent". It never means "matches the
> design".** The script finds missing and renamed things. It cannot see
> "present but built differently", which is most of the `/dashboard` gap — the
> section names largely match and the contents do not.

Anything stronger needs a per-section geometry comparison against the canvas,
which does not exist yet.

`qa/spec-conformance.mjs` and `qa/landing-conformance.mjs` **still carry
page-derived expectations in places** and are being rewritten to read from the
canvases. Until that lands, treat their section-level passes as unproven.

---

## 8. Status

Original measurement below is `qa/canvas-diff.mjs` on `838471c`, 2026-09-02
morning, canvas sample data excluded. Full output:
`qa/reports/canvas-diff-838471c.txt`. **Three rows are now stale** — dashboard,
landing (`/`) and arena went through full mirror work the same day, each
independently verified live (dark+light, desktop+mobile) on the deployed
build, not re-measured by the script. See #587/#598/#603/#604/#605/#607/#609/
#610/#611/#615 for the trail. Not re-running canvas-diff.mjs on them — it
cannot see "present but built differently" per §7, so a fresh percentage would
undersell what live verification already confirmed and oversell what it can't
check (structural correctness, colour-as-data rules, states).

| route | canvas labels present (838471c) | branch | status, 2026-09-02 |
|---|---|---|---|
| `/learn` | 3/5 — 60% | `feature/learn-canvas-mirror` | untouched |
| **`/`** (landing) | ~~25/49 — 51%~~ | `feature/landing-canvas-mirror` | **done, deployed, verified live** |
| `/econ-calendar` | 10/21 — 48% | `feature/econ-calendar-canvas-mirror` | untouched |
| `/liq` | 9/20 — 45% | `feature/liq-canvas-mirror` | untouched — has a spec (`liquidation-map.md`) |
| `/calc` | 4/9 — 44% | `feature/calc-canvas-mirror` | untouched |
| `/news` | 3/8 — 38% | `feature/news-canvas-mirror` | untouched |
| `/about` | 5/15 — 33% | `feature/about-canvas-mirror` | untouched |
| **`/dashboard`** | ~~8/26 — 31%~~ | `feature/dashboard-canvas-mirror` | **done, deployed, verified live** — one open colour gap, #614 |
| `/faq` | 3/10 — 30% | `feature/faq-canvas-mirror` | untouched |
| `/disclaimer` | 4/14 — 29% | `feature/disclaimer-canvas-mirror` | untouched |
| `/markets` | 2/8 — 25% | `feature/markets-canvas-mirror` | untouched — has a spec (`markets.md`) |
| `/journal` | 3/13 — 23% | `feature/journal-canvas-mirror` | untouched — has a spec (`journal.md`) |
| `/alerts` | 3/13 — 23% | `feature/alerts-canvas-mirror` | untouched — has a spec (`alerts.md`) |
| `/offline` | 2/10 — 20% | `feature/offline-canvas-mirror` | untouched |
| **`/arena`** | ~~10/51 — 20%~~ | `feature/arena-canvas-mirror` | **done, deployed, verified live** — one open colour gap (#614, shared with dashboard), shell nav in progress (#616) |
| `/funding` | 3/19 — 16% | `feature/funding-canvas-mirror` | untouched — has a spec (`funding.md`) |
| **`/briefing`** | 2/17 — 12%, and this is probably generous | `feature/briefing-canvas-mirror` | **retracted the colour-fix assignment same day — real gap, see #620.** briefing.md's fidelity note compares terminal against production, never against the canvas; both share the same `mb-*` structure and neither has anything the canvas draws (headline+prose+levels rail+candlestick chart+CTAs vs the built page's setups/gauges/chips/news-feed). Zero section overlap, confirmed by reading the canvas directly, not the spec's note. Rebuild-sized, not a colour pass. |

**3 of 17 routes done as of 2026-09-02. 1 in progress. 13 untouched.
This is not close to finished — do not read three done screens as the
project being near done.**

### How to read these numbers

They are a **floor on the gap, not a measure of it**. Three reasons:

1. A label counts as present if the string appears anywhere on the page — so a
   section that exists but is laid out completely differently still scores as a
   hit. `/dashboard` is 31% and its *real* divergence is larger.
2. A renamed section reads as missing even when the equivalent content exists.
3. "Present but built differently" is invisible to this method entirely.

So: low percentage is reliable evidence of a real gap. A higher percentage is
**not** evidence of conformance.

### Not all of the gap is buildable as drawn

Confirmed on `/dashboard` by dev reading the components behind the canvas:

- **Entry/Stop/Target** — no local computation produces them; only Arena's
  per-request AI call, unpersisted. `dashboard-2a.md` never asks for them.
- **Market conditions' 4 bars** (Volatility / Trend strength / Breadth /
  Liquidity) — none of those metrics exist in the codebase. New quant work,
  requires definitions.
- **Perp vs spot** — canvas draws a price-lead percentage; the real component
  deliberately uses a volume ratio in `x` units per owner decision **#328**.
  Building the canvas literally would reverse a prior product decision.

**A canvas can specify layout. It cannot invent data or silently overturn a
product decision.**

### The perp-vs-spot ruling was given on an incomplete description — MINE

The owner answered "go all 3" against my summary, which described #328 as a
*presentation* choice: a metric shown in `x` units rather than a percentage.

Dev then read `lib/perpSpot.ts` and found something categorically stronger — the
owner's own words, **twice**, defining what perps-vs-spot *measures* on this
product ("that perps and spot is volume take note" / "perpetual and spot trading
volume"), a return type (`OHLCVLike`) that deliberately carries **no price
field**, and a comment stating price cannot enter "without someone widening it
deliberately", added specifically to stop a price version returning after #343
removed one.

**A ruling given without that in view is not a ruling on it.** Nobody had it —
not dev, not me, not him. Building the price-lead version on the strength of
"go all 3" would use his approval as cover for reversing a constraint he stated
twice and defended once.

**Status: not built. Goes back to the owner with the quote attached.** The
framing owed to him is that my summary was incomplete, not that he changed his
mind.

The other two of the three stand as ruled:
- **E/S/T** — omitted, no data source, reasoning in the code and the PR body.
- **Market conditions** — Volatility and Breadth built from real data
  (`lhq_vol_regime` cache; % of `store.coins` positive over 24h). *Trend
  strength* and *Liquidity* have no source in this codebase — no ADX-shaped
  computation, no orderbook or depth data anywhere — so those two bars are left
  out and documented. Two honest bars beat four where half are invented. Expect more of this on other screens; each needs a ruling,
not a build.
