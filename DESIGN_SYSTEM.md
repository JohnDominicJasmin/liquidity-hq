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
