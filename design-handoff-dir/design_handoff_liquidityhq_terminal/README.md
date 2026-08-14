# Handoff: LiquidityHQ — Monochrome Terminal redesign

## Overview

A full redesign of LiquidityHQ (`JohnDominicJasmin/liquidity-hq`, branch `main`) in a new visual direction called **Monochrome Terminal**: a zero-hue near-black canvas, hairline dividers instead of cards, IBM Plex Mono for every number, and a single amber accent that appears only on the active nav item and the primary action.

31 screens are designed, each at desktop (1440×900) and mobile (390×844) unless noted. The redesign also changes information architecture: the app's 25 routes collapse to **five destinations** (Overview, Arena, Scan, Flow, Book), with the former scanner/tool routes becoming in-page tabs.

## About the design files

The files in `design_files/` are **design references created in HTML** — prototypes showing intended look and behaviour, not production code to copy. Each `.dc.html` file is a design canvas holding many device frames side by side; the frames are fixed-size `div`s, not responsive pages.

The task is to **recreate these designs inside the existing Next.js codebase** (App Router, React 19, TypeScript, CSS custom properties in `app/globals.css`), using its established patterns: `useMarket()` / `marketStore`, `useLabels()` for copy, `useSettings()`, `withAlpha()` from `lib/color.ts`, the icon set in `components/icons.tsx`. Do not port the HTML or its inline styles directly, and do not introduce a new styling approach — move these values into the existing token layer.

## Fidelity

**High fidelity.** Colours, type sizes, spacing, row heights and copy are final. Recreate pixel-accurately. Every value below was measured in the prototypes.

Two caveats:
- Data is realistic mock data built around one scenario (BTC/USDT perp, 4H, "Lean bullish", confidence 68, spot 115,284.50). Wire to real feeds; keep the *shape* of each figure.
- Frames are fixed height, so several lists show a truncated row count (e.g. Markets shows 22 of 28 with a "load more" footer). In production these should scroll or paginate — the row counts are a consequence of the mock frame, not a product decision.

---

## Design tokens

### Colour

| Token | Value | Use |
|---|---|---|
| `--bg0` | `#08090a` | Canvas |
| `--bg1` | `#0c0d0f` | Raised region (verdict band, table headers, tickers' active row) |
| `--bg2` | `#111416` | Bar/track background |
| `--bdr` | `#1f2225` | Structural hairline (region dividers, frame border) |
| `--bdr2` | `#131618` | Row hairline (inside lists and tables) |
| `--bdr3` | `#16191b` | Cell hairline (grid cells, ticker separators) |
| `--txt` | `#e8e9ea` | Primary text and data |
| `--txt2` | `#8b8f94` | Secondary text, prose |
| `--txt3` | `#5a5f66` | Micro-labels, meta |
| `--txt4` | `#3a3f45` | Disabled, axis labels, tertiary meta |
| `--accent` | `#d9a626` | Active nav, primary CTA (always with `#08090a` text) |
| `--green` | `#3fb950` | Bullish / firing positive |
| `--red` | `#f0524d` | Bearish / firing negative |
| `--mark-idle` | `#22262a` | Signal marker when not firing |
| `--border-input` | `#2a2e32` | Input and secondary-button border |

**Colour rule (important):** green and red appear only where a signal is *firing*. In the evidence grid exactly two of eight rows carry colour (Funding 8h red, CVD 4h green); the other six render in `--txt`. There is a prop in the prototypes (`signalColorOnly`, default `true`) that toggles this so you can see the difference. Ship the `true` behaviour.

Heatmap ramp (liquidation map only) — four selectable palettes; default is magma:
`#0a0614 → #2a114e → #681e7a → #b5306a → #e85b3a → #f9a94a → #fdf3c8` at stops `0 / .14 / .32 / .52 / .70 / .86 / 1`.

### Typography

- **IBM Plex Mono** (400/500/600/700) — every number, micro-label, nav item, ticker, button label, and screen title.
- **IBM Plex Sans** (400/500/600/700) — prose, table body text, signal descriptions.
- Three effective steps plus micro:
  - micro-label: 9–10px mono, uppercase, letter-spacing `.14em`–`.18em`, `--txt3`
  - data: 12–15px mono, `font-variant-numeric: tabular-nums`
  - display: 20–34px mono 700 (screen verdicts, page titles); landing hero 52px
- Prose: 12.5–15px sans, line-height 1.55–1.65, `text-wrap: pretty`
- Never Inter, never emoji as icons.

### Spacing, radius, borders

- Radius: **0** everywhere. No rounded corners in this direction.
- Region padding: 14–16px (dense panels), 40–48px (marketing and legal pages)
- Row padding: `6px 14px` (dense tables) → `13px 16px` (comfortable lists)
- Borders are 1px solid; hairlines never doubled — each region owns its bottom border.

### Icons

Five nav glyphs, all stroke-only, `viewBox="0 0 20 20"`, `stroke-width: 1.5`, round cap/join, `currentColor`. Lifted from the repo's own `components/icons.tsx` (`NavDashboard`, `NavArena`, `NavScanner`, `NavTracking`, `NavJournal`). Reuse those components rather than the path strings in the prototypes.

---

## Navigation (applies to every app screen)

**Desktop** — one 44px bar: logo + wordmark `LIQUIDITYHQ` (12px mono 700, `.14em`), then five nav items at 11px mono uppercase `.1em` in `6px 12px` padding. Active item is `background: --accent; color: #08090a; font-weight: 700`. Right side: session pill (`● LONDON · 2h 14m`, 5px square dot in `--green`), `⌘K` in a 1px `--bdr` box, and a 22px square avatar with a 1px `--border-input` border.

**Screens that carry a ticker strip** (Arena, Desk, Markets, landing, auth): a 34px row below the nav, one cell per coin, `0 16px` padding, separated by `--bdr3`. Cell = symbol (`--txt2` 600) + price (`--txt`, tabular) + change (green/red at 80% alpha).

**Mobile** — 38px header (logo, screen name, status) and a 60px bottom tab bar with five items: 19px glyph + 9px mono label at `.1em`, active in `--accent`.

**Five destinations** (was 25 routes):

| Destination | Absorbs |
|---|---|
| Overview | `/dashboard`, `/briefing` |
| Arena | `/arena` (tabs: Read, Order flow, Liquidity, Correlation, History) |
| Scan | `/markets`, `/scanner` |
| Flow | `/liq`, `/funding`, `/correlation` |
| Book | `/journal`, `/alerts`, `/calc`, `/playbook`, `/hours`, `/research`, `/news`, `/econ-calendar`, `/settings` |

---

## Screens

Ids in brackets are the badges on the design canvas, so you can find each frame quickly.

### `Monochrome Terminal.dc.html`

**Arena [1a]** — `app/arena/page.tsx`
The verdict is a full-width band above the chart, not a sidebar card: left cell (min-width 330px) holds `LEAN BULLISH` at 34px mono 700 in `--green` with a 3px confidence bar (68% fill) and the value `68`; four cells follow (Last, Entry zone, Stop, Targets) each 20px mono 600 over a 10px micro-label; a 150px column on the right splits into `RE-RUN READ` (amber, `#08090a` text) over `SET ALERT` (`--txt2`). Below: chart toolbar (timeframes, active one amber-filled) → candle chart with dashed entry zone (`rgba(63,185,80,.07)` fill, dashed `.5` alpha borders), dashed stop in red, dashed target in amber, and right-edge price tags (spot tag is inverted: `#08090a` on `--txt`) → evidence grid, 4 columns × 2 rows, each cell `9px 14px` with a 2px signal marker, 78px micro-label, 13px value, right-aligned note. Right rail (352px): liquidation clusters (56px price, 8px bar, 44px USD), reasoning prose, session history.

**Desk [2a]** — `app/dashboard/page.tsx`
Market read band (430px cell: `RISK-ON, CAUTIOUS` 30px, one-paragraph thesis) + four pulse cells (BTC dominance, Altseason, Volatility, Fear & greed) + `OPEN ARENA` action. Body: coins table (8 columns — Coin, Price, 24h, Funding, OI 1h, Taker bar, Signal, Grade) replacing the old stacked coin cards; right rail carries Best setup today, Macro backdrop (5 rows), Next events (3px impact bar per row).

**Markets [3a]** — `app/markets/page.tsx`
28 perpetuals, six visible columns (`110px 1fr 96px 120px 96px 1.3fr 120px` grid) plus a column-picker affordance labelled `+ COLUMNS`; hidden by default: 7d %, volume, taker ratio, sparkline, grade, OI change. Filter chips: ALL / WATCHLIST / MAJORS / FIRING / GAINERS. Rows are **33px** — size the visible count to the viewport and paginate ("SHOWING 1–22 OF 28 · LOAD MORE"). Mobile uses two-line rows (symbol + price on line 1, signal + change/funding right-aligned).

**Liquidation map [3b]** — `app/liq/page.tsx`
The most involved screen. Title row: `BTC LIQUIDATION HEATMAP`, instrument select, timeframe segment (12H/24H/3D/7D/30D, 7D active), refresh button (30×28 bordered, arrow glyph). Control row: view tabs (HEATMAP / RECENT LIQUIDATIONS), four palette swatches (26×16, active bordered amber), `LIQUIDITY THRESHOLD = 0.75` and a range input (`accent-color: --accent`).
Heatmap: intensity colour-bar column on the left (16px wide, labelled `57.08M` top / `0` bottom), the map itself on `#0a0710`, a white 2px price track over it, dashed spot line with inverted price tag, date axis below, price axis right.
**Three controls must actually work:** threshold suppresses the low end of the ramp (`cut = threshold * 0.55`, then values rescale from the cut), palette switches the ramp, refresh re-seeds the density. In production, threshold and palette are view state; refresh refetches.
Density model: eight cluster levels (119,600 $44M · 118,400 $28M · 117,900 $61M · 116,200 $19M · 114,800 $38M · 114,100 $31M · 113,400 $82M · 112,000 $24M) as Gaussians (σ ≈ 1.3% of range) summed per price row, multiplied by a left→right growth factor so leverage accumulates over the window, then smoothed vertically. Rows above spot are short liquidations, below are long.
Cluster ladder sits **below** the heatmap, full width: 6 columns (Level, Side, Size bar, USD, Leverage, Distance), 30px rows, all eight levels visible; a 330px "Read" rail beside it carries one prose paragraph and a four-across stat strip (Liquidated 24h, Largest single, Nearest cluster, Cascade risk). Mobile switches views with three tabs (HEATMAP / LADDER / RECENT) and keeps the threshold slider and swatches.

**News [3c]** — `app/news/page.tsx`
Text-only wire, no thumbnails. Grid `66px 108px 1fr 96px 74px`: time (mono `--txt3`), source (10px mono `.14em`), headline (14px sans, `text-wrap: pretty`), coins, impact (HIGH red / MED amber / LOW `--txt3`). Footer: "SHOWING 1–10 OF 42 · LOAD MORE".

**Auth [3d]** — `app/login/page.tsx`, `app/forgot-password/page.tsx`
Desktop is a 50/50 split: form left, live product right (ticker + today's read + evidence) so a signed-out visitor sees the product. Focused input has an amber border; others `--border-input`. Magic-link is a secondary bordered button. Mobile frames cover sign-up and reset-request, including a green-bar confirmation block ("LINK SENT … Resend in 47s").

**Upgrade + paywall [3e]** — `app/upgrade/page.tsx`
Free vs Pro side by side (Pro on `--bg1`), eight feature rows each with `✓` green or `·` `--txt4`, and a `7-DAY TRIAL` chip. Paywall is a full modal over a dimmed (28% opacity) Arena: amber top border, `PRO FEATURE` eyebrow, `CONFLUENCE SCORE`, two actions and a `CONTINUE ON FREE` escape.

**Setup scanner [4a]** — `app/scanner/page.tsx`
268px criteria rail (Min score, Funding band, OI change, CVD divergence, Session, Universe), preset chips, and a 10-column results table with a score bar, side, entry/stop/target, R and the trigger reason.

**Funding + correlation [4b]** — `app/funding/page.tsx`, `app/correlation/page.tsx`
Signed bar chart of 8h funding payments (positive red above the zero line, negative green below — this is a *cost* signal, so positive is adverse), the board's current/24h/7d/annualised table, and an 8×8 correlation matrix (44px cells, alpha-scaled amber, `—` on the diagonal, `#08090a` text above 0.75).

**Econ calendar [4c]** — `app/econ-calendar/page.tsx`
Day-grouped rows with Actual / Forecast / Previous columns, a "Next up" panel counting down to CPI, and session windows below.

**Briefing [4d]** — `app/briefing/page.tsx`
Long-form: 32px mono headline, four meta cells (Generated, Window, Model, Confidence), three sections with amber section eyebrows. Right rail: four levels (invalidation red → first resistance green), a 220px chart, and the daily-email action.

**Journal [5a]** — `app/journal/page.tsx`
Six stats across the top (Trades, Win rate, Expectancy, Net P&L, Max drawdown, Best streak), equity curve in R multiples, performance by setup (four bars), then a 9-column trade log with the open position first and outcome chips (TARGET green / STOP red / OPEN amber / MANUAL `--txt2`).

**Alerts [5b]** — `app/alerts/page.tsx`
Conditions table (Coin, Type, Condition, Delivery, Status, Created) with a 5px status dot; right rail has delivery channels, today's triggers with coloured bars, and 30-day alert accuracy (61%).

**Calculators [5c]** — `app/calc/page.tsx`
Position sizer prefilled from the current read: inputs left (46px fields, 17px mono values), results right on `--bg1` in a 2×2 grid (26px values), then four secondary results (funding cost, liquidation price, break-even, max size). Tabs for Funding cost / Liquidation price / DCA ladder.

**Settings [5d]** — `app/settings/page.tsx`
Four groups in two columns (Account, Display, Data, AI reads); each row is label left, value right in mono, `▾` affordance. Right rail: usage this month with a progress bar, active sessions, and a danger zone (sign out everywhere, delete account in red).

**Landing [6a]** — `app/[locale]/page.tsx`, `components/LandingContent.tsx`
Order: nav → ticker → hero (52px mono headline + live read panel on the right) → three capabilities → **"Eight more surfaces, one vocabulary"** feature grid (4×2: Scanner, Briefing, Alerts, Journal, Playbook, Hours, Flow, Calendar) → four proof numbers → pricing → footer with risk disclosure. No stock imagery — the product is the imagery.

### `Monochrome Terminal - Tools.dc.html`

**Trading hours [1a]** — `app/hours/page.tsx`
Expectancy heat grid, 24 hours × 7 weekdays, 40px cells, alpha-scaled green/red with `·` for flat; four stats above; best-windows and session rails right; a suggested rule with `ADD TO PLAYBOOK`. Mobile collapses to six 4-hour blocks.

**Playbook [1b]** — `app/playbook/page.tsx`
Nine rules with adherence bar (green ≥85%, amber ≥65%, red below) and measured edge per rule; pre-entry checklist with one failing item; "where you broke rules" with the cost of each; total cost of broken rules (−$684 across 6 trades).

**Research [1c]** — `app/research/page.tsx`
520px hypothesis list (status chips OPEN amber / CONFIRMED green / INVALIDATED red) with a detail pane: thesis, evidence log (date, result), sample size, hit rate, `MARK CONFIRMED` / `ADD EVIDENCE`.

### `Monochrome Terminal - Static.dc.html`

Shared static shell: 56px marketing nav, 264px page index rail (active item has a 2px amber left border), content column, right rail.

- **About [1a]** — `app/about/page.tsx`. What it is / what it is not / how it's built, four principles, and the real data-source list (Bybit, Binance, 5-venue liquidations, Coinbase, FRED, Grok).
- **FAQ [1b]** — `app/faq/page.tsx`. Search field, four groups in the index, accordion rows with `+`/`−`, first item open.
- **Learn [1c]** — `app/learn/page.tsx` + `lib/glossary.ts`. Two-column glossary: term with category and where it appears, definition, then the term applied to today's numbers. A–Z rail with only populated letters lit.
- **Terms [2a]**, **Privacy [2b]**, **Refunds [2c]**, **Disclaimer [3a]** — numbered sections with a contents rail. Privacy has a processor rail plus export/delete actions; Refunds leads with "Fourteen days, no questions" and four facts; Disclaimer leads with real risk numbers ($412M liquidated in 24h, 61% longs, largest single $18.4M, cascade under 90s).

### `Monochrome Terminal - States.dc.html`

- **Reset password [1a]** — `app/reset-password/page.tsx`. New password with a four-segment strength meter, confirm field with green `✓`, and a note that this signs out every other device.
- **Onboarding [1b]** — `components/OnboardingProvider.tsx`, `OnboardingGate.tsx`, `SetupChecklist.tsx`. Step 2 of 4 with a 3px progress bar at 50%, 300px step rail, 28 coin chips (selected = amber fill, `✓`), and the pinned five previewed with live prices. Skippable from the header.
- **404 [1c]** — `app/not-found.tsx`. 88px `404`, the requested path shown in a bordered box, and five likely destinations with their glyphs.
- **Offline [1d]** — `app/offline/page.tsx`, `public/sw.js`. Cached data labelled with honest ages (6m, 11m, CURRENT), retry action, and the note that device alerts don't fire but Telegram delivery is server-side.
- **Maintenance [1e]** — `components/MaintenanceScreen.tsx`. Started / expected back / elapsed, plus what's still running (data collection and Telegram green; interface and read generation red).

---

## Interactions & behaviour

- **Nav** — active destination is amber-filled; in-page tabs use a 2px bottom border in amber with `--txt` label, inactive `--txt3` with transparent border.
- **Liquidation map** — threshold slider (0–1, step .01) filters the ramp live; palette swatches switch the ramp; refresh re-seeds/refetches. All three work on mobile too.
- **Hover** (not shown in static frames, implement per existing patterns): table rows tint `rgba(140,150,255,.05)` per the current design system; the refresh button's border goes amber.
- **Loading** — the repo's `SkeletonBar` in place of any value that isn't in yet; never a spinner over a whole panel.
- **Empty states** — not designed in this pass (user chose populated only). Follow `components/EmptyState.tsx`.
- **Responsive** — mobile frames are separate layouts, not the desktop grid stacked. Notably: Markets becomes two-line rows; Arena's evidence grid becomes a list; the liquidation map switches views by tab; Settings shows three groups.

## State

Nothing new is required beyond what the codebase has (`marketStore`, settings, auth, alerts). New view state only: liquidation-map `threshold` / `palette` / `timeframe`, Arena's active in-page tab, Markets' visible-column set and filter chip, Journal's period, and onboarding step.

## Assets

- `design_files/assets/logo.png` — the app icon the user supplied; used at 18–26px in every nav bar and mobile header, with no border radius change (the mark has its own dark ground).
- Fonts: IBM Plex Mono + IBM Plex Sans. The repo already self-hosts Plex Mono in `app/fonts/`; Figtree is replaced by IBM Plex Sans in this direction.
- No other imagery. Any future placeholders should be striped SVGs with a mono caption, not stock photos.

## Files

| File | Contents |
|---|---|
| `design_files/Monochrome Terminal.dc.html` | Arena, Desk, Markets, Liquidation map, News, Auth, Upgrade + paywall, Scanner, Funding + correlation, Econ calendar, Briefing, Journal, Alerts, Calculators, Settings, Landing (18 frames) |
| `design_files/Monochrome Terminal - Tools.dc.html` | Trading hours, Playbook, Research |
| `design_files/Monochrome Terminal - Static.dc.html` | About, FAQ, Learn, Terms, Privacy, Refunds, Disclaimer |
| `design_files/Monochrome Terminal - States.dc.html` | Reset password, Onboarding, 404, Offline, Maintenance |
| `design_files/support.js` | Runtime the prototypes need in order to open in a browser. Not part of the implementation. |
| `design_files/github.md` | Screen → repo-file map, so each design traces to the code it replaces |

Open any `.dc.html` directly in a browser; each holds several device frames side by side with an id badge on each.

## Not designed

The internal console (`/ops`, `/ops/login`, `/ops/config`, `/ops/team`, `/ops/users`, `/ops/users/[id]`) and `/admin` — excluded at the user's request; keep the existing chromeless shell. `/backtest` and `/live-tracking` redirect to the dashboard, `/[locale]` is a wrapper, and `/auth/callback` is a spinner, so none need visual work.
