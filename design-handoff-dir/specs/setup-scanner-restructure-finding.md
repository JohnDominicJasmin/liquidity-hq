# Setup Scanner — blocked, restructure finding (same pattern as Dashboard)

## The mismatch

Frame `Setup Scanner.dc.html · 4a` draws: a 268px criteria sidebar (6 stat rows + Run Scan / Save Filter buttons) beside a 10-row ranked table (coin/setup/score+bar/side/entry/stop/target/R/trigger/age).

`components/ScannerTerminal.tsx` — the real terminal-mode component at `/scanner` — composes **7 components**, none of which is a criteria-sidebar-plus-table:

```
PageHint                (contextual tip, dismissible)
AccumulationTracker     — not read
DistributionTracker     — not read
CoinHeatmap             — not read
DrawdownChart           — not read
MultiTFSqueezeView      — not read
SignalAccuracy          — not read
SetupScanner            — ranked CARDS, not a table (read in full below)
```

`SetupScanner.tsx` itself, which I have read, is the closest match to my frame's table — but it renders **cards, not table rows**: each card has a top row (rank/coin/direction label/score), a score bar, 4 signal-chip badges (OI trend, CVD, taker-flow, RSI — all independently coloured per their own thresholds), and a 6-stat row (funding, long%, short%, vol ratio, RSI-1h, RSI-4h). It also has a filter-tab row (All/Long-liq/Short-squeeze/Neutral with live counts), a "strong only" toggle, a search box, an alert bar for the single highest-scoring long-liq and short-squeeze coins, and a legend. None of that is in my frame.

**My frame's Run Scan / Save Filter / criteria-list sidebar has no source counterpart at all** — there's no "criteria" concept in `SetupScanner.tsx`; filtering is by direction tab and a score/strong-only toggle, not a configurable rule list.

## Why this matters
Same failure as Dashboard: specing the frame as drawn would tell dev to build a screen that doesn't correspond to what `/scanner` in terminal mode actually renders, and — because the six components I haven't read yet (`AccumulationTracker` through `MultiTFSqueezeView`, `SignalAccuracy`) are entirely unaccounted for — likely drops real functionality wholesale, the same way Dashboard's `EdgeSignals` almost did.

## What I'm doing about it
Rebuilding `Setup Scanner.dc.html` as a restyle of `ScannerTerminal.tsx`'s actual composition, once I've read the remaining 6 components. That's real scope — six more component reads plus a rebuild — so I'm flagging now rather than guessing at their content to hit today's deadline.

## What I need
Nothing to proceed — I'll read the remaining components and rebuild. Flagging so the priority-pair commitment ("Markets and Setup Scanner first") lands as one delivered spec + one accurate blocker, not a wrong spec delivered on time.
