# Markets — `Markets.dc.html · 3a`

**Fidelity:** measured against `components/MarketsTerminal.tsx` (the terminal branch — not `app/markets/page.tsx`, which returns early at its own `mode === 'terminal'` check and renders the non-terminal branch below that line). Two column claims in the frame are corrected below, not measured from it.

## Source
Frame: `Markets.dc.html · 3a`. Route `/markets`.

**Correction to the frame's own column set.** The frame draws `funding` and `oi` as their own columns. `MarketsTerminal.tsx` has neither — funding only surfaces indirectly through `topSignal()`'s signal string. Building those two columns as drawn would show data the component doesn't have; drop them.

**Missing from the frame, present in source:** search input, 5 sort buttons (volume/change/grade/signal/name, each togglable asc/desc), a bull/bear/neutral count strip in the header, and bottom pagination (20 rows/page). These are not decoration — sort state changes row order and pagination changes what's mounted.

## Layout
Single centered column, `max-width: 860px`, not a full-width 1440 table. Sticky header at `top: 52` (the app shell's own header height, not measured from this frame). Row grid: `48px 1fr 40px 96px 58px 92px 1fr` (grade / coin+spark / spark / price / 24h / pressure / signal).

## Colour is data

**Grade badge.** Five-band, not the frame's implied 2-tone:
```
A → --green-2 tint (rgba(52,211,153,.15) bg)
B → --accent-2 tint (rgba(96,165,250,.15) bg)   — a DISTINCT blue-accent token, not --accent
C → #f59e0b tint (rgba(245,158,11,.15) bg)      — hardcoded hex in source, not a named token; flag rather than invent a name
D → --red tint (rgba(248,113,113,.15) bg)
F → --red tint (rgba(239,68,68,.15) bg) — same token as D, different bg alpha
```
`--accent-2` and the C-band hex are both real per source and neither is in the current 16-token README list — flag to design rather than silently mapping to `--accent`/`--amber`.

**Signal string** (`topSignal()`, priority cascade, first match wins):
```
funding >= 0.04%        → --red    "longs overcrowded"
funding <= -0.02%       → --green-2 "shorts squeezed"
cvd divergence bullish  → --green-2 "smart buyers"
cvd divergence bearish  → --red    "smart sellers"
oi strong_up            → --green-2 "new buyers"
oi strong_down          → --red    "new sellers"
oi weak_up              → --amber  "short covering"
oi weak_down            → --txt-dim "longs exiting"
none of the above       → --txt-dim "-"
```
Same shape as every other screen's evidence rule: only the fired cases carry colour, the fallback is dim, and direction is not sign — funding *crowded* (positive) is red, funding *extreme-negative* is green.

**24h change.** Sign-to-colour, the ticker exception: `up → --green-2`, `down → --red`.

**Pressure bar + bottom accent line.** `tbp >= 55 → --green-2`, `tbp <= 45 → --red`, else `#555` (hardcoded, not a token — flag, don't rename). The bottom accent line under each row is the same colour at `opacity: 0.2` — it's a restatement of the pressure bar's colour, not an independent signal.

**Header count strip.** Bull count `--green-2`, bear count `--red`, neutral count `--txt3`. Counts partition all tracked coins — they must sum to the total; if they don't, that's a bug in the count logic, not a design question.

## Acceptance criteria
1. Column layout is 7 cells: grade, coin+badge, sparkline, price, 24h change, pressure bar, signal. No funding or OI column exists.
2. Grade badge renders one of 5 distinct bg/col pairs; D and F share `--red` text but different bg alpha.
3. Row order changes when a sort button is clicked; clicking the active sort button reverses direction (arrow flips).
4. Exactly one sort button shows the active-state border/bg/text treatment at a time.
5. Search input filters rows by case-insensitive substring match on coin id.
6. Pagination shows ⌈rows/20⌉ page buttons; clicking a coin row navs to `/arena?coin={id}` (not `/arena` bare — the id must be in the URL).
7. Header count strip's three numbers sum to the total tracked coin count.
8. A row with no fired signal (`topSignal` falls through to `none`) renders `-` in `--txt3`, not empty and not a zero.
9. Every element computes `border-radius: 0px`.
10. All colours are from the confirmed palette, OR are one of the two flagged non-token values (`--accent-2`, the C-band `#f59e0b`) pending design confirmation.

## Out of scope
Sparkline's own rendering (owned by `Sparkline24h`, restyle its stroke colour only, don't rebuild its logic); loading skeleton beyond "renders 10 skeleton bars, radius 0, descending opacity" (already true per source).

## Could not determine
Whether `--accent-2` and the C-band hex are intentional additions to the terminal palette or leftover from the non-terminal theme. Needs a design-side answer before this spec's colour table can be called final.
