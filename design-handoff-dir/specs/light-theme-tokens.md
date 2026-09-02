# Light theme — token palette

Applied to all 31 pages as `<Screen> — Light.dc.html`, mechanically derived from the dark canvases by a 1:1 hex swap (every token is one hex value everywhere in this codebase, so the swap is exact — no hand-redrawing, no drift).

## Why the accents changed value, not just background/text

Dark accents measured against a light ground all fail WCAG AA (checked earlier): `--accent` 2.23:1, `--green` 2.56:1, `--red` 3.49:1, `--amber` 2.14:1. A light theme needs its own accent values — inverting ground and text is not enough.

| Token | Dark | Light | Note |
|---|---|---|---|
| `--bg0` | `#08090a` | `#f7f6f3` | not pure white — same warm-neutral character as the dark ground |
| `--bg1` | `#141517` | `#ebe9e6` | |
| `--bg2` | `#111416` | `#e3e1dd` | |
| `--bdr` | `#1f2225` | `#d5d2cd` | |
| `--bdr2` | `#131618` | `#dfdcd7` | |
| `--bdr3` | `#16191b` | `#e2dfda` | |
| `--txt` | `#e8e9ea` | `#15181b` | |
| `--txt2` | `#8b8f94` | `#585c61` | |
| `--txt3` | `#7c828a` | `#6a6e73` | |
| `--txt4` | `#3a3f45` | `#aeaaa4` | decorative/tertiary only, exempt from 4.5:1 same as dark |
| `--accent` | `#d9a626` | `#8a5c00` | darkened for AA on light ground |
| `--green` | `#3fb950` | `#1a7f37` | darkened for AA |
| `--red` | `#f0524d` | `#cf222e` | darkened for AA |
| `--amber` | `#f0a626` | `#9a6a00` | darkened for AA, kept distinct from `--accent` |
| `--mark-idle` | `#22262a` | `#d1cec9` | decorative 2px marker |
| `--border-input` | `#5e646b` | `#75797e` | |

**These four (`accent`, `green`, `red`, `amber`) are a proposal, not a measurement** — there is no light frame to measure from, so I chose values in the same family as the dark tokens, shifted dark enough to clear 4.5:1 on `#f7f6f3`. Treat them as a starting point to verify with a contrast tool and adjust, not as final.

## One deliberate exception: the heatmap plot area stays dark in both themes

`#0a0710` (liquidation heatmap ground) is not swapped. A density heatmap is a data surface, not chrome — like a terminal's dedicated plot canvas, it keeps its own dark field regardless of the page theme around it, the same way a candlestick chart's plot area conventionally stays legible-dark rather than following light/dark mode. If that's wrong for this product, it's a one-line change (add `#0a0710` to the swap map) — flagging the decision rather than making it silently.

## What this does not cover

- No theme-toggle behaviour — these are static comparison files, not a switch. QA's earlier finding that light theme should have the toggle *absent* on terminal routes stands; if that's overturned, wiring an actual toggle is separate work.
- Chart candle colours and evidence-row markers inherit the same `--green`/`--red` swap, so they stay correct without separate handling.
- rgba() alpha overlays derived from `--green`/`--red`/`--accent` (ticker change color, confluence-row tints) were swapped to match; anything using a raw literal outside those three would not be caught — none were found on this pass (residual check came back clean across all 31 files).
