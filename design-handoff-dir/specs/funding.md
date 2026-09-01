# Funding — `Funding.dc.html · 4b`

**Fidelity:** colour rules read from `components/FundingTerminal.tsx` directly. No separate structural terminal component beyond styling — safe to spec against source as-is. **Correlation is not part of this screen** — see `/correlation`, a separate unbuilt route (`components/CorrelationTerminal.tsx` exists at its own path).

## Source
Frame: `Funding.dc.html · 4b` (renamed from `Funding + Correlation.dc.html` — no correlation content exists on this route). Route `/funding`.

## Colour is data

**`frColor(rate)` — the base funding-rate colour, used on the sparkline, the list table, and the detail chart's "now" badge:**
```
rate >= 0.05%   → --red      (crowded long, warning)
rate <= -0.03%  → --green-2  (crowded short, warning in the other direction)
otherwise       → --txt-dim
```

**`frSignal(rate)` — an 8-tier signal ladder, richer than the 3-tier `frColor`, used on signal chips and the detail banner:**
```
p >= 0.05    longs_overcrowded  → --red
p >= 0.02    longs_heavy        → --orange
p >= 0.01    longs_dominant     → --amber
p >  0.003   slight_long        → #d4b483 (a named hex, not a token — flag, don't rename)
p >= -0.003  balanced           → --txt-dim
p >= -0.01   shorts_dominant    → --green-soft
p >= -0.03   shorts_crowded     → --green-2
else         shorts_overcrowded → --green-2 (same token as shorts_crowded, different bg alpha — 0.13 vs 0.09)
```
This is a 5-value directional ladder (2 red-family, 1 neutral, 2-green-family-with-a-repeat), not a 3-value fire/quiet split — every tier is real and must render distinctly except the two green tiers, which share a colour but not a background.

**Regime-overview summary chips.** Three fixed-purpose counts, each its own colour regardless of count value: contrarian-short count `--red`, contrarian-long count `--green-2`, carry-arb count `--accent`. These are **not** graded by magnitude — a count of 1 and a count of 20 render the same chip colour.

**Coin regime rows** (the scrollable list inside the overview panel). Row accent = that coin's `frSignal` colour. Badge suffixes are independent booleans, not mutually exclusive: a single coin can show a "SHORT" contrarian badge (`--red` bg/text) or a "LONG" contrarian badge (`--green-2`) or an "ARB" badge (`--accent`) — check the source's `contraShort`/`contraLong`/`carryArb` conditions, not a single derived state.

**Market-lean summary bar.** `longCnt` (funding >0.003%) → `--red`, `shortCnt` (<-0.003%) → `--green-2`, `neutralCnt` → `--txt3` label / `--txt2` count. Three independent tallies across all tracked coins, must sum to total.

**Table row highlight.** Unselected rows carry a left inset shadow in that row's `frSignal` colour at 44-alpha — a quiet per-row accent, not a background fill. Selected row gets the `.on` treatment (full highlight), which is state, not data.

**Detail chart.** Positive funding fills red (`rgba(248,113,113,...)`), negative fills green (`rgba(52,211,153,...)`) — both as area fills under/over the zero line, plus a single white-ish stroke line (`rgba(255,255,255,.75)`) through all points regardless of sign. The stroke is neutral; only the fill is directional.

**Extreme-count badge** (detail header). Shows only when `stats.extremes > 0` (a count of points where `|rate| > 0.001`), coloured `--amber` — a frequency warning, independent of the current rate's own colour.

## Acceptance criteria
1. `frColor` and `frSignal` produce **different granularity** — verify a rate of exactly 0.012 (frColor: `--txt-dim`, since between -0.03 and 0.05) renders `--amber` under `frSignal` (`longs_dominant`, since ≥0.01) — the two must not be conflated into one 3-value system.
2. The 5th ladder tier (`slight_long`, `#d4b483`) renders as its own visually distinct colour, not coerced to a token.
3. `shorts_dominant` and `shorts_crowded`/`shorts_overcrowded` are visually distinguishable by background alpha even though 2 of the 3 share `--green-2` text.
4. A coin can show 0, 1, or 2 badges simultaneously (SHORT/LONG are mutually exclusive per source logic, ARB is independent) — verify a coin with both an ARB badge and a directional badge renders both.
5. Market-lean bar's three counts sum to total tracked coins.
6. Detail chart fill switches red/green per point sign; the connecting stroke line does not change colour.
7. Extreme-count badge is absent when `extremes === 0`, not rendered as "0 extreme readings."
8. Every colour is from the confirmed palette or a flagged non-token hex (`#d4b483`) kept as-is.
9. No correlation matrix, tab, or second dataset renders anywhere on this screen.
10. Radius per `radius-ruling.md`.

## Out of scope
`/correlation` — separate screen, separate spec, not yet built. The canvas search/table/chart's own internals beyond colour (already structurally sound per source).

## Could not determine
Whether `#d4b483` and the repeated `--green-2` (two different alpha backgrounds sharing one text colour) are intentional design choices worth a dedicated token, or a source-side inconsistency design should flag upstream. Recorded, not resolved.
