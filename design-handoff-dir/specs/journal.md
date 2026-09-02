# Journal — `Journal.dc.html · 5a`

Scoped per QA's request: colour-is-data rules and acceptance criteria.

## Source
Frame: `Journal.dc.html · 5a`. Route `/journal`. **Not rebuilt** — this is the original canvas, unlike Landing/Arena. One artifact found and flagged below; treat the rest as authored.

**Confirmed: no `JournalTerminal.tsx` exists.** `app/journal/page.tsx` renders the same `<TradeJournal/>` in both modes, only adding a `journal-term-wrap` class when `useDesignMode() === 'terminal'`. Unlike Dashboard, there's no separate terminal component to re-check this spec against — but the colour rules below are still read from the frame's fixture, not from `TradeJournal.tsx` source, so treat them with the same caution as before this correction round, not as newly source-verified.

**Artifact:** the logo carries `border-radius:5px` in both desktop and mobile headers (lines ~34, ~133-ish). Every other screen in this bundle uses `border-radius:0` on the logo per the design's own "radius is an absence" rule. This is a leftover from before that rule was applied consistently — **build radius 0**, not 5px.

## Intent
A trade log that grades itself. Every number here is a past outcome, not a live signal — so the colour rules are about **realized R, not market state**. That's the one thing to get right: green/red on this screen means "this trade won/lost," never "this signal fired."

## Colour is data

**Journal stat cards (6, header row).** Each `col` is driven by whether that metric is favorable, not by a fixed per-position mapping:
```
Win rate, expectancy, avg R, profit factor > breakeven → --green
same metrics ≤ breakeven → --red
Trade count, days-active (context, not a verdict)       → --txt
```
A profit factor of 0.8 must render `--red` even though it's a "normal-looking" number — this is the same trap as a positive-but-quiet signal elsewhere in the app: looking unremarkable is not the same as being neutral.

**Equity curve.** Single colour, `--green`, regardless of whether the curve is currently drawing down — it's a curve of realized R-multiples, not a live position. Do not recolor segments red on a dip; that would imply a live warning where there isn't one.

**By-setup breakdown bars.** Colour follows the realized R for that setup, at three tiers, matching the frame's own fixture:
```
R > +0.5   → --green
R between −0.2 and +0.5 (roughly breakeven) → --txt2 (neutral bar)
R < −0.2   → --red
```
The frame shows exactly this: two green setups, one neutral (`+0.2R`), one red (`−0.4R`). Do not make it a two-value (green/red) split — the neutral tier is deliberate and must survive.

**Trade rows — `sideCol`, `rCol`, `outCol`.**
```
side = LONG  → --txt2 (direction is not a signal, just a label)
side = SHORT → --txt2 (same — do not colour long green / short red)
rCol: r > 0 → --green,  r < 0 → --red,  r = 0 (scratch) → --txt2
outCol follows rCol's sign, independent styling (smaller, letter-spaced)
```
**Side is explicitly NOT colour-coded by direction.** A long and a short are equally valid trade types; colouring one green and one red would imply a directional bias the journal doesn't have an opinion on. Only the *result* (`r`, `pnl`) carries colour.

**Timeframe filter chips (30D/90D/YTD/ALL).** Active chip: `--bg0` text on `--accent` fill. Inactive: `--txt3`. This is state, not data — no green/red anywhere in this control.

## Acceptance criteria
1. Header renders 6 stat cards with independent favorable/unfavorable colouring — not all green or all red as a block.
2. A stat card with a sub-breakeven value (e.g., profit factor < 1) computes `--red`.
3. Equity curve is a single colour (`--green`) across its full length regardless of local drawdowns.
4. By-setup bars show at least 3 distinct colour values across the panel when the underlying data spans winning/neutral/losing setups (not a 2-value split).
5. No trade row's `side` cell computes `--green` or `--red` — long and short both render `--txt2`.
6. A scratch trade (`r = 0`) renders `--txt2`, not `--green` or `--red`.
7. `rCol` and `pnl` colour match each other on every row (same sign, same token).
8. Exactly one filter chip computes `background: --accent` at a time.
9. Logo `border-radius` computes `0px` (artifact fix — frame currently shows 5px).
10. Every other element computes `border-radius: 0px`.
11. All colours are from the 15-token palette.

## Out of scope
The trade-entry modal behind "+ LOG TRADE"; per-trade detail/annotation view; CSV export.

## Could not determine
Whether "by setup" categories are fixed or free-text/tagged by the user — affects whether the panel needs to extend past 4 rows.
