# `Arena 1a.dc.html` — structure and geometry

Build target for `feature/arena-canvas-mirror`. Read statically from the
canvas's inline styles (the canvases are Handlebars templates — rendering one
without data collapses most bands). `{{ … }}` marks a data slot, not copy.

Raw extraction: `qa/reports/arena-1a-canvas-geometry.txt`.

## Band sequence

```
1  NAV             height 44   padding 0 16px   gap 28   border-bottom 1px #1f2225
2  TICKER          height 34   border-bottom 1px #1f2225   font 11
3  HINT/CASCADE    height 36   padding 0 16px   gap 10   border-bottom 1px #1f2225
4  SNAPSHOT        height 88   border-bottom 1px #1f2225
5  VERDICT         border-bottom 1px #1f2225
6  TIMEFRAME ROW   height 42   padding 0 16px   gap 2   border-bottom 1px #1f2225
7  BODY            flex 1  →  main (flex 1, border-right 1px) + rail
```

**Nav and ticker are identical to `Dashboard 2a`** — 44 / 34, same padding and
gaps. `PriceTickerStrip` should drop straight in, subject to the coin-count
ruling.

## 4 · Snapshot band (88)

```
coin block   width 330   padding 0 20px   gap 13   border-right 1px #1f2225
  mark       32 × 32  font 11        ← 32 here, NOT dashboard's 26
  symbol     font 16   "BTCUSDT"
  PERP pill  padding 2px 6px  font 9.5
  caret      font 9
  price      font 19
  change     font 12
stats grid   grid-template-columns: repeat(5, 1fr)   flex 1
  cell       padding 0 18px   gap 6   border-right 1px #1f2225
             label 9.5 · value 14 · note 10
right block  width 230   padding 0 18px   gap 11
  bar        2 × 34
  label 9.5 · value 11.5
```

## 5 · Verdict band

```
left         width 330   padding 20px   gap 10   border-right 1px #1f2225
  eyebrow    font 10    "Read · 4H · 11:42 UTC"
  verdict    font 34    "LEAN BULLISH"          ← spec C9 confirms 34px
  meter row  gap 10 → bar height 3 (fill 68%) · score font 13 · "CONF" font 10
levels grid  grid-template-columns: repeat(4, 1fr)   flex 1
  cell       padding 20px 22px   gap 7   border-right 1px #1f2225
             label 10 · value 20 · note 11
actions      width 170 → two stacked, font 11: "RE-RUN READ", "SET ALERT"
```

## 6 · Timeframe row (42)

Chips `padding 6px 12px`, `gap 6`, font 11. Trailing note font 10
`1M · 5M · 15M NEED PRO`, spacer 14, then `padding 5px 10px` font 10
`EMA · VOL · CLUSTERS`.

Spec C20: exactly 3 chips carry a padlock, labels `1m` `5m` `15m`.
Spec C21: exactly 1 chip computes `background: --accent`.

## 7 · Body — main column

**Chart** — `height 430`, `padding 16px 62px 24px 16px`, border-bottom 1px.
Price labels `padding 1px 3px` font 10. Entry line
`border-bottom 1px dashed rgba(63,185,80,.5)`.

**Confluence** — header `height 30`, `padding 0 16px`, `gap 10`, border-bottom.
Label font 10, `PRO` pill `padding 2px 7px` font 9.5, right note font 10.
Body `padding 18px 16px`, `gap 24`: left block width 250 gap 12 with score
font 34 and lean font 14; centre bar height 8; right scale width 74 font 10.
Factor grid `repeat(4, 1fr)`, cell `padding 11px 16px` `gap 10`,
borders 1px `#16191b`, accent bar 2 × 18, label 12.5, value 12.

**Timeframe alignment** — header `height 30`. Row `padding 9px 16px` `gap 12`:
tf width 32 font 11 · icon width 14 font 12 · bar height 6 · border-bottom
1px `#16191b`.

## Rail

`aside` — spec C2 states `offsetWidth === 352`, same as dashboard.

## Before building — read these

Spec criteria **12–18 are fixture-dependent** ("stubbed read"): 2-of-8 evidence
rows firing, `FUNDING 8H` red while positive, a bearish verdict, a null evidence
row, `CB PREM` always an em dash, cleared penalties in `--txt3`, MTF neutral
band. **None can be verified from a live page** — arena will have an
unverifiable remainder until fixtures exist, and that is worth knowing before
the screen is called done.

Canvas coverage today: **10/51 labels, 20%** — the second-worst of the 28
mapped routes.
