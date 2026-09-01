# Radius ruling — resolves criteria 6 and 8 across every spec

**Ruling: `border-radius: 0` applies to rectangular surfaces — panels, cards, buttons, chips, inputs, table cells. It does not apply to elements that are inherently circular in the source** — status dots, avatar/coin-marker circles, toggle-switch thumbs, and the small `◆` magnet marker on Liq's bands (which is a glyph, not a radius).

Rationale: production renders these at `border-radius: 50%` throughout (`LiqTerminal.tsx`'s cluster dots, `FundingTerminal.tsx`'s sparkline end-dot, `AlertsPage`'s numbered step circles and status pills, `SettingsPage`'s toggle thumbs). A status dot drawn as a square is not a simpler version of a status dot — it's a different glyph that no longer reads as "status." The design's own "radius is an absence" rule is about **decoration on containers** (the rounded-corner card/button aesthetic the terminal style explicitly rejects); it was never applied to circular indicator glyphs, and no frame in this bundle draws one square.

**Scoring rule, all specs:** an element computes `border-radius: 0px` UNLESS it is a status dot, avatar/coin marker, toggle thumb, or step-number circle ≤24px — those compute `50%`. Criteria 6/8 (and their equivalents in every other spec) should read with that carve-out, not as a blanket zero.

This applies retroactively to Dashboard 2a's own `criteria 8` and Journal's `criteria 9`/`10`, and forward to the five specs below.
