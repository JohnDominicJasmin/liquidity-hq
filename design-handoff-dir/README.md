# Handoff: LiquidityHQ landing page — Monochrome Terminal

## Overview

The signed-out marketing page at `/` for LiquidityHQ, a crypto analytics product for perpetual-futures traders. Redesigned into a visual direction called **Monochrome Terminal**: near-black ground, no cards, hairline rules instead of boxes, IBM Plex Mono for every number, and a single amber accent used only on the active state and the primary action.

The page must convince a signed-out visitor that the product does something specific. It does that by showing a real market read in the hero — not a screenshot, the live one — beside the six things the product actually does.

**This handoff covers one screen only.** The rest of the redesign (30 further screens) is a separate bundle.

## About the design files

`design_files/Landing 7a.dc.html` is a **design reference created in HTML** — a prototype showing intended look and behaviour, not production code to copy. It is a canvas holding two fixed-size device frames side by side (1440×3236 desktop and 390×3236 mobile). Those frames are `div`s at a literal pixel size; they are not a responsive page.

The task is to **recreate this design inside the existing codebase** — Next.js App Router, React 19, TypeScript, CSS custom properties — using its established patterns: `useAuth()`, the `dict` i18n prop, `lib/terminalTokens.ts`, the icon set in `components/icons.tsx`. Do not port the HTML or its inline styles. Do not introduce a new styling approach.

Open the file directly in a browser. It needs `support.js` and `assets/logo.png` beside it; both are in the bundle.

**`specs/landing.md` is the normative document.** It carries the per-panel rules, the extend rules, the colour-as-data rules and 36 numbered acceptance criteria that QA scores the build against. This README orients; the spec adjudicates. Where they differ, the spec wins.

## Fidelity

**High fidelity.** Colours, type sizes, spacing, row heights and layout are final and were measured off the frame. Recreate pixel-accurately.

Three qualifications:

- **Copy is not final and must not be changed.** Every string comes from `dict.*` via `lib/i18n/dictionaries`, and this route is localised across all `SUPPORTED_LOCALES`. The English copy in the frame demonstrates *treatment* — uppercase mono headings, two-line H1 with the second line accented. Hardcoding it breaks every non-English locale silently.
- **Data is mock.** One scenario (BTC/USDT perp, 4H, "Lean bullish", confidence 68). Wire to the real store; keep the shape.
- **The frame's fixed height forces truncation** in the ticker. Production extends — see §Extend rules.

## Screens / views

One screen, two layouts. They are **alternatives, not a reflow** — see §Responsive behaviour.

---

### Landing — desktop, 1440 wide

**Purpose.** A signed-out visitor decides whether to create an account. Signed-in users never see this page; they are redirected to `/arena`.

**Layout.** Single column of eight full-width regions, each separated by a `1px solid --bdr` rule. `border-radius: 0` on every element, including the logo image — the design treats radius as an absence, not a token.

| # | Region | Height | Padding |
|---|---|---|---|
| 1 | Nav | 56 | `0 40px`, gap 12 |
| 2 | Ticker | 34 | cell `0 16px`, gap 8 |
| 3 | Hero | auto | `76px 40px 64px`, flex row, gap 56 |
| 4 | Features | auto | `64px 40px` |
| 5 | How it works | auto | `60px 40px`, ground `--bg1` |
| 6 | Pricing | auto | `64px 40px` |
| 7 | Final CTA | auto | `64px 40px`, ground `--bg1`, flex row, gap 40 |
| 8 | Footer | auto | `52px 40px 0` |

Hero top edge sits at `y = 90`. Hero splits `flex: 1` left against a fixed **472px** right column. Features and the risk disclosure are 3-column grids. Footer is a fixed **290px** brand column beside four `flex: 1` link columns.

**Grid gaps are the hairlines.** Set `gap: 1px` and paint the container `--bdr`, so the gap itself reads as the rule. Do not use `gap` plus a `border` — that doubles the line.

**Components.**

**Nav** — logo 26×26; wordmark `LIQUIDITYHQ` in IBM Plex Mono 14px/700, `letter-spacing: .16em`, `--txt`. Right side: a language control (border `1px --bdr`, padding `6px 11px`, globe glyph 13×13 stroke `--txt2` at 1.4, label 11px, caret 9px `--txt3`); `SIGN IN` as a ghost button (11.5px mono, `.12em`, `--txt2`, padding `9px 16px`, border `1px --border-input`); `GET STARTED` as the primary (same type at 700, text `--bg0` on `--accent`, padding `10px 18px`). Uppercase is **real text**, not `text-transform`.

**Ticker** — cells at padding `0 16px`, gap 8, `border-right: 1px --bdr3`. Symbol 11px/600 mono `.06em` `--txt2`; price 11px mono `--txt` tabular; change 11px tabular in green or red at 80% alpha.

**Hero left** — badge (inline-flex, border `1px --bdr`, ground `--bg1`, padding `7px 13px`, 6×6 `--green` dot, text 10.5px mono `.16em` uppercase `--txt2`). H1 at **54px** mono/700, `line-height: 1.06`, `letter-spacing: -.015em`, `--txt`, second line `--accent`. Sub at 17px sans, `line-height: 1.6`, `--txt2`, `max-width: 600px`, `text-wrap: pretty`. Two CTAs at height 50 — primary filled `--accent` with `--bg0` text at padding `0 30px`; ghost bordered `--border-input` at padding `0 26px`. Stats sit under a `1px --bdr` rule with `padding-top: 24px`; each cell has `padding-right: 38px; margin-right: 38px; border-right: 1px --bdr`, value 26px mono/700, label 9.5px mono `.16em` `--txt3`.

**Hero right — the live read panel.** 472px, ground `--bg1`, border `1px --bdr`. Header 34 tall with a 5×5 status dot, 10px `.16em` label, 10px timestamp right. Body padding 20: verdict at **32px mono/700 in the read's colour**; a confidence row (3px track `--bdr`, fill at the confidence %, 13px value, `CONF` at 9.5px `--txt3`); a 3-cell level grid (Entry / Stop / Target, `gap: 1px` on `--bdr`, cell padding `11px 12px`, label 9px `.14em` `--txt3`, value 13.5px mono/600 tabular). Then evidence rows at padding `10px 14px`: a 2×18px marker, a 76px label at 9.5px `.1em` `--txt3`, a 12.5px mono/600 tabular value, and a right-aligned 11px note.

**Features** — eyebrow 10px mono `.2em` uppercase `--accent`; H2 34px mono/700; sub 15.5px/1.6 `--txt2` at `max-width: 660px`. 3-column grid, `gap: 1px` on `--bdr`, outer border `1px --bdr`. Each card: ground `--bg0`, padding `24px 22px`, icon 24×24 stroke `--accent` at 1.6 with round caps, title 15px mono/700 `.06em`, description 13.5px/1.6 `--txt2` with **`min-height: 66px`** (load-bearing — it aligns the pill rows across the row), pills at 9.5px mono `.1em` uppercase bordered `1px --bdr` padding `4px 8px`, then a footer pushed down by a flex spacer with `OPEN →` at 10.5px `--accent` and the route string at 10px `--txt4`.

**The whole card is an `<a>`**, not a div containing a link.

**How it works** — ground `--bg1`. Four steps across, each `flex: 1` with `padding-right: 22px`. Number box 34×34 bordered `1px --accent` with a 14px mono/700 `--accent` numeral; title 14px mono/700 `.04em`; description 13.5px/1.6 `--txt2`.

**Pricing** — two plans, `gap: 1px` on `--bdr`. Free on `--bg0`, Pro on `--bg1` with **`border-top: 2px solid --accent`** and a trial chip beside its name (9.5px mono/700 `.14em`, `--bg0` on `--accent`, padding `3px 8px`). Plan name 12px mono/700 `.18em` uppercase; price 46px mono/700 with `/mo` at 14px `--txt3`. Feature rows at padding `9px 0` with `border-bottom: 1px --bdr2`: a 12px icon in a 12px column (`✓` `--green` / `✕` `--txt4`) and 13.5px text (`--txt` included, `--txt3` excluded). CTAs at height 46.

**Final CTA** — ground `--bg1`, flex row. Heading 36px mono/700 `line-height: 1.15`; sub 15.5px/1.6 at `max-width: 620px`; button height 54, padding `0 34px`, filled `--accent`.

**Footer** — 290px brand column (logo 30×30, wordmark 13px mono/700 `.16em`, description 13px/1.6 `--txt3`) beside four link columns (head 9.5px mono/700 `.18em` `--txt2`; links 13px `--txt3` stacked at `gap: 9px`). Then a `RISK DISCLOSURE` divider — a 9.5px mono/700 `.2em` `--txt3` label followed by a `1px --bdr` rule filling the row — and a 3-column grid of six disclosure items at `gap: 24px 40px` (label 10px mono/700 `.14em` uppercase `--txt2`; text 12.5px/1.6 `--txt3`). Legal block last, above a `1px --bdr` top rule, two lines at 12.5px/1.6 `--txt3` with underlined inline links.

**Copy.** Exact strings live in `dict.*`. See §Fidelity — do not hardcode.

---

### Landing — mobile, 390×844 viewport

**Purpose.** Identical.

**Layout.** A separate layout. Values that differ:

| Region | Desktop | Mobile |
|---|---|---|
| Nav height | 56 | **52**, padding `0 16px`, gap 9 |
| Ticker height | 34 | **30**, cell padding `0 12px` |
| Hero padding | `76px 40px 64px` | `34px 18px 30px` |
| Hero H1 | 54px | **32px**, `line-height 1.1` |
| Hero | 2 columns, gap 56 | **stacked**, read panel below the CTAs |
| Hero stats | 4 across | **2×2 grid**, `gap 1px` on `--bdr` |
| Features | 3 columns | **1 column** |
| How-it-works | 4 across | **stacked**, `gap 16px` |
| Pricing | 2 across | **stacked**, Pro below Free |
| Footer links | 4 columns | **2×2 grid**, `gap 22px` |
| Risk disclosure | 3 columns | **stacked**, `gap 16px` |
| Section padding | `64px 40px` | `30px 18px` |

The mobile ticker carries a right edge fade so a clipped cell reads as scrollable rather than broken:

```css
mask-image: linear-gradient(90deg, #000 86%, transparent);
-webkit-mask-image: linear-gradient(90deg, #000 86%, transparent);
```

Both properties are required. Under `dir="rtl"` the gradient mirrors to `270deg`.

## Interactions & behaviour

**Navigation.** 28 links. Nav → `/login`, `/login?signup=1`. Hero → `/login?signup=1`, `/briefing`. Feature cards → `/arena`, `/settings`, `/briefing`, `/news`, `/dashboard`, `/scanner`, in that order. Pricing → `/login?signup=1`, `/upgrade`. Final CTA → `/login?signup=1`. Footer → four columns of 4, 4, 4 and 8 links.

**Hover.** Ghost button border → `--txt3`. Primary fill → `opacity 0.9`. Feature card ground → `--bg1` with the `OPEN →` underlined. Footer link → `--txt`. All `120ms ease`, on `background` and `border-color` only, never on layout properties.

**Focus.** `2px solid --accent`, offset 2 — offset `-2` inside grid cells so the 1px gap does not clip it. Never `outline: none`.

**Affordance.** Feature cards carry it through the accent `OPEN →`, the visible route string, and the hover ground change — not through colour alone. Footer legal links carry it through underline, because `--txt3` links inside a `--txt3` paragraph are otherwise indistinguishable.

**Motion.** None, beyond those hover transitions. No scroll reveal, no parallax, no counting stats. Everything inside `@media (prefers-reduced-motion: reduce) { transition: none }`.

The production page currently renders `BeamsBackground` and `.lp-hero-glow` — animated gradient washes behind the hero. **This design removes both.** They are decoration rather than panels (no text, link or data), and they contradict the flat-ground premise. Flagged because the owner's standing rule is "do not remove"; it needs an explicit yes.

**Loading.** While the session resolves, the existing `.lp-loading` splash renders — wordmark, spinner, `sr-only` status — and the marketing markup never mounts. Restyle it to `--bg0` but keep its structure and `role="status"`.

**Live read states.** Loading: skeleton in the verdict slot, empty confidence track, em dashes for levels and evidence. Empty: verdict reads `NO READ` in `--txt2`, confidence row absent, everything else em-dashed — and the panel keeps its height so the hero does not reflow. Error: same as empty, plus the header dot goes `--txt4` and the timestamp reads `STALE`. No error text and no retry — a marketing visitor cannot act on a feed error.

**Never render a placeholder number.** A missing value is an em dash in `--txt2`.

**Responsive behaviour.** Breakpoint **768px**. The two layouts are alternatives: select with `useSyncExternalStore` over `matchMedia('(min-width: 768px)')` and render **one tree**. Do not render both and hide one — a hidden subtree still mounts, and here that would open a second WebSocket subscription against `wss://stream.binance.com`. At desktop the mobile markup must be *absent*, not `display: none`.

## Colour is data

The single highest-risk rule on this project.

`fire` is a **field on the data**, not a styling choice. In the live read panel, a value is red because that signal fired as a warning, green because it fired as confirmation, and `--txt` because it did not fire at all. In the frame, **2 of 6 evidence rows carry colour** — and four of the four quiet rows hold positive numbers. Colouring those green looks better, is wrong, and passes every automated colour check, because `--green` is a legal token.

```
fire = 'red'    → value --red,  marker --red      (fired, warning)
fire = 'green'  → value --green, marker --green   (fired, confirmation)
fire = null     → value --txt,   marker --mark-idle
value missing   → em dash --txt2, marker --mark-idle
```

Direction is explicit because it is **not** the sign of the number: crowded-long funding is positive and red; overbought RSI is high and red.

The verdict string takes its colour the same way — `--green` bullish, `--red` bearish, `--txt2` neutral. It is green in the frame because the fixture is bullish. Do not hardcode it.

**Two exceptions, both argued.** The ticker's change column maps sign to colour, because a price change genuinely is directional. Entry/Stop/Target render `--txt` always, because they are prices, not signals. Nowhere else on this route uses green or red.

## Extend rules

The frame is one market at one instant. Production has more data. Extend the pattern; never truncate to fit the mock, and never invent a second pattern beside it.

| Panel | Frame shows | Production |
|---|---|---|
| Ticker | 8 coins | All tracked coins, same cell, one row, overflow hidden |
| Hero stats | 4 | Fixed at 4 — copy, not data |
| Evidence rows | 6 | Every signal the read returns |
| Feature cards | 6 | 6 from `FEATURE_META`; a 7th fills the next grid cell |
| Feature pills | 3 per card | All the dict provides; wrap |
| How-it-works steps | 4 | Up to 5 on one row; 6+ wrap |
| Pricing rows | 8 / 8 | All rows; the two lists need not match in length |
| Footer columns | 4 | Fixed at 4; links per column extend |
| Risk disclosure | 6 | Extends into the same grid |

**Label honestly where the data differs from the mock.** `CB prem` has no source wired — it renders an em dash, always, and the row stays so the layout is stable. The mock's `Liq 24h` is a 15-minute Binance window for us, so it is labelled **`Liq 15m`**. Copying a mock label onto a different measurement makes the screen lie.

Labels are DB-driven via `lib/labelKeys.ts` and can change length at runtime. Nothing on this route may use a fixed width or `text-overflow: ellipsis`.

## State management

No new state beyond what the codebase has.

- `useAuth()` → `user`, `loading`. Drives the splash and the signed-in redirect to `/arena`. Both exist today and must be kept.
- The market store, read-only, for the ticker and the hero read.
- Viewport selection via `useSyncExternalStore` over `matchMedia` — the only state this redesign introduces.
- The language control uses the existing `LanguageSwitcher` behaviour, unchanged.

**Gating: none.** This route is public. It renders no `LockedFeatureCard` and evaluates no `entitled` guard.

This matters because in this codebase the paywall lives at the **call site**, not inside the component — `{entitled ? <Panel/> : <LockedFeatureCard/>}` — so moving a panel moves its markup and leaves its guard behind. The pricing panel *describes* Pro entitlements but must not *read* entitlement state.

## Design tokens

Reference by token name from `lib/terminalTokens.ts`. **Do not restate hex in code** — two copies drift apart silently and both files still look correct alone. The hex column is for checking the frame against the token file.

### Dark (default)

| Token | Hex | Role |
|---|---|---|
| `--bg0` | `#08090a` | page ground |
| `--bg1` | `#141517` | raised region |
| `--bg2` | `#111416` | bar / track fill |
| `--bdr` | `#1f2225` | structural hairline |
| `--bdr2` | `#131618` | row hairline |
| `--bdr3` | `#16191b` | cell hairline |
| `--txt` | `#e8e9ea` | primary text |
| `--txt2` | `#8b8f94` | secondary text |
| `--txt3` | `#5a5f66` | micro labels |
| `--txt4` | `#3a3f45` | disabled, tertiary |
| `--accent` | `#d9a626` | active state, primary action |
| `--green` | `#3fb950` | fired, confirming |
| `--red` | `#f0524d` | fired, warning |
| `--mark-idle` | `#22262a` | signal marker, not fired |
| `--border-input` | `#5e646b` | input / ghost button border |

15 values. That is the whole palette.

### Light

Ships as a **sibling file per screen** — `<Screen>-light-theme.dc.html` next to the dark original — not as an extra artboard inside the same canvas. Look for the suffix, not a second frame.

Four tokens (`--accent`, `--green`, `--red`, and the unlisted `--amber`) are **not an inversion** of their dark values — the dark accents fail 4.5:1 on a light ground (`--accent` 2.23:1, `--green` 2.56:1, `--red` 3.49:1, `--amber` 2.14:1), so light gets its own darker values in the same hue family, chosen to clear AA. Everything else is a direct swap. Treat the four accent values as a proposal to verify, not a measurement — there is no light frame to measure them from.

| Token | Hex | Contrast on `--bg0` | Role |
|---|---|---|---|
| `--bg0` | `#f7f6f3` | — | page ground |
| `--bg1` | `#ebe9e6` | — | raised region |
| `--bg2` | `#e3e1dd` | — | bar / track fill |
| `--bdr` | `#d5d2cd` | — | structural hairline |
| `--bdr2` | `#dfdcd7` | — | row hairline |
| `--bdr3` | `#e2dfda` | — | cell hairline |
| `--txt` | `#15181b` | 15.1:1 | primary text |
| `--txt2` | `#585c61` | 6.22:1 | secondary text |
| `--txt3` | `#6a6e73` | 5.14:1 | micro labels |
| `--txt4` | `#aeaaa4` | — | disabled, tertiary (exempt, same as dark) |
| `--accent` | `#8a5c00` | 5.38:1 | active state, primary action |
| `--green` | `#1a7f37` | 4.70:1 | fired, confirming |
| `--red` | `#cf222e` | 4.97:1 | fired, warning |
| `--amber` | `#9a6a00` | — | kept distinct from `--accent`, see note below |
| `--mark-idle` | `#d1cec9` | — | signal marker, not fired |
| `--border-input` | `#75797e` | — | input / ghost button border |

One more thing this table does **not** confirm: the page wrapper outside the 1440/390 frames renders `#e9e7e3` in the light files (dark equivalent `#151719`). That is the canvas/document backdrop, not `--bg0` — do not read it as a 16th token or as `--bg1`'s value. `--bg1` is `#ebe9e6`, measured inside the frame.

`--amber` does not appear in the dark table above because no dark screen in this bundle uses it distinctly from `--accent` — it is carried in the light derivation for completeness only. Confirm with design whether the codebase's actual token file defines a 16th value here, or whether it should be dropped.

**Type.** IBM Plex Mono 400/500/600/700 for every number, micro-label, nav item, button label and heading. IBM Plex Sans 400/500/600/700 for prose. Three steps plus micro:

- micro-label — 9–10px mono, uppercase, `letter-spacing .14em–.2em`, `--txt3`
- data — 12–15px mono, `font-variant-numeric: tabular-nums`
- display — 24–54px mono/700
- prose — 12.5–17px sans, `line-height 1.55–1.65`, `text-wrap: pretty`

**Spacing.** Region padding `64px 40px` desktop, `30px 18px` mobile. Row padding `9px 0` to `13px 16px`. Grid gaps 1px (hairline) or `24px 40px` (risk grid).

**Radius.** `0`, everywhere, no exceptions.

**Borders.** `1px` throughout this route. Both `0.5px` and `1px` exist in the wider design and are different decisions — landing uses `1px` only. Pro's top border is the sole `2px`.

**Shadows.** None. The design has no shadows.

## Accessibility

Text/background pairs, all of which must clear **4.5:1**: `--txt` on `--bg0`; `--txt` on `--bg1`; `--txt2` on `--bg0`; `--txt2` on `--bg1`; `--txt3` on `--bg0`; `--bg0` on `--accent` (the inverse pair — check it too); `--green` on `--bg1`; `--red` on `--bg1`.

`--txt4` appears only on the excluded-feature `✕` and the card-footer route string. Both are non-essential and paired with a text label, so they are exempt — but if either becomes the only carrier of meaning, re-token it rather than darkening it.

**Never apply alpha to a token to de-emphasise it.** That pattern has produced sub-AA text repeatedly in this codebase. Size and weight carry de-emphasis; the tokens are already tuned to the line.

**Interactive targets ≥ 24×24px** (WCAG 2.2 AA, SC 2.5.8 — not 44, which is AAA). The mobile `EN ▾` control paints at about 22px and needs `min-height: 24px` without changing its painted box.

Focus must stay visible on `--bg0`. The route already sets `dir` per locale; nothing in this design introduces a new direction-aware element, and the removed step arrows took one away.

## Testing note

Coin prices arrive over `wss://stream.binance.com`, which Playwright's `page.route` cannot intercept. **The ticker and the hero read panel are not fixture-measurable.** Their structure and geometry can be asserted; their colours and values cannot, unless the store is stubbed above the socket. Criteria 24–28 in the spec name their fixtures explicitly for this reason.

## Assets

- `design_files/assets/logo.png` — the app icon, supplied by the owner. Used at 26×26 in the desktop nav, 22×22 in the mobile header, 30×30 in the footer. **No border radius.**
- Fonts: IBM Plex Mono and IBM Plex Sans. The repo already self-hosts Plex Mono in `app/fonts/`; Plex Sans replaces Figtree in this direction.
- No other imagery. The product is the imagery — there is no stock photography anywhere in this design, and none should be added.

## Files

| File | What it is |
|---|---|
| `design_files/Landing 7a.dc.html` | The design reference. Two frames: desktop 1440×3236, mobile 390×3236. Open in a browser. |
| `design_files/support.js` | Runtime the prototype needs in order to render. **Not part of the implementation.** |
| `design_files/assets/logo.png` | The logo asset. |
| `specs/landing.md` | **Normative.** Per-panel geometry, colour rules, extend rules, states, and 36 numbered acceptance criteria QA scores against. Read this before writing code. |

### Source files this screen replaces

- `app/[locale]/page.tsx` — the route
- `components/LandingContent.tsx` — all current markup
- `components/StaticShell.tsx` — reference only; it takes no props, so landing needs its own nav at the shell's 56/52 geometry
- `lib/i18n/dictionaries` — every string
- `lib/terminalTokens.ts` — the palette

## Open decisions

Three items need the owner before this is complete. None blocks starting.

1. **Removing `BeamsBackground` and `.lp-hero-glow`.** Reasoning above; needs an explicit yes against the "do not remove" rule.
2. **Light theme.** The frames are dark-only and the premise does not survive inversion as a recolour. Recommendation: terminal is dark-only, and the theme toggle is *absent* — not disabled — on `?design=terminal` routes.
3. **Which coin the hero read shows**, and the ticker's coin order. The spec defaults to BTC at the default timeframe and the store's existing order.
