# `Dashboard 2a.dc.html` — exact structure and geometry

Extracted from the canvas's inline styles. **This is the build target for
`feature/dashboard-canvas-mirror`.**

Read statically rather than by rendering: the canvases are Handlebars templates
(`{{ verdictText }}`, `{{ tk.sym }}`), so loading one in a browser without its
data collapses most bands. Do not take a collapsed band as a section the canvas
lacks.

`{{ … }}` below marks a data slot, not literal copy.

## Frame

```
1440 × 1080   background #08090a   border 1px #1f2225
```

## Band sequence

```
1  NAV        height 44   padding 0 16px   gap 28   border-bottom 1px #1f2225
2  TICKER     height 34   border-bottom 1px #1f2225   font-size 11
3  CASCADE    height 36   padding 0 16px   gap 11   border-bottom 1px #1f2225   (conditional)
4  BODY       flex 1  →  main column (flex 1, border-right 1px #1f2225) + aside 352px
```

### 1 · Nav (44)

| element | geometry |
|---|---|
| brand | gap 9, font 12, `LIQUIDITYHQ` |
| nav items | gap 2, font 11, each `padding 6px 12px` |
| spacer | `flex:1` |
| right cluster | gap 14, font 11 |
| session dot | 5 × 5 |
| session label | `LONDON · 2h 14m` |
| `⌘K` | padding 4px 8px |
| avatar | 22 × 22, font 10 |

### 2 · Ticker (34)

Each cell: `padding 0 16px`, `gap 8`, `border-right 1px #16191b`, carrying
`{{ tk.sym }} {{ tk.px }} {{ tk.chg }}`. **No such component exists in the app —
this is new.**

### 3 · Cascade (36, conditional)

6 × 6 dot · headline font 12.5 · sub font 12 · `flex:1` spacer · `DISMISS ✕` font 10.
Absent when no cascade is firing, per `dashboard-2a.md` C7.

### 4 · Main column

**Market read** — `padding 15px 20px`, border-bottom 1px #1f2225
```
label   font 10    "Market read · 14 Aug 11:42 UTC"
verdict font 24    {{ verdictText }}
sub     font 12.5  {{ verdictSub }}
```

**Best setup today** — `padding 14px 20px`, border-bottom 1px #1f2225
```
label   font 10   "Best setup today"
row     gap 20
  coin  font 12   BTC
  bias  font 16   LEAN BULLISH
  bar   height 3, flex 1, fill width 68%
  score font 12   68
  levels gap 12, font 11   E 114,820 · S 113,410 · T 117,900
```

**Selected coin** — `padding 12px 20px`, `gap 12`, border-bottom 1px #1f2225
```
mark 26 × 26 font 10 · sym font 13 · price font 13 · chg font 12
signal font 12 · flex:1 spacer · "OPEN ARENA →" font 10
```

**Coin signals** — header `height 28, padding 0 20px`, border-bottom 1px #1f2225
```
grid-template-columns: repeat(3, 1fr)
cell: padding 12px 16px, border-bottom + border-right 1px #16191b
      {{ e.label }} font 10.5 · {{ e.value }} font 15 · {{ e.sig }} font 10.5
```

**Bottom split** — two `flex:1` columns, left has border-right 1px #1f2225

*Next events* — header 28
```
row: padding 10px 20px, gap 11, border-bottom 1px #131618
     colour bar 2 × 24
     {{ ev.title }} font 12 · {{ ev.meta }} font 10 · {{ ev.time }} font 10.5
```

*Market conditions* — header 28
```
body: padding 14px 20px, gap 10
row:  gap 10
      {{ c.label }} width 90, font 11
      track height 5, flex 1, fill width {{ c.w }}
      {{ c.value }} width 60, font 11
```

### 5 · Rail

```
<aside> width 352px
```

## Open items on this screen

Three canvas elements cannot be built as drawn — see `CANVAS_MIRROR_TASK.md` §7:
E/S/T levels have no data source, Market conditions' four metrics do not exist
in the codebase, and Perp vs spot's price-lead percentage reverses decision #328.
Owner has ruled canvas-wins on all three; the constraint is that no value may be
fabricated to fill a slot.
