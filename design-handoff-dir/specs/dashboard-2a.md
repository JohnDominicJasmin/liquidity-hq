# Dashboard — `Dashboard 2a.dc.html · 2a`

Scoped per QA's request: colour-is-data rules and acceptance criteria. Geometry is measurable directly off the canvas; this covers intent, which isn't.

## Source
Frame: `Dashboard 2a.dc.html · 2a`. Route `/dashboard`, terminal branch: `components/DashboardTerminal.tsx` (not `app/dashboard/page.tsx` — that file returns `<DashboardTerminal/>` early at line 519 and everything below it is the non-terminal branch). Supersedes the coin-table version — see `dashboard-restructure-finding.md`.

Colour rules below are read from `DashboardTerminal.tsx` source, not inferred from the frame's fixture.

## Intent
Main column answers "what should I do right now, for the coin I'm looking at." Rail answers "which other coin should I look at instead." The two must not swap jobs — a wide coin table does not belong in the main column; a six-panel signal breakdown does not belong in the rail.

## Colour is data

**Market read banner.** Verdict string takes the read's colour: bullish `--green`, bearish `--red`, neutral/mixed `--txt2`. Not hardcoded — the frame shows one fixture (`RISK-ON, CAUTIOUS` → green); production must switch.

**Coin signals (6 cards, mirrors Arena's evidence rule).** `fire` is a field on the data:
```
fire = 'green' → value --green   fired as confirmation
fire = 'red'   → value --red     fired as warning
fire = null    → value --txt     did not fire, regardless of sign
```
In the frame, 3 of 6 fire (2 green, 1 red); 3 are quiet and include a positive number (`OI 1h +2.31%`) that stays `--txt`. Same trap as Arena: colouring quiet positives green passes every automated check and is wrong.

**Best-setup-today bar.** Confidence fill matches the verdict's colour, not a fixed green — a bearish best setup still shows in `--red`.

**Sidebar coin rows.** `chgCol` is the ticker exception (sign→colour is legitimate for a price change, per the landing spec's precedent). `sigCol` follows the fire rule above, independent of `chgCol` — a coin can be up in price and still carry a red signal (crowded funding), and the two must be free to disagree.

**Grade badges (`A−`, `B+`, etc).** `computeCoinHealth()`'s banding is not in the reviewed source excerpt — **could not confirm**; do not build the "never red" claim from the earlier draft as measured. Flagging rather than asserting.

**Taker-flow bar under each sidebar row — threshold corrected.** `tbp >= 60 → --green`, `tbp <= 40 → --red` (not 42), between → a **hardcoded `#404040`**, not a token. That hex is in the source as-is; it's a pre-existing inconsistency in the codebase, not something to fix in this spec — flagging so dev doesn't "correct" it to a token and drift from what's actually there, or alternatively raise it as its own small ticket.

**Coin signal cards (main column, 6 cards) — corrected, tiered not binary.** Several use a 5-value ladder, not just fire/quiet:
```
Funding:      frPct >= 0.05 → --red   |  >= 0.01 → --red-soft
              <= -0.03 → --green      |  <= -0.005 → --green-soft   | else --txt2
CB premium:   cbPct >= 0.05 → --green | <= -0.05 → --red             | else --txt2
OI trend:     strong_up → --green | strong_down → --red
              weak_up → --amber   | weak_down → --txt3
VWAP:         above → --green | below → --red | unknown → --txt3
Squeeze score: SHORT_SQ → --green | LONG_LIQ → --red | else --txt-dim
```
`--amber` and the `-soft` variants are real, distinct tokens in this codebase (`app/globals.css`), not a design invention — add `--amber` to the palette; it isn't in the current 15/16-token README list. Confirm its dark hex (`#fbbf24` in the file I read) and light hex (`#8F4508`, the app's own `[data-theme="light"]` override) with design before the token table ships.

**Sidebar signal tag (`sig`) — corrected, it's a priority cascade, not independent fields.** One signal string wins per coin, checked in this order until one matches: funding extreme → CVD divergence → OI trend (strong) → chart pattern → OI trend (weak) → funding (graded). Each stage has its own colour from the ladders above. The row shows **exactly one** signal, never a combination — don't design a multi-badge treatment for this cell.

**Market conditions grid.** Each row's colour is independent per condition — "Breadth: NARROW" is `--red` while "Liquidity: GOOD" is `--green` in the same fixture. Do not apply one colour to the whole panel based on overall sentiment.

**Cascade alert banner — corrected, it is 3-state by side, not warning-only.**
```
side = 'LONG'  → --red    (longs are cascading — warning)
side = 'SHORT' → --green  (shorts are cascading — the move favours longs)
side = neutral → --amber
```
A long cascade and a short cascade are opposite outcomes for the reader; collapsing both to red would tell them the same thing happened either way. If no cascade is active, the banner is **absent** (component returns `null`), not rendered empty.

## Pro gating
None on this screen today (per source `app/dashboard/page.tsx` — no `entitled` check found in the reviewed sections). If dev's implementation finds one, flag it back rather than assume free/Pro parity.

## Acceptance criteria
1. Main column renders, top to bottom: market read banner, best-setup bar, selected-coin header, 6 signal cards, next-events + market-conditions split.
2. Rail renders: coin list (uncapped, "+N MORE COINS" footer), pulse strip, perp/spot line, macro backdrop.
3. No coin table renders anywhere on this screen.
4. Exactly the fired subset of the 6 signal cards computes `--green`/`--red`; the rest compute `--txt`, including any positive-valued quiet ones.
5. Verdict text colour matches a bearish fixture when the read is bearish (not hardcoded green).
6. Grade badges never compute `--red`.
7. Cascade banner is absent from the DOM when no cascade is active (node count 0, not `display:none`).
8. Every element computes `border-radius: 0px`.
9. All colours are from the 15-token palette in `lib/terminalTokens.ts`.

## Out of scope
Mobile geometry beyond what's drawn; onboarding/empty-portfolio state; the "SetupChecklist" and floating-toast versions of the cascade banner (production shows both — this spec covers the persistent banner state only, flagged as a could-not-determine).

## Could not determine
Whether `SetupChecklist` (first-run) and the cascade banner can both be visible simultaneously, and if so their stacking order.
