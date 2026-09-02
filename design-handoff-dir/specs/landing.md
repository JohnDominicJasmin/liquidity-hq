# Landing page — `Monochrome Terminal.dc.html · 7a`

---

## Read this first — the frame you asked for is superseded

The brief names `Monochrome Terminal.dc.html · 6a`. **Do not build 6a.**

`6a` was drawn before I read `components/LandingContent.tsx`. It is missing five sections that exist in production today, and it invents content that does not exist:

| | `6a` (superseded) | Production | `7a` (this spec) |
|---|---|---|---|
| Feature cards | 8, invented | 6, from `FEATURE_META` | 6, correct |
| How it works | absent | present | present |
| Final CTA | absent | present | present |
| Footer columns | 1 line | 4 columns, 28 links | 4 columns, 28 links |
| Risk disclosure | 1 sentence | 6 items | 6 items |
| Language switcher | absent | present | present |
| Coins claimed | 28 | 50 | 50 |
| Pro price | not shown | $25 | $25 |

`7a` sits at the top of the same file, badge `7A`, id anchor `id="7a"`. `6a` is directly below it and is left in place for comparison only.

Building `6a` would delete 5 sections and 24 links from production — a §4 failure on its own. **Every number in this spec is read off `7a`.**

---

## Source

**Frame:** `Landing 7a.dc.html · 7a` (desktop 1440×3236, mobile 390×3236)

`7a` was authored in the design session and never reached the repo — QA measured its absence correctly. It now ships as its own file, `handoff/Landing 7a.dc.html`, one frame per file so a bare badge cannot be ambiguous. It needs `support.js` and `assets/logo.png` beside it, both included.
**Route:** `/` → `app/[locale]/page.tsx` → `components/LandingContent.tsx`
**Flag:** `?design=terminal`, `localStorage` key `lhq-design-mode`

### Route → frame map for every screen this spec touches

| Route | File · badge |
|---|---|
| `/` | `Monochrome Terminal.dc.html · 7a` |
| `/disclaimer` (shell reference only) | `Monochrome Terminal - Static.dc.html · 3a` |

### Conflicts, and which wins

**1. Nav height — resolved in the frame. No conflict remains.**

The earlier draft of `7a` had a 60px nav against the shell's 56. Rather than leave a standing frame-vs-spec exception for someone to trip over, **the frame now says 56/52** and matches `Monochrome Terminal - Static.dc.html · 3a` and the merged `StaticShell`. Frame and spec agree; the "frame wins" rule needs no exception here.

Same treatment for radius: the earlier frame rounded the logo 6px, which contradicted the design's own rule. **The frame is now `border-radius: 0` on every element including the logo**, matching criterion 12.

**2. Hero H1 — 52 (README:59) vs 54 (frame `7a`). The frame wins. Build 54.**

Standard §1 resolution, no exception needed.

**3. README vs frame generally.** Standing rule per §1: **the `.dc.html` frame wins over the handoff README.** Each number below cites `7a`.

One correction to the issue's example, since it will otherwise be chased: the README does **not** state 34px for `/disclaimer`'s title. It gives no px value for those pages at all — it describes them as "numbered sections with a contents rail" (README line 172). Its three `34px` mentions are the type-scale ceiling (line 59), the ticker-strip height (line 80) and Arena's verdict (line 103). Frame `· 3a` says **32px** (line 68) and always has. Whatever produced the built 34 came from somewhere other than the README, and it is worth finding, because that source will do it again.

---

## Layout — desktop

Page width 1440. Ground `--bg0`. **`border-radius: 0` on every element on this route, no exceptions** — including the logo image, which the frame rounds but the design rule does not permit. Section order, top to bottom, each separated by a `1px` `--bdr` rule:

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

Cumulative top edges: nav 0, ticker 56, hero 90, then flow.

Hero splits `flex: 1` (left) and a fixed **472px** right column. Features and risk disclosure are 3-column grids; footer links are 4 columns beside a fixed **290px** brand column.

Grid gaps are `1px` with the container painted `--bdr`, so the gap *is* the hairline — not a `gap` plus a `border`. Both `0.5px` and `1px` exist in this design and are different decisions; **on this route every rule is `1px`** except the intra-card divider in feature cards and pricing rows, which is `1px --bdr2`.

## Layout — mobile (390×844)

A **separate layout**, not a reflow. Values that differ from desktop:

| Region | Desktop | Mobile |
|---|---|---|
| Nav height | 56 | **52** |
| Nav padding | `0 40px` | `0 16px`, gap 9 |
| Ticker height | 34 | **30** |
| Hero padding | `76px 40px 64px` | `34px 18px 30px` |
| Hero H1 | 54px | **32px**, `line-height 1.1` |
| Hero layout | 2 columns, gap 56 | **stacked**, live-read panel below the CTAs |
| Hero stats | 4 across, dividers | **2×2 grid**, `gap 1px` on `--bdr` |
| Features grid | 3 columns | **1 column** |
| How-it-works steps | 4 across | **stacked**, `gap 16px` |
| Pricing | 2 across | **stacked**, Pro below Free, `margin-top 14px` |
| Footer links | 4 columns | **2×2 grid**, `gap 22px` |
| Risk disclosure | 3 columns | **stacked**, `gap 16px` |
| Section padding | `64px 40px` | `30px 18px` |

**Breakpoint: 768px.** Below it, mobile layout; at and above it, desktop.

### The two layouts are alternatives, not one hidden

Per §9 and the `display:none` finding: do **not** render both and hide one. A hidden subtree still mounts, and on this route that would mean two ticker subscriptions against `wss://stream.binance.com`.

Select with `useSyncExternalStore` over `matchMedia('(min-width: 768px)')` and render **one tree**. At desktop the mobile markup must be **absent** — `offsetParent === null` is not sufficient; the node must not exist. Acceptance criterion 26 tests this by node count, not by computed style.

---

## Panel inventory

Everything on `/` today, and where it goes. Diffed against `components/LandingContent.tsx`. Nothing is dropped.

| Panel (exists today) | New location | Notes |
|---|---|---|
| `BrandMark` + wordmark | Nav, left | Logo 26×26 desktop / 22×22 mobile |
| `LanguageSwitcher` | Nav, right of spacer | Kept as a control — see §Controls |
| Sign In → `/login` | Nav, right | Ghost button |
| Get Started → `/login?signup=1` | Nav, far right | Accent button |
| `BeamsBackground` + `.lp-hero-glow` | **Removed** | See §Duplication / removals below |
| Hero badge + live dot | Hero, top of left column | |
| H1, two lines, 2nd accented | Hero left | Treatment changes, copy does not |
| Hero sub | Hero left | |
| Primary CTA → `/login?signup=1` | Hero left, CTA row | |
| Ghost CTA → `/briefing` | Hero left, CTA row | |
| 4 hero stats | Hero left, below rule | 50 / 35 / Grok / Live |
| — | **Hero right: live read panel** | **New relative to production.** Present in `6a` too — this inventory diffs against `LandingContent.tsx`, not against `6a`, and production has no live read. Not evidence of a stale handoff. |
| 6 feature cards | Features grid | Order and routes unchanged |
| Feature pills | Inside each card | |
| "Open →" per card | Card footer | |
| How-it-works steps | Section 5 | Arrow connectors replaced — see below |
| Pricing Free `$0` | Pricing left | |
| Pricing Pro `$25` + badge | Pricing right | |
| Free feature list, `✓`/`✕` | Free plan | |
| Pro feature list, `✓` | Pro plan | |
| Free CTA → `/login?signup=1` | Free plan footer | |
| Pro CTA → `/upgrade` | Pro plan footer | |
| Final CTA h2 + sub + button | Section 7 | |
| Footer brand + description | Footer, 290px column |
| Footer Product column (4 links) | Footer | |
| Footer Analysis column (4 links) | Footer | |
| Footer Tools column (4 links) | Footer | |
| Footer Account column (8 links) | Footer | |
| `RISK DISCLOSURE` divider | Footer | |
| 6 risk disclosure items | Footer, 3-col grid | |
| Copyright + full-disclaimer link | Footer legal block | |
| Agreement line, 4 legal links | Footer legal block | |
| `.lp-loading` session splash | Unchanged | See §States |
| Signed-in redirect to `/arena` | Unchanged | See §States |

**Link census: 28.** Fewer than 28 anchors on the route is a §4 regression.

### Removals and additions — both are decisions, flagged as such

**Removed — needs the owner's explicit yes, per QA. `BeamsBackground` and `.lp-hero-glow`.** These are animated gradient washes behind the hero. They are decoration, not a panel: no text, no link, no data. They are also directly contrary to the stated design rule (flat near-black ground, hairline separation, one accent). The no-lost-components check counts links, buttons and headings — this removes none of those, so it will pass, but I am naming it here rather than letting it look like an oversight. **If the owner wants motion in the hero, it needs a separate decision; this spec specifies none.**

**Added: the live read panel** (hero right, 472px). This is new surface, not a moved panel. Rationale: the page currently asserts the product's value in prose; this shows it. It is the only element on this route carrying live data.

**Duplication check (§5):** the live read panel shows the same verdict the Arena screen shows. That is not duplication in the owner's sense — different route, different audience, signed-out vs signed-in. No two panels *on this route* show the same data.

**Changed treatment, not content:** the how-it-works arrow connectors (`stepArrow`, direction-aware for RTL) are replaced by numbered boxes. The step count, titles and descriptions are unchanged. **RTL note:** the arrow was the only RTL-aware element in that section; numbered boxes are direction-neutral, which removes an RTL branch rather than breaking one.

---

## Per-panel spec

Colours are token names. See §Token mapping for the hex each one must resolve to, and confirm against `lib/terminalTokens.ts` before build.

### Nav

**Landing defines its own nav component.** `components/StaticShell.tsx:41` takes no props and hardcodes the marketing nav plus a 264px index rail that landing does not have. Refactoring it to take props is a larger change than this screen warrants. So: a landing-owned nav that **matches the shell's geometry exactly** — 56/52 — so the two routes cannot drift apart visually.

If `components/TerminalNav.tsx` already carries the wordmark and button styling, compose from it; `activeDestination(pathname)` is not needed here, since landing has no destination nav.

```
GEOMETRY  height 56 (mobile 52), padding 0 40px (mobile 0 16px), gap 12 (mobile 9)
          border-bottom 1px --bdr
          logo 26×26 (mobile 22×22), radius 0
TYPE      wordmark  IBM Plex Mono 14px/700, letter-spacing .16em, --txt
                    (mobile 11.5px, .14em)
          buttons   IBM Plex Mono 11.5px, letter-spacing .12em
                    real uppercase text, NOT text-transform
CONTROLS  LanguageSwitcher — control. Border 1px --bdr, padding 6px 11px,
                    globe glyph 13×13 stroke --txt2 width 1.4, label 11px --txt2,
                    caret 9px --txt3. Opens the existing locale menu; behaviour
                    unchanged from production.
          SIGN IN  — control. Ghost: border 1px --border-input, --txt2,
                    padding 9px 16px. → /login
          GET STARTED — control. Fill --accent, text --bg0, 700,
                    padding 10px 18px. → /login?signup=1
          Mobile: language control collapses to "EN ▾", primary button
                    label shortens to "START". Both remain controls.
STATES    hover  ghost border → --txt3;  accent fill unchanged, opacity 0.9
          focus  2px outline --accent, offset 2px, never removed
          active/disabled  none on this route
GATING    Free. Public route.
```

### Ticker

```
GEOMETRY  height 34 (mobile 30), border-bottom 1px --bdr
          cell padding 0 16px (mobile 0 12px), gap 8 (mobile 6),
          border-right 1px --bdr3, flex-shrink 0 per cell
TYPE      symbol 11px/600 mono .06em --txt2  (mobile 10px)
          price  11px mono --txt, tabular-nums   (mobile: omitted)
          change 11px mono, tabular-nums
DATA      Source: the same market store the app uses — WebSocket, not fixtures.
          Frame shows 8 coins. We have 50.
          EXTEND: render all tracked coins in the same cell pattern, single row,
          horizontal overflow hidden. Do NOT wrap to a second row and do NOT
          truncate to 8.
          Mobile adds a right edge fade so a clipped cell reads as scrollable
          rather than broken:
            mask-image: linear-gradient(90deg, #000 86%, transparent)
            -webkit-mask-image: same   ← both required
COLOUR    change value: positive → --green, negative → --red, at 80% alpha.
          This is the ONE place on this route where sign maps to colour, and it
          is correct here: a price change genuinely is directional. Nowhere else.
          null / missing → em dash in --txt2. Never a zero.
CONTROLS  Display only. Not focusable, no hover.
GATING    Free.
```

### Hero — left column

```
BADGE     inline-flex, border 1px --bdr, ground --bg1, padding 7px 13px, gap 8
          dot 6×6 --green (5×5 mobile)
          text 10.5px mono .16em uppercase --txt2  (mobile 9.5px, .14em)
H1        54px mono/700, line-height 1.06, letter-spacing -.015em, --txt
          margin-top 26
          line 2 in --accent
          MOBILE 32px, line-height 1.1, margin-top 18
SUB       17px sans, line-height 1.6, --txt2, margin-top 22, max-width 600
          text-wrap: pretty
          MOBILE 14.5px, margin-top 14, no max-width
CTAs      row margin-top 30, gap 12  (mobile: stacked, gap 9)
          primary  height 50, padding 0 30px, fill --accent, text --bg0,
                   13px mono/700 .12em          (mobile height 48, full width)
          ghost    height 50, padding 0 26px, border 1px --border-input,
                   13px mono .12em --txt2       (mobile height 46, full width)
STATS     margin-top 40, border-top 1px --bdr, padding-top 24
          each cell padding-right 38, margin-right 38, border-right 1px --bdr
          value 26px mono/700 --txt, line-height 1
          label 9.5px mono .16em --txt3, margin-top 8
          MOBILE 2×2 grid, gap 1px on --bdr, cell padding 13px 14px,
                 value 20px, label 8.5px .14em
          FIXED at 4. These are copy, not data — they do not extend.
CONTROLS  Both CTAs are controls. Everything else display.
GATING    Free.
```

### Hero — right column: live read panel

**The only data-driven panel on this route. §3 applies in full.**

```
GEOMETRY  width 472 desktop; full width mobile, ground --bg1, border 1px --bdr
          header 34 tall, padding 0 14px, gap 9
          body padding 20 (mobile 18)
DATA      Source: the current read for the default coin (BTC) at the default
          timeframe, from the same store /arena reads.
          NOT FIXTURE-MEASURABLE — see §Fixtures.
HEADER    dot 5×5 --green when the feed is live, --txt4 when stale
          label 10px mono .16em uppercase --txt2
          timestamp 10px mono --txt3, right
VERDICT   32px mono/700 (mobile 26px), line-height 1
          COLOUR IS THE READ, NOT THE LAYOUT:
            bullish verdict → --green
            bearish verdict → --red
            neutral / mixed → --txt2
            no read available → "NO READ" in --txt2, confidence row hidden
          Do not hardcode green. The frame shows green because the fixture
          is bullish.
CONFIDENCE margin-top 14, track 3px --bdr, fill at the confidence %,
          fill colour matches the verdict colour above
          value 13px mono/700 --txt; "CONF" 9.5px mono .12em --txt3
LEVELS    3-column grid, gap 1px on --bdr, margin-top 16
          cell ground --bg1, padding 11px 12px (mobile 9px 10px)
          label 9px mono .14em --txt3
          value 13.5px mono/600 --txt tabular, margin-top 5 (mobile 12.5px)
          Entry / Stop / Target. All three --txt — these are prices, not
          signals, and they do not fire.
          Any level absent → em dash --txt2. Never a placeholder price.
EVIDENCE  rows padding 10px 14px, gap 11, border-bottom 1px --bdr2
          marker 2px × 18px
          label 9.5px mono .1em --txt3, width 76
          value 12.5px mono/600 tabular
          note 11px --txt3, right-aligned
          COLOUR BY fire, NEVER BY SIGN:
            fire = 'red'   → value --red,   marker --red
            fire = 'green' → value --green, marker --green
            fire = null    → value --txt,   marker --mark-idle
            value missing  → em dash --txt2, marker --mark-idle
          Direction is explicit because it is not the sign of the number:
            crowded-long funding → --red   (a warning, and it is positive)
            overbought RSI       → --red   (a warning, and it is high)
          In the frame, 2 of 6 rows carry colour. Four of the four quiet rows
          hold positive numbers and stay --txt.
          EXTEND: frame shows 6. Render every signal the read returns, same
          row pattern, no truncation and no second pattern.
LABELS    Use the honest label for our data, not the mock's:
            "CB prem"  — no source wired. Renders em dash, always. Keep the
                         row so the layout is stable; do not invent a number.
            "Liq 24h"  — ours is a 15-minute Binance window. Label "Liq 15m".
          Any other row whose window differs from its mock label must be
          relabelled the same way before it ships.
CONTROLS  Display only. Not focusable. The panel is NOT a link to /arena —
          it is proof, and a signed-out click would bounce to /login.
GATING    Free, and this is deliberate: the whole point is showing a
          signed-out visitor a real read. It shows ONE coin at ONE timeframe.
          Confluence score is NOT shown here — that is the Pro feature, and
          putting it on a public page would leak it.
```

### Features

```
GEOMETRY  eyebrow 10px mono .2em uppercase --accent
          h2 34px mono/700 --txt, margin-top 14   (mobile 24px, line-height 1.15)
          sub 15.5px/1.6 --txt2, margin-top 12, max-width 660
          grid 3 columns, gap 1px on --bdr, border 1px --bdr, margin-top 34
          MOBILE 1 column, same 1px gaps
CARD      ground --bg0, padding 24px 22px (mobile 16), flex column
          icon 24×24 stroke --accent width 1.6 round cap/join (mobile 19×19)
          title 15px mono/700 .06em --txt, margin-top 16 (mobile 13.5px, inline
                with the icon and a → at 10px --accent on the right)
          desc 13.5px/1.6 --txt2, margin-top 10, min-height 66
                min-height keeps the pill rows aligned across the row; it is
                load-bearing, not padding. DB-driven copy may be longer — the
                min-height is a floor, cards grow and the grid row grows with
                the tallest. Do not clamp or ellipsis.
          pills flex wrap gap 6, margin-top 14
                each 9.5px mono .1em uppercase --txt2, border 1px --bdr,
                padding 4px 8px          (mobile 9px, padding 3px 7px)
                EXTEND: frame shows 3 per card; render all the dict provides.
          footer pushed by a flex spacer, margin-top 20, padding-top 14,
                border-top 1px --bdr2
                "OPEN →" 10.5px mono .12em --accent
                route string 10px mono --txt4, right
                MOBILE: footer row omitted; the → in the title row carries it.
DATA      FEATURE_META in LandingContent.tsx, paired with dict.features.cards.
          6 cards. EXTEND: a 7th entry fills the next grid cell — same card,
          second row. Do not restyle for a 3+3 vs 3+3+1 difference.
CONTROLS  The WHOLE CARD is a link — it is an <a>, not a div with a link inside.
          Affordance is carried by: the "OPEN →" in accent, the route string,
          and a hover state. Not by colour alone.
          NOTE (#639, 2026-09-03): listing the route string as an affordance
          reads against the accessibility clause below, which calls it
          non-essential decoration and exempts it from 4.5:1 at --txt4.
          The owner ruled the accessibility clause wins: the route string is
          decoration, its pairing holds, and it STAYS at --txt4. Affordance
          here rests on "OPEN →" and the hover. Recorded so the tension is
          not rediscovered as a bug report against correct code.
STATES    hover  card ground → --bg1; "OPEN →" underline; 120ms ease
          focus  2px outline --accent offset -2px (inset, so it is not clipped
                 by the 1px grid gap)
GATING    Free. All six routes are Pro-gated *at their destination* for some
          panels, but the cards themselves are public and must not be locked.
```

### How it works

```
GEOMETRY  ground --bg1, padding 60px 40px (mobile 30px 18px)
          eyebrow / h2 as Features
          steps row margin-top 34, each flex:1, padding-right 22, gap 14
          MOBILE stacked, gap 16
NUMBER    box 34×34 (mobile 30×30), border 1px --accent, radius 0
          numeral 14px mono/700 --accent (mobile 13px)
TYPE      title 14px mono/700 .04em --txt (mobile 13px)
          desc 13.5px/1.6 --txt2, margin-top 9 (mobile 13px, margin-top 6)
DATA      dict.howItWorks.steps. Frame shows 4.
          EXTEND: up to 5 stay on one row at desktop; 6+ wrap to a second row
          of equal-width cells. Mobile always stacks.
CONTROLS  Display only.
GATING    Free.
```

### Pricing

```
GEOMETRY  padding 64px 40px (mobile 30px 18px)
          card row margin-top 32, gap 1px on --bdr, border 1px --bdr
          MOBILE stacked; Pro margin-top 14 and keeps its own border
FREE      ground --bg0, padding 30px 28px (mobile 20px 18px)
          name 12px mono/700 .18em uppercase --txt2
          price 46px mono/700 --txt line-height 1 (mobile 36px)
          "/mo" 14px mono --txt3
          sub 13.5px --txt2 margin-top 12
          rows margin-top 22, padding 9px 0, border-bottom 1px --bdr2, gap 12
            icon width 12, 12px mono: ✓ --green (included) / ✕ --txt4 (excluded)
            text 13.5px: --txt (included) / --txt3 (excluded)
          CTA height 46 (mobile 44), border 1px --border-input,
            12px mono .12em --txt2   → /login?signup=1
PRO       ground --bg1, border-top 2px --accent, padding 30px 28px
          name as Free but --txt
          trial chip beside the name: 9.5px mono/700 .14em, text --bg0,
            fill --accent, padding 3px 8px
          price $25
          rows all ✓ --green, text --txt
          CTA height 46, fill --accent, text --bg0, 12px mono/700 .12em
            → /upgrade
DATA      Static copy. Frame shows 8 rows each.
          EXTEND: both lists take as many rows as the copy provides; the two
          lists need not be equal length and must not be padded to match.
          These rows DESCRIBE entitlements — they must not read live
          entitlement state. If they drift from lib/limits.ts that is a copy
          bug; flag it, do not wire it.
CONTROLS  Both CTAs are controls. Rows are display.
STATES    hover on CTAs as Nav. Focus 2px --accent offset 2.
GATING    Free — the pricing page is public by definition.
          NOTE: this panel names Pro features but IS NOT Pro-gated. Do not
          wrap it in an entitled check.
```

### Final CTA

```
GEOMETRY  ground --bg1, padding 64px 40px, flex row, gap 40, align center
          MOBILE stacked, padding 30px 18px
TYPE      heading 36px mono/700 line-height 1.15 --txt (mobile 22px, lh 1.2)
          sub 15.5px/1.6 --txt2 margin-top 14 max-width 620 (mobile 13.5px)
BUTTON    height 54, padding 0 34px, fill --accent, text --bg0,
          13.5px mono/700 .12em, flex-shrink 0
          MOBILE height 48, full width, margin-top 16
CONTROLS  Button is a control → /login?signup=1
GATING    Free.
```

### Footer

```
GEOMETRY  padding 52px 40px 0 (mobile 28px 18px 0)
BRAND     column width 290 (mobile full width, above the link grid)
          logo 30×30 + wordmark 13px mono/700 .16em --txt
          description 13px/1.6 --txt3 margin-top 14
COLUMNS   4 × flex:1  (MOBILE 2×2 grid, gap 22)
          head 9.5px mono/700 .18em --txt2  (mobile 9px)
          links 13px --txt3, stacked gap 9, margin-top 14 (mobile 12.5px, gap 7)
          EXTEND: each column renders every link it has. Column count is
          FIXED at 4; link count per column is not.
DIVIDER   margin-top 40 (mobile 28), gap 14
          label 9.5px mono/700 .2em --txt3, then a 1px --bdr rule filling the row
RISK      3-column grid, gap 24px 40px, margin-top 22
          MOBILE stacked, gap 16
          label 10px mono/700 .14em uppercase --txt2 (mobile 9.5px)
          text 12.5px/1.6 --txt3 margin-top 7 (mobile 12px)
          6 items. EXTEND: a 7th fills the next grid cell.
LEGAL     border-top 1px --bdr, padding 20px 0 24px
          both lines 12.5px/1.6 --txt3 (mobile 12px, one line)
          inline links underlined, text-underline-offset 2, colour --txt3
          Underline is the affordance here, not colour — --txt3 links on a
          --txt3 paragraph are indistinguishable without it.
CONTROLS  All 28 links are controls.
STATES    hover  link → --txt
          focus  2px outline --accent offset 2
GATING    Free.
```

---

## Copy — keep the existing strings

**This is the item most likely to break something silently, so it is explicit.**

Every string on this page comes from `lib/i18n/dictionaries` via the `dict` prop, and the route is `app/[locale]/page.tsx` — **it is localised across every locale in `SUPPORTED_LOCALES`.**

The copy shown in frame `7a` is **illustrative of treatment, not a copy change.** It demonstrates: two-line H1 with the second line accented, uppercase mono headings, sentence-case sans body.

**Dev must render `dict.*` exactly as production does today.** Hardcoding the frame's English strings would break every non-English locale and would not be caught by any of the four QA checks.

If the owner wants the frame's wording, that is a **separate task**: new dict entries in every locale, reviewed per language. Do not fold it into this build.

The same applies to `lib/labelKeys.ts` DB-driven labels: any panel whose text can change length at runtime must not have a fixed width that clips it. On this route that is every feature card title and description, every pill, and every footer link. None of them may use `text-overflow: ellipsis` or a fixed width.

---

## States

| State | Behaviour |
|---|---|
| **Default** | As specified above. |
| **Loading (session)** | Unchanged from production: while `loading` is true, render `.lp-loading` — wordmark, spinner, `sr-only` status. The marketing markup does not mount. Restyle the splash to terminal ground (`--bg0`, wordmark in `--txt`) but keep its structure and its `role="status"`. |
| **Signed in** | Unchanged: `useEffect` redirects to `/arena`; the branch returns the splash, so marketing markup never paints. **Keep this.** |
| **Signed out** | The default state. This *is* the signed-out page. |
| **Live read — loading** | Verdict slot renders `SkeletonBar`; confidence track renders empty at `--bdr`; level and evidence values render em dashes in `--txt2`. Never a placeholder number, never a zero. |
| **Live read — empty** | No read available for the default coin: verdict reads `NO READ` in `--txt2`, confidence row absent, levels em-dashed, evidence rows render with their labels and em-dashed values. The panel keeps its height — it must not collapse and reflow the hero. |
| **Live read — error** | Identical to empty, plus the header dot goes `--txt4` and the timestamp reads `STALE`. No error text, no retry button — this is a marketing page and a visitor cannot act on a feed error. |
| **Ticker — no data** | Row renders at full height with cells absent rather than a row of dashes. An empty 34px rule is quieter than 50 dashes. |
| **Free vs Pro** | No difference. Signed-in users never see this page. |

---

## Accessibility

**Contrast pairs on this route.** Every pair below is text on its stated ground and must clear **4.5:1**:

| Pair | Where |
|---|---|
| `--txt` on `--bg0` | H1, headings, values, card titles |
| `--txt` on `--bg1` | hero panel, how-it-works, final CTA, Pro plan |
| `--txt2` on `--bg0` | body copy, sub lines, pills |
| `--txt2` on `--bg1` | live read labels, Pro plan sub |
| `--txt3` on `--bg0` | footer links, risk text, micro labels |
| `--bg0` on `--accent` | every accent button — inverse pair, check it too |
| `--green` on `--bg1` | verdict when bullish |
| `--red` on `--bg1` | verdict when bearish |

`--txt4` is used only for the excluded-feature `✕` and the route string in card footers. Both are **non-essential decoration paired with a text label**, so they are exempt from 4.5:1 — but if either ever becomes the only carrier of meaning, it must be re-tokened. Flag it rather than darkening it.

> **AMENDED 2026-09-03 (#639), owner's ruling.** The exemption is **revoked for
> the `✕`** and stands for the route string.
>
> The `✕`'s pairing lapsed without anyone editing this clause. The pricing row
> renders the glyph beside `f.text`, and `f.text` names the **feature**, never
> whether it is included — so the `✕` plus a colour shift on the label are the
> only carriers, and colour alone is not one. That is exactly the condition
> above, so the `✕` is now **`--txt3`** in `LandingTerminal.tsx`. It is not a
> departure from this clause; it is this clause firing.
>
> The route string keeps `--txt4`. Its pairing holds: the card carries
> `OPEN →` in accent plus the feature name, and the route string genuinely is
> decoration beside them.
>
> Do not "fix" the `✕` back to `--txt4` on the strength of the sentence above.

**Do not apply alpha to a token to de-emphasise it.** The README notes this pattern has already produced sub-AA text five times. Size and weight carry de-emphasis; the token is already tuned to the line.

**Interactive targets ≥ 24×24px** (WCAG 2.2 AA, SC 2.5.8). Not 44 — that is AAA.

Two controls on this route are visually under 24px and need a padded hit area without changing their painted box:
- Mobile `EN ▾` control — painted ~22px tall, give it `min-height: 24px`
- Feature-card `→` on mobile — it is inside the full-card link, so the card is the target; no change needed

**Focus** must remain visible on `--bg0`: `2px solid --accent`, offset 2 (inset -2 inside grid cells). Never `outline: none`.

**RTL:** the route already sets `dir` per locale. The removed step arrows were the only direction-aware element; nothing in this spec introduces a new one. The ticker's mask fade is direction-dependent — under `dir="rtl"` the gradient must mirror to `270deg`.

---

## Motion

**None**, with one exception.

- `BeamsBackground` and `.lp-hero-glow` are removed — the only two animated elements on the page today.
- No scroll animation, no reveal, no parallax, no counting numbers on the stats.
- **Exception:** hover transitions on controls, `120ms ease`, on `background` and `border-color` only. Never on layout properties.
- All of it inside `@media (prefers-reduced-motion: reduce)` → `transition: none`.

---

## Fixtures — what QA can and cannot pin

Per the `#439` finding: coin prices arrive over `wss://stream.binance.com`, which `page.route` cannot intercept.

| Region | Fixture-measurable |
|---|---|
| Nav, features, how-it-works, pricing, final CTA, footer | **Yes** — static copy and structure |
| Ticker | **No** — WebSocket |
| Hero live read panel | **No** — WebSocket |

So a visual sweep of this route scores two regions against whatever the live feed happened to be doing. **Structure and geometry criteria for those two regions are still valid** (cell count, panel width, row heights); **colour and value criteria are not** unless the store is stubbed above the socket.

Criteria 20–22 below therefore specify their fixture explicitly. If the store cannot be stubbed, mark 20–22 unverifiable and check them by inspection rather than scoring the route green on a starved page.

---

## Out of scope

- **The 6a frame.** Superseded; do not build it and do not diff against it.
- **Copy changes.** Existing `dict` strings ship as-is. See §Copy.
- **Light theme.** See below — the terminal design is dark-only.
- **The `/login` and `/upgrade` destinations.** This spec covers links to them, not those routes.
- **`BeamsBackground` as a component.** Removed from this route; still used elsewhere — do not delete the file.
- **Any Pro gating.** There is none on this route.
- **Legacy landing.** Runs unflagged; untouched.

---

## Could not determine

Negative results, per §13. Each of these the frames do not answer, and I have not chosen silently.

1. **Light theme — my answer, and it needs the owner's yes.** The frames are dark-only; there is no light variant of any of them, and the design's premise (near-black ground, hairline separation, one accent) does not survive inversion as a recolour. **My recommendation: terminal is dark-only, and the theme toggle is ABSENT — not disabled, not hidden — on any route rendering with `?design=terminal`.** On this route that is moot (landing has no toggle today), but the decision must be made here because it governs the shell that landing inherits. Consequence: the light-theme contrast defects in `#423` stay open against the legacy design and are out of scope for terminal routes. **Blocking for the shell, not for this page.**

2. **Which coin the hero live read shows.** I specify BTC at the default timeframe. The frame shows BTC 4H. Whether it should follow a rotating coin, or the visitor's last-viewed coin from `localStorage`, is a product decision I cannot read off a frame.

3. **Ticker coin order.** The frame shows 8 in an order I chose. With 50 coins the order matters — market cap, 24h volume, or the same order Markets uses? I specify "the same order the market store already yields" as the safe default; confirm.

*Resolved since first draft: the shell component (not parameterised — §Nav now specifies a landing-owned nav at shell geometry), the token names (all 15 confirmed), and the palette size (15, not 17).*

---

## Token mapping

All 15 names below are confirmed against `lib/terminalTokens.ts` on `dev`. **The palette is 15 values, not 17.**

**Dev must not hand-copy the hex below.** Reference the token names; the hex column exists only so the values in the frame can be checked against the token file. If any hex disagrees, the token file wins and I will restate the frame.

| Token used in this spec | Hex in frame `7a` | Role |
|---|---|---|
| `--bg0` | `#08090a` | page ground |
| `--bg1` | `#0c0d0f` | raised region |
| `--bg2` | `#111416` | bar/track fill |
| `--bdr` | `#1f2225` | structural hairline |
| `--bdr2` | `#131618` | row hairline |
| `--bdr3` | `#16191b` | cell hairline |
| `--txt` | `#e8e9ea` | primary text |
| `--txt2` | `#8b8f94` | secondary text |
| `--txt3` | `#5a5f66` | micro labels |
| `--txt4` | `#3a3f45` | disabled, tertiary |
| `--accent` | `#d9a626` | active, primary action |
| `--green` | `#3fb950` | fired, confirming |
| `--red` | `#f0524d` | fired, warning |
| `--mark-idle` | `#22262a` | signal marker, not fired |
| `--border-input` | `#2a2e32` | input / ghost button border |

All 15.

---

## Acceptance criteria

Each readable off the DOM at `/?design=terminal`.

**Structure**
1. Route renders exactly 8 top-level sections, in order: nav, ticker, hero, features, how-it-works, pricing, final-CTA, footer.
2. `document.querySelectorAll('a[href]').length >= 28`.
3. Feature grid contains exactly 6 cards; their `href`s in order are `/arena`, `/settings`, `/briefing`, `/news`, `/dashboard`, `/scanner`.
4. Each feature card's outermost element is an `<a>` — not a `<div>` containing one.
5. Footer contains exactly 4 link columns.
6. Risk disclosure contains exactly 6 items.
7. Pricing contains exactly 2 plans; their price strings are `$0` and `$25`.
8. Hero contains exactly 4 stat cells reading `50`, `35`, `Grok`, `Live`.
9. Hero contains exactly 2 CTAs, to `/login?signup=1` and `/briefing`.
10. No element on the route matches `[class*="beams"]` or `[class*="hero-glow"]`.

**Geometry — desktop, 1440**
11. Nav `offsetHeight === 56`. Ticker `offsetHeight === 34`. Hero's top edge is at `y = 90`.
12. **Every** element on the route has computed `border-radius: 0px`. Zero exceptions, including `img`.
13. Features grid `grid-template-columns` resolves to 3 equal tracks; the visible gap between cards is 1px and the gap colour is `--bdr`.
14. All 6 feature-card description blocks have computed `min-height: 66px`.
15. Pro plan's computed `border-top-width === '2px'` and `border-top-color` equals `--accent`.
16. Live read panel `offsetWidth === 472`.
17. Every `1px` rule on the route resolves to exactly `1px` — no `0.5px` on this route.

**Geometry — mobile, 390**
18. Nav `offsetHeight === 52`. Ticker `offsetHeight === 30`.
19. Feature cards stack: all 6 share one `offsetLeft`.
20. Pricing stacks: Pro's `offsetTop > Free.offsetTop + Free.offsetHeight`.
21. Footer link columns form 2 columns — exactly 2 distinct `offsetLeft` values across the 4.
22. Ticker has a non-empty computed `mask-image` **and** `-webkit-mask-image`.
23. Every control has `getBoundingClientRect()` width and height `>= 24`.

**Colour as data** — *requires a stubbed read; see §Fixtures*
24. Fixture: a read with exactly 2 of 6 evidence rows carrying a truthy `fire`. Assert the count of evidence values coloured `--green` or `--red` equals **2**, and the other 4 compute to `--txt`.
25. Fixture: a bearish read. The verdict element's computed colour is `--red`, its `font-size` is unchanged at 32px, and its bounding box is unchanged from the bullish fixture.
26. Fixture: a read with a null value in any evidence row. That row renders an em dash in `--txt2` and no numeral.
27. Outside the ticker and the live read panel, no element on the route computes to `--green` or `--red`.
28. The row labelled `CB prem` renders an em dash and never a numeral. No element on the route contains the string `Liq 24h`.
29. Every colour on the route is one of the **15** palette values in `lib/terminalTokens.ts`.

**Layout alternation**
30. At 1440, `document.querySelectorAll('[data-layout="mobile"]').length === 0` — the mobile tree is **absent**, not hidden. At 390, the desktop tree count is 0. Test by node count, not by computed `display`.
31. **Not a DOM check — an injected init script.** Count `new WebSocket` constructions before page load; exactly one ticker subscription is opened at any viewport width.

**Gating and session**
32. The route renders no `LockedFeatureCard` and evaluates no `entitled` guard.
33. With a signed-in session, the route redirects to `/arena` and no marketing markup mounts.
34. Signed out, the route locks nothing that production locks — production locks nothing here, so this passes trivially and is recorded so the entitlement check has a stated expectation.

**Copy and i18n**
35. **Not a DOM check — a source-level lint.** No user-visible string on the route is a literal in the component; every one resolves through `dict.*`.
36. At `?locale=` for each supported locale, criteria 1–9 still pass and no text is clipped or ellipsised.
