# Arena — `Arena 1a.dc.html · 1a`

## Source

**Frame:** `Arena 1a.dc.html · 1a`. Three frames in one file: desktop **1440×1980**, mobile **390×2090**, and a 420px free-user detail column showing the two Pro slots.

**Route:** `/arena` → `app/arena/page.tsx`
**Flag:** `?design=terminal`

**Do not measure from `Monochrome Terminal.dc.html · 1a`.** It carries direct-manipulation artifacts (rail 304, verdict 24, band width 1142, hardcoded heights) and is retained only as the artifact-detector control.

**Conflicts.** None. The frame is authored end to end — a search for `: ` inside any style attribute returns zero. Where the old frame and README disagreed, this file carries the reasoned reconstruction: rail **352** (three sibling frames), verdict **34px** desktop (README:103), verdict **26px** mobile (*ratio argument only — the softest of the five, do not cite as measured*), band **full 1440**, rail height **flex**.

**Structure decision:** one scroll. All 15 modules in production order, restyled. No regrouping, no tabs. Tabs are a separate proposal for the owner.

---

## Layout — desktop

Ground `--bg0`. `border-radius: 0` on every element. Regions separated by `1px --bdr`.

| # | Region | Height | Module |
|---|---|---|---|
| 1 | Nav | 44 | shell |
| 2 | Ticker | 34 | shell |
| 3 | Hint band | 36 | `PageHint` + `Tip` |
| 4 | Snapshot band | 88 | `CoinIcon` + `CoinMarketSnapshot` + `HigherTfMoveBadge` |
| 5 | Verdict band | auto | the read |
| 6 | Timeframe row | 42 | gated selector |
| 7 | Body | fills | main column + 352 rail |

**Body split:** main `flex: 1; min-width: 0`, rail **352** fixed, `border-right: 1px --bdr` on the main column.

**Main column, in order:** chart 430 → Confluence → (`MultiTFAlignment` | `MarketStructure`) → (`EMASignal` | `AbsorptionDetector`) → `LiqHeatmap` fills.

The two paired rows are `display: flex`, each half `flex: 1; min-width: 0`, divided by `1px --bdr`.

**Rail, in order:** `UsageMeter` → clusters → Why → evidence → session history, then a flex spacer.

**Panel header pattern** — every panel in the body uses it: height **30**, `padding: 0 16px`, `border-bottom: 1px --bdr`, title 10px mono/700 `.16em` uppercase `--txt2`, optional `PRO` chip, flex spacer, right-side count at 10px mono `.1em` `--txt3`. Rail headers are height **28**, `padding: 0 16px`, same type.

**Row hairlines inside panels are `--bdr3`** (`#16191b`), not `--bdr2`. The rail's list rows use `--bdr3` too. `--bdr` is structural only.

## Layout — mobile (390×844 viewport, 2090 scroll)

A separate layout, not a reflow. **Breakpoint 768px.**

| Region | Desktop | Mobile |
|---|---|---|
| Nav | 44 | **38** |
| Ticker | 34 | **absent** — replaced by a 44 symbol row |
| Snapshot band | 88, 5 cells + badge | **absent as a band**; `HigherTfMoveBadge` becomes its own block |
| Verdict | band, 330 + 4 cells + action col | **stacked block**, 3 level cells in a `1fr 1fr 1fr` grid, full-width action |
| Verdict size | 34px | **26px** |
| Timeframe row | 42 | **40**, horizontal overflow hidden |
| Chart | 430 | **210** |
| Confluence factors | 4-col grid | **stacked rows** |
| MTF row | bar + RSI + bias label | bar + RSI, **bias label absent** |
| Structure row | type + dir + price + ago | type + price + ago, **dir glyph absent** |
| Absorption | score + 3 breakdown bars | score + label, **breakdown bars absent** |
| Evidence row | marker + label + value + note | marker + label + value, **note absent** |
| Rail | 352 aside | **absent** — clusters and session history do not render on mobile |
| Tab bar | — | **60**, five destinations |
| Section padding | `0 16px` | `0 14px` |

`CoinMarketSnapshot`'s five stats, the cluster ladder, the liquidation heatmap and session history are **absent at mobile**, not hidden. See §Absent vs hidden.

---

## Panel inventory — the 15 modules

Production order preserved. Nothing dropped.

| Module | Position | Geometry |
|---|---|---|
| `PageHint` | 3 | hint band, left, 2px `--accent` bar + 12.5px `--txt2` |
| `Tip` | 3 | hint band, right, `DISMISS ✕` 10px mono `.12em` `--txt3` |
| `CoinIcon` | 4 | 32×32, `1px --border-input`, in the 330 coin cell |
| `CoinMarketSnapshot` | 4 | 5 cells `repeat(5, 1fr)`, `padding: 0 18px`, label 9.5px `.16em` `--txt3` / value 14px/600 / note 10px `--txt4` |
| `HigherTfMoveBadge` | 4 | 230 right cell, 2px marker + 9.5px `.16em` heading + 11.5px body |
| `KLineProChart` | body 1 | **430** tall, `padding: 16px 62px 24px 16px`, right gutter carries price tags |
| `ConfluenceScore` | body 2 | header 30 → score row 18px padding → 4-col factor grid. **Pro** |
| `MultiTFAlignment` | body 3 left | 7 rows, `padding: 9px 16px`, tf 32 / icon 14 / bar flex / rsi 26 / bias 64 |
| `MarketStructure` | body 3 right | 4 event rows `padding: 11px 16px` + a last-flip line |
| `EMASignal` | body 4 left | 6 conditions in a 2-col grid + 4 values in a 4-col grid |
| `AbsorptionDetector` | body 4 right | score row + 3 breakdown bars. **Pro** |
| `LiqHeatmap` | body 5 | fills remaining, 40×16 cells on `#0a0710`, `padding: 12px 58px 12px 12px` |
| `UsageMeter` | rail 1 | `padding: 14px 16px`, 3px track |
| `UpgradeGateModal` + `LockedFeatureCard` | — | see §Pro surfaces |

Frame-only regions not backed by a named component — **these are new surface, not moved panels**: the verdict band, the cluster ladder, the Why paragraph, the evidence list, session history. The evidence list in particular is my proposal; there is no `EvidenceGrid` in the codebase.

---

## Colour is data

`fire` is a field on the data. A value is coloured because that signal fired.

### Evidence list — per row

```
fire = 'red'    → value --red,   marker --red      fired as a warning
fire = 'green'  → value --green, marker --green    fired as confirmation
fire = null     → value --txt,   marker --mark-idle
value missing   → em dash --txt2, marker --mark-idle
```

**Direction is not the sign of the number.** Crowded-long funding is `+0.0132%` and **red**, because crowded is a warning. Overbought RSI is high and red for the same reason.

In the frame, **2 of 8 rows carry colour**. The six quiet rows include four positive numbers, and they render `--txt`. Colouring them green would look better, be wrong, and pass every automated check — `--green` is a legal token.

| Row | Value | Colour | Why |
|---|---|---|---|
| `FUNDING 8H` | `+0.0132%` | `--red` | crowded long, fired as warning |
| `CVD 4H` | `Bull div` | `--green` | fired as confirmation |
| `OI 1H` | `+2.31%` | `--txt` | positive, did not fire |
| `VWAP` | `+0.42%` | `--txt` | positive, did not fire |
| `CB PREM` | `—` | `--txt2` | no source wired |
| `TAKER BUY` | `58%` | `--txt` | did not fire |
| `BASIS` | `+0.18%` | `--txt` | positive, did not fire |
| `LIQ 15M` | `$412M` | `--txt` | did not fire |

### Verdict

The verdict string takes the read's colour — `--green` bullish, `--red` bearish, `--txt2` neutral or mixed. The confidence fill matches. It is green in the frame because the fixture is bullish; **do not hardcode it.** The frame draws both variants so the switch is visible.

No read available → `NO READ` in `--txt2`, confidence row absent, levels em-dashed, panel keeps its height.

### Confluence factors

Colour is the vote, not the sign:

```
bull contribution      → --green, marker --green
bear contribution      → --red,   marker --red
penalty applied        → --accent, marker --accent, row bg rgba(217,166,38,.06)
penalty clear          → --txt3,  marker --mark-idle, value reads CLEAR
```

A cleared penalty is a *good* outcome rendered quiet. It is not green.

### Multi-timeframe

`rsi > 57` → `BULLISH` `--green`; `rsi < 43` → `BEARISH` `--red`; otherwise `NEUTRAL` `--txt3` with the bar in `#2a2e32`. The bar's 30% and 70% gridlines are `#2a2e32` and are not signals.

### Market structure

`BOS`/`CHoCH` are labels; colour carries **direction only** — up `--green`, down `--red`. A CHoCH is not more significant in colour than a BOS.

### EMA conditions

`pass` → `✓` `--green`, label `--txt`. `fail` → `✕` `--red`, label `--txt2`. The four average *values* are all `--txt` — line colour is a chart concern, not a signal.

### Elsewhere

Ticker change maps sign to colour (a price change genuinely is directional). Entry/Stop/Target are `--txt` always — prices, not signals. Cluster bars take side, not size: below spot `--red` (long liquidations), above `--green`.

**Outside the ticker, verdict, evidence, confluence, MTF, structure, EMA conditions and clusters, nothing on this route is green or red.**

---

## Pro surfaces

The entitlement check sits at the **call site**, not inside the component. Moving a panel moves its markup and leaves its guard behind — that shipped once and free users saw the paid score.

### `ConfluenceScore` — locked card, in the main column

```tsx
{authLoading || entitled ? <ConfluenceScore … /> : <LockedFeatureCard onUnlock={…} />}
```

**Free user sees a locked card**, at the same position and full main-column width. Frame: 420×300 detail card. Padlock 22×26 stroke `--txt3`, title 15px mono/700 `.06em` `--txt`, one line of 13px `--txt2` body, and an `UNLOCK WITH PRO` button — height 40, `padding: 0 20px`, `--bg0` on `--accent` — wired to `UpgradeGateModal`.

This is the panel worth paying for, and the main column is wide enough for the card to read as an offer rather than an obstruction. **Do not replace it with nothing** — that deletes a conversion surface and the `onUnlock` path.

### `AbsorptionDetector` — absent

```tsx
{entitled && <AbsorptionDetector … />}
```

**Free user sees nothing.** `EMASignal` takes the full width of body row 4 instead. A second locked card next to the first is noise, and Absorption is a supporting signal rather than the headline.

### `UsageMeter`

Pro: `14 / UNLIMITED`, fill `--green`. Free: `2 OF 3 USED`, fill `--accent`, an `UPGRADE` link at 11px `--accent`. At 3 of 3 the re-run button goes `--txt3` and opens the modal instead of running.

**The asymmetry between the two Pro panels is deliberate and must survive.** It is production's existing behaviour and it is correct.

---

## Timeframe row — three states

`GATED_TFS = ['1m','5m','15m']`, fallback `1h`, from `lib/limits.ts`.

```
active     bg --accent, text --bg0, weight 700, border --accent
available  bg transparent, text --txt2, weight 400, border --bdr
gated      bg transparent, text --txt3, weight 400, border --bdr3,
           PLUS a padlock glyph 9×11 stroke --txt3 inside the chip
```

**Gated must be legible without colour.** `--txt2` and `--txt3` are close, so the padlock carries the state, and the row ends with `1M · 5M · 15M NEED PRO` at 10px mono `.1em` `--txt3`.

Chip geometry: `padding: 6px 12px`, `gap: 6px`, `gap: 2px` between chips. Mobile `padding: 6px 10px`, glyph 8×10.

Clicking a gated chip opens `UpgradeGateModal` and does not change the timeframe. A free user landing on a gated timeframe is forced to `1h`.

---

## Absent vs hidden

**This is the screen where it costs real resources.** Rendering both layouts and hiding one means two `KLineProChart` instances and two candle subscriptions. That already shipped once.

Select with `useSyncExternalStore` over `matchMedia('(min-width: 768px)')` and render **one tree**.

At mobile these must **not exist in the DOM** — not `display: none`:
`CoinMarketSnapshot`'s five stat cells · the 352 rail entirely (clusters, session history) · `LiqHeatmap` · the ticker strip · evidence-row notes · MTF bias labels · structure direction glyphs · absorption breakdown bars.

At desktop the mobile tree must not exist.

Criterion 24 tests by node count, not computed style. Criterion 25 counts chart instances.

---

## Honest labels

- **`CB prem`** — no source wired. Renders an em dash in `--txt2`, **always**. The row stays so the layout is stable. Never a number, never a zero.
- **`Liq 24h`** in the mock is a **15-minute** Binance window for us. Labelled **`LIQ 15M`**. The string `Liq 24h` must not appear.
- Any other row whose window differs from its mock label is relabelled the same way before it ships.

Labels are DB-driven and can change length at runtime. Nothing on this route may use a fixed width or `text-overflow: ellipsis`.

---

## States

| State | Behaviour |
|---|---|
| Default | as specified |
| Loading | `SkeletonBar` per value. Verdict slot skeleton, confidence track empty at `--bdr`, levels and evidence em-dashed. Panel heights held — no reflow. |
| Empty | `NO READ` in `--txt2`, confidence row absent, everything else em-dashed |
| Error | as empty, plus a `STALE` marker in the band's right cell. No retry button in the band; the re-run action already exists. |
| Signed out | route redirects to `/login`; no Arena markup mounts |
| Free | Confluence locked card, Absorption absent, `UsageMeter` at `n of 3`, gated timeframes locked |
| Pro | all 15 modules render |

---

## Accessibility

Pairs requiring 4.5:1: `--txt`/`--bg0`, `--txt`/`--bg1`, `--txt2`/`--bg0`, `--txt2`/`--bg1`, `--txt3`/`--bg0`, `--bg0`/`--accent`, `--green`/`--bg1`, `--red`/`--bg1`, `--green`/`--bg0`, `--red`/`--bg0`.

> **Amendment — 2026-09-01, owner-approved.** This clause and the original
> `--txt3` value were in direct conflict. `--txt3` `#5a5f66` on `--bg0`
> `#08090a` measures **3.10:1** — the pair is named in the list above, and it
> failed the bar the list sets. On the original `--bg1` `#0c0d0f` it is
> **3.03:1**.
>
> `--txt3` is now **`#7c828a`** and `--bg1` is now **`#141517`**: **5.14:1** on
> `--bg0`, **4.78:1** on `--bg1`. `--border-input` is now **`#5e646b`**, for
> WCAG 1.4.11's separate 3:1 component-boundary bar (**1.36:1** before,
> **3.14:1** after). Every pair above now clears 4.5:1.
>
> Rationale, originals, and the alternatives considered are in the README's
> Design tokens amendment.
>
> **Acceptance criterion 19** — "every colour on the route is one of the 15
> tokens in `lib/terminalTokens.ts`" — is scored against the **amended** values.

`--txt4` appears only on snapshot notes and structure timestamps — non-essential, paired with a labelled value. `--mark-idle` is a 2px marker, decorative.

**Never apply alpha to a token to de-emphasise it.**

Interactive targets **≥24×24**. Timeframe chips measure 27 tall — compliant. The `DISMISS ✕` needs `min-height: 24px`.

Focus: `2px solid --accent`, offset 2; offset `-2` inside grid cells.

The heatmap encodes magnitude in colour alone. It is supported by the cluster ladder immediately beside it in the rail, which states every level numerically — that ladder is **absent on mobile**, so at mobile the heatmap is absent too rather than left as an unsupported colour-only graphic.

---

## Fixtures

Candles and prices arrive over `wss://stream.binance.com`, which `page.route` cannot intercept.

| Region | Fixture-measurable |
|---|---|
| Nav, hint band, timeframe row, panel headers, Pro slots | **yes** |
| Chart, ticker, snapshot, heatmap | **no** — WebSocket |
| Verdict, evidence, confluence, MTF, structure, EMA, absorption | **only if the read store is stubbed above the socket** |

Criteria 12–18 name their fixture. If the store cannot be stubbed, mark them unverifiable and check by inspection — do not score the route green against a starved page.

---

## Out of scope

- Tabs / regrouping — separate proposal, owner's call
- `KLineProChart`'s internals — it is restyled by tokens, not rebuilt
- `/upgrade` and `/login` destinations
- The old `Monochrome Terminal.dc.html · 1a` frame
- Empty-watchlist and coin-picker flows
- Light theme — terminal is dark-only, toggle absent

---

## Acceptance criteria

**Structure**
1. Desktop renders 7 top-level regions in order: nav, ticker, hint band, snapshot band, verdict band, timeframe row, body.
2. Body is exactly 2 columns; the rail's `offsetWidth === 352`.
3. Main column contains 5 panels in order: chart, confluence, (MTF | structure), (EMA | absorption), heatmap.
4. Rail contains 5 panels in order: usage, clusters, why, evidence, session history.
5. All 15 named modules render for an entitled user.
6. Every element computes `border-radius: 0px`.

**Geometry — desktop 1440**
7. Nav 44, ticker 34, hint band 36, snapshot band 88, timeframe row 42.
8. Chart panel `offsetHeight === 430`.
9. Verdict text `font-size: 34px`, colour `--green` under the bullish fixture.
10. Every body panel header `offsetHeight === 30`; every rail header `28`.
11. Verdict band spans the full 1440 shell — its `offsetWidth` equals the frame's inner width, with no fixed px width in its style attribute.

**Colour as data** *(stubbed read)*
12. Fixture: 2 of 8 evidence rows with a truthy `fire`. Exactly 2 values compute `--green` or `--red`; the other 6 compute `--txt`.
13. The `FUNDING 8H` row is `--red` while its value string starts with `+`.
14. Fixture: bearish read. Verdict computes `--red`, `font-size` still 34px, bounding box unchanged from the bullish fixture.
15. Fixture: null evidence value. That row renders an em dash in `--txt2` and no numeral.
16. `CB PREM` renders an em dash under every fixture. The string `Liq 24h` appears nowhere.
17. Confluence rows with a cleared penalty compute `--txt3` and read `CLEAR` — not `--green`.
18. MTF rows with `43 ≤ rsi ≤ 57` compute `--txt3` with the bar at `#2a2e32`.
19. Every colour on the route is one of the 15 tokens in `lib/terminalTokens.ts`.

**Timeframes**
20. Exactly 3 chips render a padlock glyph, and their labels are `1m`, `5m`, `15m`.
21. Exactly 1 chip computes `background: --accent`.
22. Clicking a gated chip opens the upgrade modal and does not change the active chip.
23. The row contains the text `NEED PRO`.

**Absent vs hidden**
24. At 1440, `[data-layout="mobile"]` node count is 0. At 390, the desktop tree count is 0. By node count, not computed style.
25. Exactly one `KLineProChart` instance mounts at any viewport width, and exactly one candle subscription is open.
26. At 390, the rail does not exist in the DOM — clusters, session history and heatmap all absent.

**Gating**
27. Signed out as free: `ConfluenceScore` does not render, and a `LockedFeatureCard` renders in its position at full main-column width.
28. Free: `AbsorptionDetector` renders nothing — no locked card, no empty region — and `EMASignal` occupies the full width of body row 4.
29. Free: `UsageMeter` reads `n OF 3` with the fill computing `--accent`.
30. The locked card's unlock control is present and opens `UpgradeGateModal`.

**Copy**
31. No user-visible string is a literal in the component; all resolve through `dict.*` (source lint, not a DOM check).

**Mobile 390**
32. Nav 38, symbol row 44, timeframe row 40, chart 210, tab bar 60.
33. Verdict text `font-size: 26px`.
34. Levels render as 3 cells in one row.
35. Every control's bounding box is ≥24×24.

---

## Could not determine

1. **Whether the hint band is dismissible per session or per user.** Frame shows `DISMISS ✕`; I could not read the persistence.
2. **Heatmap timeframe coupling.** Frame shows `7D` while the chart shows `4H`. Whether the heatmap follows the timeframe selector or holds its own window is a product decision.
3. **Session history depth.** Frame shows 4; production may hold more. Extends downward in the same row pattern.
4. **What `CHoCH` should read as in a non-English locale** — it is a term of art and may be untranslated. Flagging rather than choosing.
