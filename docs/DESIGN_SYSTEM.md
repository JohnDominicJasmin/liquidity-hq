# LiquidityHQ Design System — "Indigo Depth"

Custom system. References: mindpillar.com (atmosphere, typography discipline) and
Crypto Planet Figma template (component language, exchange-grade layout patterns —
figma.com/design/GK5dtCLnlzNzhMCO7xdCaz). We borrow structure, never clone.

## Tokens (globals.css `:root`)

| Token | Value | Use |
|---|---|---|
| `--accent` | `#5a6aff` | Primary actions, active nav (solid fill + white text), links |
| `--accent-2` | `#9ba4ff` | Highlights, logo mark, hover text |
| `--bg0..bg4` | `#07090f → #1c213c` | Canvas → elevated surfaces (deep indigo-blue blacks) |
| `--txt / txt2 / txt3` | `#eef0fa / #9296b5 / #4e5374` | Primary / secondary / muted text |
| `--bdr / bdr2` | `rgba(140,150,255,.1 / .18)` | Hairlines (indigo-tinted) |
| `--green / --red` | `#4ade80 / #f87171` | Long/bullish vs short/bearish ONLY |
| `--radius-card / chip` | `12px / 8px` | Corner language |

Body background: indigo radial glow top + vertical gradient `#12142e → #07090f`, fixed.

## Typography

- **Figtree** (`--font-sans`, next/font) — all UI text, sentence case.
- **IBM Plex Mono** (`--font-mono`) — every price, percentage, micro-label, coin
  symbol, nav-adjacent data. Mono numerics are the brand differentiator; max weight 700.
- Micro-labels: 9–10px mono, uppercase, letterspacing 0.1–0.16em, `--txt3`.
- Never Inter, never emoji as icons (inline SVG or text instead).

## Component language (from Crypto Planet reference)

- Cards: `linear-gradient(180deg, var(--bg2), var(--bg1))`, 0.5px `--bdr`, 12px
  radius, soft lit-top shadow (`--nm-raise-sm`).
- Active nav / primary CTA: solid `--accent` fill, white text, 8px radius.
- Chips/badges: tiny pills, `withAlpha(color, '14')` bg + `withAlpha(color, '44')`
  border + colored text (`lib/color.ts`) — never `color + '44'` string concat, which
  silently breaks (invalid CSS) the moment `color` is a `var()` instead of a hex literal.
- Change values: green/red with ▲▼ or +/− prefix, tabular-nums mono.
- Tables: airy rows, mono uppercase sortable headers, hover row tint
  `rgba(140,150,255,0.05)`.

## Audit status (2026-07-02)

Removed app-wide: AI-purple `#a78bfa` family, unloaded-font fallback (Segoe), emoji
icons (~30 files), muddy brown gradient, neumorphic blob shadows. All pages verified
on the indigo system: Dashboard, Arena, Markets, News, Alerts, Settings, Briefing,
landing, upgrade, 404.

## Reference-aligned follow-ups (nice-to-have, not vibe-code)

1. `/markets`: coin ticker badge pills + sparkline column + sortable header arrows
   (Crypto Planet market table pattern); widen table on ≥1100px.
2. Arena side panel: input fields as dark rounded boxes with token suffix, solid
   accent CTA (Buy/Sell panel pattern).
3. Landing: MindPillar-style italic serif accent words in hero headline; footer as
   multi-column link grid (Crypto Planet footer).
4. Pagination pattern (`1–10 of N · page numbers · jump to page`) for long tables.

---

## Contrast: never dim ink that is already at its floor

**Added 2026-09-05 after the same defect was found for the seventh time (#836).**

`--txt3` is not "muted text you can mute further". It is tuned to sit **just above 4.5:1**
and has no headroom left. Measured at full strength on a production build, across every
panel ground in both terminal themes:

```
dark   #7c828a   4.71 – 5.20
light  #5e6267   4.70 – 5.88
```

Every one of those clears AA. Multiply any of them by an `opacity` and it does not:

| Multiplier | Computes to | Ratio | Where |
|---|---|---|---|
| `0.5` | `#a1a2a2` | **1.95:1** | `.gex-title > span` — worst text on the platform |
| `0.5` | `#abacad` | 2.10:1 | `/econ-calendar` source suffix |
| `0.6` | `#9b9d9f` | 2.51:1 | `/funding` range hint |
| `0.6` | `#9b9da0` | 2.71:1 | `.st-locked-list`, light |
| `0.75` | `#458c57` / `#af4a50` | 3.03 / 3.90 | `.liq-section-sub` |

**The rule.** De-emphasise with **size, weight, or a separator** — never by dimming ink.
The seven known instances are listed in `docs/HANDOVER.md` §14; `globals.css` names the trap
in the comment above `.lp-footer-ack`. Read it before adding `opacity` to any text.

**Two corollaries, both learned the expensive way:**

1. **A fix scoped to one theme is not a fix.** `.st-locked-list` was corrected in dark and its
   light multiplier survived for weeks, because the justification — *"over a white card, where
   the base colour has the headroom to absorb it"* — was measured against the current design
   and never re-checked against terminal. Measure all four contexts: design × theme.
2. **A background is not the first non-transparent ancestor.** `.liq-current-oi` has no
   multiplier and still failed at **4.09:1**, because `.liq-current-bar` is `--accent-2` at 9%
   composited over the panel — a tint that lifts the ground *toward* the ink. Composite the
   tint over its ground and measure against the result, or the number comes out wrong in the
   direction that looks safe.

**Contrast ratio is the wrong instrument for two different hues.** It reports 1.02 for a brown
against a blue. Use it for same-hue pairs; for different hues, judge distinctness another way.

> ⚠️ **The token table at the top of this file is stale.** It lists
> `--txt / txt2 / txt3` as `#eef0fa / #9296b5 / #4e5374`; `globals.css` `:root` today has
> `--txt3: #7b8297`, and the terminal blocks override all three again per theme. Treat
> `app/globals.css` as authoritative and this table as historical until someone re-derives it.
