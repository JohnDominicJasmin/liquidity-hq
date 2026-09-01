# Briefing — `Briefing.dc.html · 4d`

**Fidelity:** colour rules read from `components/BriefingTerminal.tsx` directly. No structural divergence from the non-terminal branch — safe to spec as-is.

## Source
Frame: `Briefing.dc.html · 4d`. Route `/briefing`.

## Colour is data

**Top-3 setups.** Direction from `sq.dir`: `SHORT_SQ → --green-2` ("LONG" label — a short squeeze is bullish), else `--red` ("SHORT" label). The score number itself uses `sq.color` (from `computeSqueezeScore`, not read in this pass — treat as its own existing rule, don't re-derive). Tag chips beside each setup are always `--txt3` regardless of what they say — the *direction badge* carries the colour, the *evidence tags* don't. Do not colour tags by their content.

**CVD divergence chips.** `bullish → --green-2`, `bearish → --red`. Row only renders at all when `cvdAlerts.length > 0` — absent, not empty, when there are none.

**Macro pulse — 4 independently-coloured cells, no shared logic:**
```
Fear & Greed:  fng >= 75 → --red | >= 55 → --amber | <= 25 → --green-2 | <= 45 → --green-soft | else --txt2
BTC Dominance: no colour on the value; sub-label colour by domTrend (alts weak → --amber, alts active → --green-2)
DXY:           dxyChg > 0.2 → --red ("headwind") | < -0.2 → --green-2 ("tailwind") | else --txt3 ("neutral")
ETF flow:      etfFlow > 0 → --green-2 | < 0 → --red | cell entirely ABSENT if etfFlow is null
```
Note Fear & Greed is a 5-tier ladder (extreme-greed red down through extreme-fear green), the only 5-tier cell among the four — don't collapse it to a 3-tier red/neutral/green like the other three.

**Yen watch gauge.** 3-zone banded gauge, not a gradient interpolation:
```
jpyUsd >= 160  → --red    "danger zone"
jpyUsd >= 158  → --amber  "warning"
else           → --green-2 "safe"
```
Thresholds are exact (158, 160) and must render as hard boundaries on the 140–165 track, with the 158 and 160 tick labels coloured to match their zone (`--amber`/`--red`) while the 140/165 endpoint labels stay `--txt3`. The marker dot's glow (`boxShadow`) uses the same zone colour — decoration, not an independent signal.

**Notable signals** (up to 10 coins, sorted by chip count desc, "+N more" overflow to `/scanner`). Each coin can carry up to 5 independent chips, no two sharing logic:
```
RSI:      >= 70 → --red | <= 30 → --green-2 | else no chip (not a neutral chip — chip absent)
Funding:  >= 0.05% → --red | <= -0.03% → --green-2 | else no chip
Vol spike: volRatio >= 1.5 → --accent chip | else no chip
OI:       strong_up → --green-2 | strong_down → --red | else no chip
CVD:      bullish → --green-2 | bearish → --red | else no chip
```
**Every chip on this panel is conditional presence, not a fixed 5-chip row with some dimmed.** A coin with 2 firing conditions shows exactly 2 chips, not 2 coloured + 3 grey.

**Events & news feed.** Three independently-styled row families:
```
Econ events:  isPast → grey bg/--txt3 (prefixed ✓) | <2h away → --red | else → --amber
Geo/news:     style==='crypto' → --green-2 | style==='speech' → --accent-2 | else → --accent
Whale trades: side==='BUY' → --green-2 | else → --red
```
`--accent-2` is the same flagged non-token from the Markets pass — confirm with design, don't invent a hex.

## Acceptance criteria
1. Fear & Greed cell renders one of 5 distinct colours depending on the fixture value, not 3.
2. DXY, ETF-flow, and Fear&Greed cells each use their own independent threshold — changing one fixture must not shift another cell's colour.
3. ETF-flow cell is absent (not present-with-dash) when `etfNetFlow` is null.
4. Yen gauge's 158 and 160 tick labels render in `--amber`/`--red` respectively; the 140/165 endpoints stay `--txt3`.
5. A notable-signal coin with exactly 2 firing conditions renders exactly 2 chips — not 5 chips with 3 dimmed.
6. CVD divergence row is absent (zero height, not an empty panel) when no coin has a divergence.
7. An econ event less than 2 hours out renders `--red`; the same event type further out renders `--amber`; a past event renders grey with a ✓ prefix.
8. Whale-trade row colour follows `side`, not trade size or symbol.
9. Every colour is from the confirmed palette, `--amber`, or the flagged `--accent-2` pending confirmation.
10. Radius per `radius-ruling.md`.

## Out of scope
AI briefing generator's text content and caching mechanics (states covered below, not the underlying Grok call). `SessionCountdown` component's internal logic — restyle only.

## States
Empty (no brief generated): plain hint text, no error styling. Generating: 3-dot loading indicator. Error: `--red` text with a warning icon. Cached: a muted timestamp line under the brief text reading "cached Nm ago, refreshes in Nm."

## Could not determine
Whether `--accent-2`'s eventual resolution (pending design confirmation from the Markets/README thread) should also apply retroactively to this screen's "speech" event tag — same open question, not a new one.
