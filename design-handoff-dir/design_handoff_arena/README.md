# Handoff: LiquidityHQ Arena — Monochrome Terminal

## Overview

Arena is the deep-dive screen for one coin at `/arena` — chart plus every signal the product computes. It is the densest screen in the app, and the one where colour carries the most meaning.

This is a **restyle, not a restructure.** All 15 UI modules that `app/arena/page.tsx` composes today stay, in production order, on one scroll. Nothing moves between screens, nothing is regrouped behind tabs, nothing is dropped at desktop.

**`specs/arena.md` is the normative document.** It carries per-panel geometry, the colour rules, the extend rules, gating, states, and 39 numbered acceptance criteria QA scores against. This README orients; the spec adjudicates. Where they differ, the spec wins.

## About the design file

`design_files/Arena 1a.dc.html` is a **design reference created in HTML** — a prototype showing intended look and behaviour, not production code to copy. It is a canvas holding three panels: desktop 1440×1980 (Pro), mobile 390×2090 (Pro), and a 420-wide column showing the two Pro slots as a free user sees them.

Recreate this inside the existing Next.js codebase using its established patterns — `useMarket()`, `useLabels()`, `useAuth()`, `lib/limits.ts`, `lib/terminalTokens.ts`, the icons in `components/icons.tsx`. Do not port the HTML or its inline styles.

Open it directly in a browser. It needs `support.js` and `assets/logo.png` beside it; both are in the bundle.

**The file is authored end to end.** A search for `: ` inside any style attribute returns zero — every value in it was written deliberately, none is an editor drag. That check is worth re-running if the file is ever edited, because the previous Arena frame carried five dragged values that were mistaken for design decisions.

**Do not measure from `Monochrome Terminal.dc.html · 1a`.** That frame is contaminated and is retained only as the artifact-detector control.

## Fidelity

**High fidelity.** Colours, type sizes, spacing, row heights and geometry are final. Recreate pixel-accurately.

Four qualifications:

- **Copy comes from `useLabels()` and `dict.*`.** The strings in the frame demonstrate treatment, not copy. Labels are DB-driven and can change length at runtime — nothing may use a fixed width or `text-overflow: ellipsis`.
- **Data is one fixture** — BTC/USDT perp, 4H, "Lean bullish", confidence 68, spot 115,284.50. Wire to the real store; keep the shape.
- **Four values are reasoned reconstructions, not measurements.** Rail 352 (three sibling frames), verdict 34px desktop (README:103), band full width, verdict 26px mobile. The last is the softest — a ratio argument with no sibling and no README line behind it.
- **The frame draws both bullish and bearish verdict variants.** Green is the fixture, not a constant.

## Screens / views

### Arena — desktop, 1440

Seven regions stack vertically, each separated by `1px solid --bdr`: nav 44 → ticker 34 → hint 36 → coin snapshot 88 → verdict band → timeframe row 42 → body.

The body splits `flex: 1` against a **352px** rail. Main column top to bottom: chart 430, Confluence, a 2-up row (Timeframe alignment | Market structure), a 2-up row (Moving average signal | Absorption), then the liquidation heatmap filling what remains. Rail top to bottom: reads-today meter, liquidation clusters, Why, evidence, session history.

Panel headers are 30px with a `1px --bdr` bottom rule. Rail headers are 28px. In-panel row hairlines are `--bdr3`; region separators are `--bdr` — both appear here and they are different decisions.

The verdict band spans the full shell width: a 330px verdict cell, four level cells, and a 170px action column carrying `RE-RUN READ` over `SET ALERT`.

### Arena — mobile, 390×844 viewport

A separate layout, not a reflow. The frame is 2090 tall because the content scrolls.

Header 38 → symbol row 44 (coin picker left, price and change right) → higher-timeframe warning → verdict band with three level cells → timeframe row 40 → chart 210 → Confluence as stacked rows → timeframe alignment → market structure → absorption score → evidence → Why → bottom tab bar 60.

Five modules are dropped at mobile as a density decision: PageHint, the ticker strip, EMASignal, LiqHeatmap, and the clusters and session-history rails. **This is the part most likely to need the owner's sign-off**, since the standing rule is that nothing is removed. The spec states the reasoning and the alternative.

### Free user

Two Pro surfaces, deliberately treated differently:

- **ConfluenceScore keeps its locked card**, in the main column at full width. Removing it would delete a conversion surface and its route into the upgrade modal.
- **AbsorptionDetector is absent entirely** — no locked card, no empty region. EMASignal takes the full 2-up row. It is a supporting signal, not the reason to subscribe, and a locked card for it would be noise beside the one that matters.

Production already treats these two asymmetrically, and that asymmetry is correct.

## Interactions & behaviour

**Timeframe row — three states.** Available (`--txt2` text, `--bdr` border), active (`--accent` ground, `--bg0` text, weight 700), gated (`--txt3` text, `--bdr3` border, **plus a padlock glyph**). `GATED_TFS = ['1m','5m','15m']` from `lib/limits.ts`; free fallback is `1h`.

Gated and available are both grey, so the padlock is what separates them — and a text note at the row's right names the three gated timeframes as a second, non-glyph carrier. A free user selecting a gated timeframe opens `UpgradeGateModal` and the selection does not apply; a free user arriving on a gated timeframe is moved to `1h`.

**Run limit.** Free users get 3 reads a day. At the limit, `RE-RUN READ` goes `--txt3` and opens the modal instead of issuing a request. The usage meter shows the count and an upgrade link.

**Auth flicker.** `authLoading` renders the *entitled* branch, matching production — a Pro user must never see a locked card flash mid-auth.

**Responsive.** Breakpoint 768px. Select with `useSyncExternalStore` over `matchMedia` and render **one tree**.

This matters more here than anywhere else in the app: rendering both layouts and hiding one mounts **two `KLineProChart` instances and two candle subscriptions**. That already shipped once, and the owner spotted two charts before either session did. At desktop the mobile tree must not exist; at mobile the desktop tree must not exist. Criteria 29–31 test by node count and by counting `new WebSocket`, not by computed `display`.

**Motion.** None beyond hover transitions on controls — `120ms ease`, on `background` and `border-color` only, inside a `prefers-reduced-motion` guard.

## Colour is data

The rule that makes this screen correct or wrong.

`fire` is a field on the data, not a styling choice:

```
fire = 'red'    → value --red,   marker --red        fired as a warning
fire = 'green'  → value --green, marker --green      fired as confirmation
fire = null     → value --txt,   marker --mark-idle  did not fire
value missing   → em dash --txt2, marker --mark-idle
```

**In the evidence grid, 2 of 8 rows carry colour. Six are quiet — and four of those six hold positive numbers.** Colouring them green would look better, be wrong, and pass every automated check, because `--green` is a legal token.

Direction is not the sign of the number. Funding at `+0.0132%` is **red**, because crowded long is a warning. Overbought RSI is red for the same reason.

The same rule governs five panels: the verdict (green bullish, red bearish, `--txt2` neutral), Confluence factors (by vote — a *cleared* penalty is `--txt3`, never green), MultiTF alignment (by RSI band), Market structure (by break direction), and EMASignal conditions (pass/fail). The four moving-average *values* are all `--txt` — line colour is a chart concern; in a table they are numbers.

**Two argued exceptions.** The ticker's change column maps sign to colour, because a price change genuinely is directional. Cluster bars colour by position side — red below spot for long liquidations, green above for short — which is side, not price direction.

## Honest labels

| Mock label | Reality | Ships as |
|---|---|---|
| `CB prem` | No source wired | Row stays for layout stability; value is an em dash, always |
| `Liq 24h` | A 15-minute Binance window | **`Liq 15m`** |

Copying a mock label onto a different measurement makes the screen lie.

## Extend rules

The frame is one market at one instant.

| Panel | Frame | Production |
|---|---|---|
| Ticker | 8 coins | All 50, same cell, one row |
| Confluence factors | 7 in a 4-column grid | Every factor the scorer returns; a 9th fills the next cell |
| Timeframe alignment | 7 rows | Fixed by the timeframe set |
| Market structure | 4 events | Every event in the lookback, newest first; do not pad |
| Evidence | 8 rows | Every signal the read returns |
| Clusters | 8 levels | Every cluster in range |
| Session history | 4 runs | The session's runs, newest first |

Never truncate to match the mock, and never add a second pattern beside the first.

## State management

Nothing new beyond what the codebase has: `useMarket()` for prices and the read, `useAuth()` for `entitled` and `authLoading`, `lib/limits.ts` for `GATED_TFS` and run limits, `useLabels()` for copy.

New view state is only: selected coin, selected timeframe, hint dismissal, and the viewport selection via `useSyncExternalStore`.

**Gating sits at the call site**, not inside components — `{entitled ? <Panel/> : <LockedFeatureCard/>}`. Moving a panel moves its markup and leaves its guard behind. That is exactly how free users saw the paid Confluence score for a commit, with every automated gate passing.

## Design tokens

Reference by name from `lib/terminalTokens.ts`. **Do not restate hex in code.** 15 tokens: `--bg0` `--bg1` `--bg2` `--bdr` `--bdr2` `--bdr3` `--txt` `--txt2` `--txt3` `--txt4` `--accent` `--green` `--red` `--mark-idle` `--border-input`.

> ### Amendment — 2026-09-01, owner-approved
>
> **Three token values are superseded.** The originals could not satisfy this
> handoff's own accessibility requirement. Originals are kept on the record
> rather than overwritten — a handoff that quietly rewrites its own numbers is
> how the next drift becomes invisible.
>
> | Token | Original | **Amended** | Why |
> |---|---|---|---|
> | `--bg1` | `#0c0d0f` | **`#141517`** | sat 13 hex units off `--bg0`; imperceptible as a card boundary (#512) |
> | `--txt3` | `#5a5f66` | **`#7c828a`** | failed 4.5:1 — see below (#512) |
> | `--border-input` | `#2a2e32` | **`#5e646b`** | **1.36:1** against `--bg1`; WCAG 1.4.11 requires **3:1** for UI component boundaries. `#5e646b` clears **3.14:1**. Amended on the same accessibility grounds, after the owner's ruling rather than as part of it (#520, #527). |
>
> **The conflict.** `specs/arena.md` §Accessibility enumerates `--txt3`/`--bg0`
> as a pair that **must clear 4.5:1**. Measured with the original values it is
> **3.10:1**; `--txt3` on the original `--bg1` is **3.03:1**. The specified value
> could not meet the specified bar, on a pair the spec itself names.
>
> The amended value clears both: **5.14:1** on `--bg0`, **4.78:1** on the
> amended `--bg1`.
>
> Measured by QA on qa `c16bb62` (#512, #520). The owner ratified on #526, having
> been offered the alternative of reverting and accepting a documented AA
> failure. The remaining 12 tokens are unchanged.
>
> **`lib/terminalTokens.ts` is the file of record and must match this table.**
> At time of writing it still holds the originals — which is exactly how this
> drift stayed invisible, since nothing imports it. See #518.

One documented exception: the liquidation heatmap's canvas is `#0a0710` with a 7-stop ramp over it. It sits under a continuous gradient rather than beside palette colours. Whether it deserves a 16th token is a design-system call, flagged in the spec.

**Type.** IBM Plex Mono for every number, label, nav item and heading; IBM Plex Sans for prose. Scale in use: 34 / 30 / 28 / 26 / 24 / 20 / 19 / 16 / 15 / 14 / 13 / 12 / 11 / 10 / 9.

**Radius 0 everywhere. No shadows.** Borders are `1px` throughout; the only `2px` is a marker bar.

## Accessibility

Contrast pairs are enumerated in the spec — all must clear **4.5:1**. `--txt4` is exempt only where it is non-essential and paired with a labelled value.

**Colour is never the only carrier.** Firing signals have a marker bar as well as a colour; gated timeframes have a padlock and a text note; pass/fail conditions have `✓`/`✕` glyphs. This is deliberate and must survive implementation.

Interactive targets **≥ 24×24px** (WCAG 2.2 AA). The mobile timeframe chips need checking. Focus is `2px solid --accent`, offset 2 — offset `-2` inside grid cells so the 1px gap does not clip it.

Never apply alpha to a token to de-emphasise it; size and weight carry that.

## Testing note

Prices and the read arrive over `wss://stream.binance.com`, which `page.route` cannot intercept. **The ticker, snapshot, chart and read panels are not fixture-measurable** unless the store is stubbed above the socket. Structure and geometry criteria hold regardless; the colour criteria (18–28) name their fixtures explicitly.

## Files

| File | What it is |
|---|---|
| `design_files/Arena 1a.dc.html` | The design reference. Three panels. Open in a browser. |
| `design_files/support.js` | Runtime the prototype needs. **Not part of the implementation.** |
| `design_files/assets/logo.png` | Logo asset. No border radius. |
| `specs/arena.md` | **Normative.** Per-panel geometry, colour rules, gating, states, 39 acceptance criteria. Read before writing code. |

### Source files this screen replaces

`app/arena/page.tsx` and the 15 components it composes: `KLineProChart`, `ConfluenceScore`, `MultiTFAlignment`, `MarketStructure`, `AbsorptionDetector`, `EMASignal`, `HigherTfMoveBadge`, `LiqHeatmap`, `UsageMeter`, `CoinMarketSnapshot`, `CoinIcon`, `Tip`, `PageHint`, `Warn`, `UpgradeGateModal` + `LockedFeatureCard`. Plus `lib/limits.ts` for gating and `lib/terminalTokens.ts` for the palette.

## Open decisions

Five items are listed as *Could not determine* in the spec. Two need the owner:

1. **The five mobile omissions** — PageHint, ticker, EMASignal, LiqHeatmap, clusters and history. Nothing is removed at desktop; mobile is a different surface with a different budget. If that is not acceptable, the alternative is an accordion, which is a structural change needing its own decision.
2. **The heatmap canvas colour** — a 16th token, or a documented exception.

The other three are smaller: session history's lookback window, the coin picker menu's layout, and whether `Tip` has content distinct from `PageHint`.

**Not covered by this handoff:** tabs (Read / Order flow / Liquidity / Correlation / History). They do not exist in any frame and were never a design intent — a separate proposal for the owner.
