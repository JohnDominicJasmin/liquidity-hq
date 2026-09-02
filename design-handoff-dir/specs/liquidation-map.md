# Liq (Liquidation Map) — `Liquidation Map.dc.html · 3b`

**Fidelity:** colour rules and thresholds below are read from `components/LiqTerminal.tsx` directly (confirmed identical to the non-terminal branch — this screen has no separate `*Terminal.tsx` divergence in structure, only styling). Geometry is measurable off the canvas.

## Source
Frame: `Liquidation Map.dc.html · 3b`. Route `/liq`.

## Colour is data

**Bias card** (long/short account-ratio comparison, `totalLongM` vs `totalShortM`):
```
totalLongM > totalShortM * 1.15  → --red    "long-heavy"   (crowded longs = warning)
totalShortM > totalLongM * 1.15  → --green-2 "short-heavy"
otherwise                        → --txt-dim "balanced"
```
The 1.15 multiplier is a real threshold in source, not a rounding choice — a 10% imbalance stays "balanced."

**Liquidation clusters (real, live).** Each cluster's dominant-side colour: `longUsd > shortUsd → --red` (more long liquidations logged there), else `--green-2`. The bar itself is a stacked two-colour fill (`rgba(248,113,113,.65)` long-share + `rgba(52,211,153,.65)` short-share) — **not** a single dominant colour; both proportions render even when one is small.

**Liquidation delta card.** `liqDelta > 0 → --red` ("net longs liquidating"), `< 0 → --green-2` ("net shorts liquidating"), `= 0 → --txt3` ("balanced"). If `liqDelta`/`liqLongUsd`/`liqShortUsd` are all null (7 of the app's coins lack this feed), the card doesn't render at all — instead a plain text line reads "still warming up" for the 7 supported-but-pending coins (`btc, eth, sol, xrp, bnb, near, sui`) or "unavailable for this coin" naming which coins do support it. **Do not render an empty delta card for unsupported coins.**

**Whale-vs-retail divergence card.** Whale side by `whaleLong > whaleShort ? 'long' : 'short'`, coloured `--red`/`--green-2` respectively (same crowded-long-is-red logic). The stacked bar is `#f87171`/`#34d399` at 70% opacity, not the named tokens directly — flag as a minor hex/token inconsistency in source, not something to "fix" in the build. **Divergence banner** (`longSqueezeRisk`/`shortSqueezeRisk`) only appears when retail and whale positioning disagree by the source's own thresholds (retail long >55% + whale short >52%, or the mirror) — background `rgba(245,158,11,...)`, i.e. **amber**, not red or green. This is a warning-about-disagreement colour, distinct from either side's own colour.

**Band rows (the heatmap-as-table).** `side: 'long' → --red` accent, `side: 'short' → --green-2` accent — consistent with "crowded long = warning" throughout this app. The bar fill is a gradient from 10%-alpha to 60%-alpha of the side's colour, width driven by `barPct` (relative USD size within the visible tier set), floored at 2% width so a real-but-tiny band never renders invisible. **Magnet marker** (`◆`, the single largest band per side) adds a glow (`boxShadow` at the accent colour, 44 alpha) — decoration on top of the existing colour, not a new one.

**Current price bar.** `change >= 0 → --green-2`, else `--red` — the ticker exception, sign-to-colour is correct here.

**Legend dots** (`#34d399` short / `#f87171` long) are fixed reference swatches, always rendered regardless of live data — do not drive them from any coin's current state.

## Range-dependent geometry
5 time ranges (12h/24h/48h/3d/1w) each carry their own `maxDist` (0.05–0.50), which changes how many leverage tiers are active (`TIERS.filter(t => t.dist <= maxDist)`) — at 12h only the tightest few tiers show; at 1w all 17 render. **Row count is not fixed** — spec any row-count acceptance criterion as "≤17, changes with range," not a constant.

## Acceptance criteria
1. Bias card colour matches the 1.15-multiplier rule, not a simple majority.
2. Real-cluster bars render as a two-colour stacked fill (both long-share and short-share visible), never a single flat colour.
3. Delta card is **absent** (not present-with-zeroes) for a coin with no delta feed; the fallback text names the coin.
4. Divergence banner, when shown, computes background colour in the amber family — not `--red` or `--green-2`.
5. Every band row's bar width is ≥2% even when `barPct` rounds to 0.
6. Exactly one band per side carries the magnet glow at any given range.
7. Legend dot colours never change with live data.
8. Row count per side varies by selected range (verify at 12h vs 1w — different counts, both valid).
9. Every colour on the route is from the confirmed 16-token palette (`--amber` included) or a flagged non-token hex (`#f87171`/`#34d399`, present in source, not to be renamed).
10. Radius: per `radius-ruling.md` — status dots and the magnet marker glyph are exempt; panels/cards are `0`.

## Out of scope
`LiqFeed`, `WhaleTradesFeed`, `GexTable` (bottom-mounted live feeds) — restyle their existing rows to tokens; no structural change specified here. Coin-select dropdown behaviour (native `<select>`, unchanged).

## Could not determine
Whether the 7-coin delta-feed allowlist (`btc, eth, sol, xrp, bnb, near, sui`) is expected to grow — if so, the "unavailable" message's coin list needs to stay data-driven, not hardcoded in the build.
