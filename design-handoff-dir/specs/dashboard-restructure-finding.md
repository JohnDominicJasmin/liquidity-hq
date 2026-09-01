# Dashboard — restructure, not a restyle. Confirming before anyone specs it.

QA's instinct was right, and I should have caught this before drawing the frame rather than after.

## The mismatch, concretely

**Production's main column** (`app/dashboard/page.tsx`, `<div className="dash-main">`), top to bottom:

```
SetupChecklist                    onboarding, conditional
CascadeAlertBanner                floating toast, conditional
MarketRead                        the verdict
SOTD ("Best Setup Today")
SelectedCoinCard                  glance: ONE coin, the selected one
EdgeSignals (6 cards)             VWAP · OI trend · Funding · Squeeze score ·
                                   CB premium · OI 1h — all for that ONE coin
EconCalendarWidget + MarketConditionsWidget   side by side
```

**Production's rail** (`<aside className="dash-right">`, sticky):

```
CoinSidebar        7 coin CARDS (icon, price, one signal each) — not a table
MarketPulseStrip   BTC dominance / altseason / vol chips
PerpSpotCard
GlobalMacroContext
```

**My frame `2A`** inverts both halves:

```
Main column  →  a 28-row COIN TABLE (sym/price/24h/funding/OI/taker-bar/
                signal/grade) — this does not exist anywhere in production
Rail (352)   →  Best setup today (1 card) · Macro backdrop (5 rows) ·
                Next events
```

**What's entirely absent from my frame:** `SetupChecklist`, `CascadeAlertBanner`, `SelectedCoinCard`, all six `EdgeSignals` cards, `MarketConditionsWidget`, `PerpSpotCard`, `CoinSidebar`'s card treatment.

**What my frame adds that production doesn't have:** the 28-coin table as primary content. `CoinSidebar` is a 7-card list, not a table — there is no table on this screen today.

## Why this matters more than a missed panel

Production's dashboard has one job: **tell you about the coin you have selected, in depth** — six signal cards deep — while a compact sidebar lets you switch coins. My frame's job is **compare all coins in a table** and treats the selected-coin story as a single small card. Those are two different products on the same route. A build against my frame would delete `EdgeSignals` — six live components — and the selected-coin flow the rest of the app points at (`SelectedCoinCard` links to `/arena?coin={id}`).

**Correction, superseded:** an earlier version of this note claimed `DashboardTerminal.tsx` doesn't exist. That was wrong — QA found it on `dev` (22.8KB, wired at `app/dashboard/page.tsx:519` via `useDesignMode() === 'terminal'`). It mirrors `page.tsx`'s pre-terminal-branch structure exactly by design (its own header says so), so the panel inventory below is unaffected — but it is the file `dashboard-2a.md` should cite, not `page.tsx`.

## What I'm doing about it

Per the rule this project has now applied twice (Arena's tabs, this): **restyle needs no sign-off, restructure does.** So:

1. **Rebuild `Dashboard.dc.html` as a restyle** — production's structure, both columns, all ten components, restyled into the terminal language. That's the version worth specifying.
2. **The 28-coin table becomes its own proposal**, offered separately — it's a reasonable idea (it's close to what `/markets` already is) but it is not this screen today, and swapping it in is the owner's call, not mine to make silently.

## What I need

Nothing — I can rebuild without a decision, since "restyle matches production" has no ambiguity. Flagging this now, before writing a spec against the wrong structure a second time on this project.

Restyle rebuild is next, then the spec QA asked for goes against that file.
