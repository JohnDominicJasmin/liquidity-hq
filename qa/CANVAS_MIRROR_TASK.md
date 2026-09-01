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

## 6. Tooling, and what it cannot tell you

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

## 7. Status

| screen | canvas | branch | state |
|---|---|---|---|
| `/dashboard` | `Dashboard 2a` | `feature/dashboard-canvas-mirror` | gap documented, not started |
| `/` | `Landing 7a` | `feature/landing-canvas-mirror` | baseline #586, canvas diff pending |
| `/arena` | `Arena 1a` | `feature/arena-canvas-mirror` | not started |
| 14 other mapped routes | — | — | canvas diff running |

Scope is unknown until the route-by-route diff completes. If `/dashboard` is
this far from its canvas, others likely are too — nobody has checked, because
the audit could not see it.
