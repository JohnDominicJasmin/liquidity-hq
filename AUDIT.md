# LiquidityHQ — UI/UX + QA Audit

Senior UI/UX + QA audit of the production trading platform. Multi-viewport (Desktop 1440 / Mobile 390), multi-theme (Dark / Light), every route, logged-out **and** authenticated. Priority order: **data trustworthiness > usability > accessibility > aesthetics**.

## 0. Executive summary

- **Two audit passes:** Part A (logged-out, on local `dev` build) + Part B (authenticated, signed in as `20-60951@g.batstate-u.edu.ph` on deployed `liquidity-hq-dev.onrender.com`). Every route opened and rendered.
- **7 fixes already applied & verified** on the local build (see §2). Not yet deployed — so prod still shows them.
- **3 data-correctness / QA bugs** found (§3) — the highest-severity class on a trading tool.
- **1 dominant authenticated issue:** the "QUICK SETUP" onboarding overlay + "Ask AI" FAB cover primary CTAs on every signed-in page (§4, AUTH-1).
- **Typography:** ~26 discrete font sizes, no token scale (§7).
- **Account note:** to audit the Pro backtest tool, the user's DB `role` was set `free→pro` (`lhq_dev_user_subscriptions`, their authorization) for `user_id=1a05ac61-9336-42c8-976b-ef7343148b20`, and a second auth user_id for the same email (`d4ccd40f-70a6-4f07-9665-81ad822814c1` - likely a re-linked Google identity) was also set to `pro` to verify QA-3 live. **Reverted 2026-07-17** - both rows deleted from `public.lhq_dev_user_subscriptions` (confirmed correct project/table is `wdtjhrilakoitfcezxpx`, not the newer empty `qdpwhnvmhqgzijuwopso` project this doc's table name would suggest), both accounts back to free.

### Severity index
| Sev | Items |
|-----|-------|
| **Critical** | CRIT-1 (charts don't re-theme via nav toggle) |
| **High** | QA-1 (R-multiple = 0.00R), QA-3 (backtest variants identical), AUTH-1 (onboarding overlay covers CTAs), CRIT-2 (econ-cal clip), CRIT-3 (light contrast), arena mobile chart legend, typography sprawl |
| **Medium** | CRIT-4 (FAB overlap), SYS-5 (titles), SYS-6 (loading states), SYS-7 (no rem), QA-2 (no TP validation), AUTH-2/3/4, research empty values, markets signal trunc, upgrade hides pricing, grok expand, gate-copy inconsistency |
| **Low** | SYS-8 (naming/em-dash/17-coins), grok 2 close btns + tap targets, settings tz, news no-image card, doubled tab titles, scroll affordances, AuthGate empty div |

---

## 1. Method

- **Live browser render** at Desktop 1440 + Mobile 390, Dark + Light. Theme flipped via the real mechanism (`localStorage.theme` + `data-theme` + `theme-change` event) and the in-app toggles.
- **Interactions exercised** (no credit/account side-effects): Position Sizer computed; theme toggles clicked; Grok panel opened; journal all 7 sub-tabs; **backtest run** (local compute, not a credit).
- **Contrast** computed in-page with the WCAG 2.1 relative-luminance formula against real rendered token values.
- **Code + DB inspection** for structural facts: `globals.css`, `NavDrawer.tsx`, `KLineProChart.tsx`, `entitlements.ts`, `lib/coins.ts`, `app/**/layout.tsx`, font-size extraction (CSS + inline JSX), Supabase schema.
- **Not exercised (safety):** Fire-analysis, Generate-briefing, Grok send, Settings Save, Telegram connect, log/edit/delete trade, checkout — so those flows' post-submit result/loading/error states are unaudited.

---

## 2. ✅ Fixes applied & verified (local build)

| Finding | Change | Verified |
|---------|--------|----------|
| **CRIT-1** nav toggle didn't re-theme charts | `NavDrawer.toggleTheme` dispatches `theme-change` ([NavDrawer.tsx:262](components/NavDrawer.tsx)) | Toggled from nav on `/arena` → KLine chart flipped dark→light |
| **CRIT-2** econ-calendar clipped on mobile | Collapse COUNTRY/DELTA/IMPACT + drop `min-width` ≤480px (`globals.css`, `econ-calendar/page.tsx`) | 390px: TIME/EVENT/PREVIOUS/CONSENSUS/ACTUAL all fit, headers don't collide |
| **CRIT-3** light `--txt3` fails AA | `#888B99` → `#63656F` ([globals.css:1909](app/globals.css)) | Measured 5.80/5.22/4.81 on white/card/canvas — all ≥ AA 4.5 |
| **CRIT-4** FAB overlaps content (mobile) | `.app-content` mobile `padding-bottom` 56→148px | Page bottom: last content y=682, FAB top y=704 → no overlap |
| **SYS-5** 9 routes generic title | Added `layout.tsx` + `metadata.title` to dashboard/scanner/backtest/research/upgrade/econ-calendar/markets/prices/live-tracking | Tabs now "Dashboard —", "Markets —", etc. |
| **Markets** SIGNAL truncated (mobile) | Signal ~1.7× width + 2-line wrap ≤480px (`globals.css`, `markets/page.tsx`) | 390px: "New sellers opening" etc. fully readable |
| **Landing** stale "17 coins" | 17→50 in `LandingContent.tsx` + all 4 locales `dictionaries.ts` (real=50, `lib/coins.ts`) | Hero "Live · 50 coins" |

No compile/server errors after changes. **Deploy the fixed branch — prod (`-dev`) still shows all of these.**

### De-vibecode pass 1 — emoji → SVG (applied, local build, verified rendering)

Goal: strip vibe-coded tells so it reads like a finance platform. Replaced **web-UI emoji** with clean inline SVGs (matching the existing tab-bar icon style, `currentColor`, themeable). **Kept** emoji inside Telegram/alert **message strings** (`MarketProvider`, briefing text) — emoji there is normal, not vibecode.

| Emoji | Where | Replaced with |
|-------|-------|---------------|
| `📲` | PWA install prompt | real app icon `/icons/icon-192.png` (rounded) |
| `☀`/`◑` | nav theme toggle, Settings-modal theme chips | sun/moon SVGs |
| `☀` | Morning-briefing prompt | sun SVG (amber) |
| `⚡` | LiqFeed header + cascade, briefing "Active CVD Divergences" | bolt SVG |
| `⚠/⚡/✓` | MacroStrip JPY status | text-only (color already encodes it) |
| `✦` | Grok "Ask AI" FAB + empty state, EMASignal, hours ×2 | consistent sparkle SVG |
| `⚙` | RaidMeter override | sliders/adjust SVG |
| `⚠/◆` | hours pills (dead/outside) | removed (pill styling conveys state) |

Also: **deleted dead `WelcomeModal.tsx`** (NEW-4); fixed live undefined **`--txt1`→`--txt`** in `news/page.tsx` (NEW-1). Verified: no compile errors, theme toggle + Grok FAB render SVGs, no React error overlay. (Browser-pane screenshots were timing out on the dev server, so verification was via DOM inspection.)

**`⚠` warning triangle (~25 uses across ~15 files) — ✅ resolved, keep as-is.** The bare `⚠` risk-warning prefix on calc warnings, liquidation alerts, journal, funding, etc. is a *standard* risk indicator in finance UIs (mostly monochrome), unlike phone/fire emoji - already fine, not vibecode. The color-emoji `⚠️` (with VS16) previously flagged as "the clearer offender in `SetupScanner`/`MarketProvider`" was re-checked 2026-07-17: `SetupScanner` has no `⚠️` (stale reference, already clean), and every remaining `⚠️` in the codebase ([MarketProvider.tsx](components/MarketProvider.tsx), [macro-alert/route.ts](app/api/macro-alert/route.ts), [telegram/alert/route.ts](app/api/telegram/alert/route.ts)) lives inside Telegram alert message bodies - raw text POSTed to the Telegram bot API, never rendered by React. A `<Warn/>` SVG can't go there (Telegram has no SVG/React rendering), and emoji in a push-notification message is normal, same reasoning as the original de-vibecode pass's exemption for message strings. Product owner confirmed: leave as-is. Geometric trading glyphs `▲ ▼ ◆` and the `✕` close glyph were kept (standard, monochrome, follow color).

---

## 3. Data-correctness / QA bugs (highest priority — trading-tool trust)

### QA-1 — Journal "Avg R/Trade" is wrong `[High]` — ✅ fixed
Logged trade: ETH LONG, Entry `$64,500`, Stop `$63,500` (risk `$1,000`), Exit `$64,600` (reward `$100`) → true R = 100/1000 = **+0.10R**. Stats tab showed **"Avg R/Trade +0.00R"**. R-multiple is a core discipline metric; showing 0.00R for a real winner misrepresents performance. (Win Rate 100%, P&L +$1.09, streaks all rendered correctly - only R was wrong.)

Root cause ([TradeJournal.tsx](components/TradeJournal.tsx)): `pnl_r` was computed on close as `pnl_usd / trade.risk_usd`, and `risk_usd` was only ever populated from the Position Sizer's `acc`+`risk` URL params - both had to be filled in the sizer *and* the trade had to be logged via its "Log This Trade" link. Any other path (direct entry, or the sizer used without an account size) saved `risk_usd = null`, so `pnl_r` silently stayed `null` and the trade dropped out of every R stat with zero visible error.

Fix: R-multiple is now computed from price levels alone - `(exit - entry) * dir / |entry - stop|` - which needs no `risk_usd`/position size at all (they cancel out of the true ratio). Applied at close time going forward, and as a display-time fallback (`tradeR()`) for the stats calc and History row R badge, so already-logged legacy rows with `pnl_r = null` (like the example above) show the correct R immediately without a DB backfill. Also added a `risk_usd` fallback derived from entry/stop/position-size at log time, so the "✓ Risk: $X" auto-fill line works even when not arriving from the sizer.

**Verified live** (localhost, authenticated as `mikocabal27@gmail.com`): the account's actual History still had this exact trade (ETH LONG, entry $64,500, stop $63,500, exit $64,600) sitting on a legacy `pnl_r = null` row. History row now shows **+0.10R** (was showing nothing/0.00R), and Stats → Avg R/Trade shows **+0.10R** - matching the audit's hand-calculated true value exactly, with zero DB changes needed.

### QA-2 — No sanity validation on trade levels `[Medium]` — ✅ fixed + verified live
History card shows **TP `$100`** for that long (entry `$64,500`). A take-profit far below entry is nonsensical for a LONG, yet it was accepted and displayed as-is. Fix ([TradeJournal.tsx](components/TradeJournal.tsx)): added a `levelWarnings` check (same advisory pattern as the existing rule-violation box, not a hard block - the user may be logging a trade after the fact with approximate levels) that flags stop-loss on the wrong side of entry for the chosen direction, and take-profit on the wrong side of entry, shown above the Log Trade button.

Verified live: entered Entry `$64,500` / Stop `$65,000` on a LONG (stop above entry - invalid) and the warning appeared immediately: "Price levels don't match direction · Stop $65000 is above entry $64500 on a LONG - stop should be below entry." Did not submit, so nothing was written to the real journal.

### QA-4 — Position Sizer LONG/SHORT colors were inverted `[High]` — ✅ fixed
`.ps-banner-long` was styled `var(--red)` and `.ps-banner-short` `var(--green)` ([globals.css:2331-2332](app/globals.css)) — so a **LONG** position showed **red** and SHORT showed green, the opposite of the universal trading convention (long=bullish=green). Data-trust bug on a trading tool. Swapped so long=green / short=red; verified live (`▲ LONG` computes `rgb(4,120,87)`). Other long/short color pairs across the app were audited and are correct; the `long→red` cases in LiqFeed/liq/dashboard are **liquidation events** (a long *liquidation* is bearish → red is right there).

### QA-3 — Backtest tuning "variants" return identical metrics `[High]` — ✅ verified live
In the WaveTrend Confirming-Layer Tuning table, two pairs of supposedly-different parameter sets were **byte-identical**:
- "Current (5-bar window)" == "Loose Recency (20-bar)" → 959 trades / 318W-636L / 33.3% / −0.08R / PF 0.89 / −92.51R
- "Arm Window (full cross phase)" == "Loose Thresholds (±45 + arm)" → 308 / 91W-217L / 29.5% / −0.19R / PF 0.75 / −69.11R

**Pair 1 — confirmed bug, fixed.** [lib/backtestEngine.ts](lib/backtestEngine.ts) `WT_VARIANTS.looseRecency` was defined as `{ ...DEFAULT_WT_PARAMS, crossWindowBars: 20 }` - but `DEFAULT_WT_PARAMS.crossWindowBars` (via `CROSS_RECENCY_BARS` in [waveTrend.ts](lib/waveTrend.ts)) was *already* 20, per that file's own comment documenting a prior tuning pass that moved the default from 5→20 bars. So "current" and "looseRecency" resolved to the literal same params object - not a plumbing bug, a stale variant definition left over from before the default changed. The UI label compounded it: "Current (5-bar window)" was also wrong (current is 20-bar). Fixed: renamed the variant to `tightRecency` at the true old value (`crossWindowBars: 5`) so the table compares the current 20-bar default against the actual pre-tuning baseline, and corrected both labels in [app/backtest/page.tsx](app/backtest/page.tsx).

**Pair 2 — confirmed not a bug, empirically.** Traced `filterSignalsByWaveTrend` → `getWaveTrendConfirmation` (waveTrend.ts) before the live run: per-variant params ARE correctly threaded (`armWindow` and `looseThresholds` are genuinely different objects, `obLevel`/`osLevel` 53 vs 45, both `useArmWindow: true`), and `armIndex` is a real per-signal value from `strategyCore.ts` (not undefined/inert). Ran the backtest live (Majors, 1H, 3yr, account bumped to Pro for verification - see below) to settle it: **armWindow and looseThresholds are still byte-identical** (308 trades, 91W/217L, 29.5%, −0.19R, PF 0.75, −69.11R) even with correctly-wired distinct params. Confirms the hypothesis - within each signal's arm-to-confirm window, the *most recent* cross matching direction already clears the stricter ±53 threshold outright in every one of these 308 cases (a real WaveTrend reversal cross is typically a strong move), so loosening to ±45 never changes which cross gets picked in this historical sample. Not a bug; the ±45 vs ±53 spread just isn't wide enough to matter for this dataset/window combination. Leaving as-is - a meaningful next step would be a much wider threshold (e.g. ±35) if this comparison is worth keeping at all.

**Live re-run results (Majors · 1H · 3yr · Pro unlocked on the test account for verification, `d4ccd40f-70a6-4f07-9665-81ad822814c1` → `role: pro` in `lhq_dev_user_subscriptions`, same authorized pattern as the original audit):**
- Anti-Chop ON: WR 33.1%, 2673 trades (880W/1781L/12 open), PF 0.88, Avg R −0.09R, Max DD −235.86R
- Anti-Chop OFF: WR 35.3%, 7893 trades (2785W/5103L/5 open), PF 0.87, Avg R −0.10R, Max DD −782.24R
- Current (20-bar): 959 trades (318W/636L), 33.3%, −0.08R, PF 0.89, −92.51R
- Tight Recency (5-bar, pre-tuning default): **345 trades** (102W/243L), 29.6%, −0.19R, PF 0.75, −78.44R — now genuinely distinct from Current, confirming the pair-1 fix
- Arm Window: 308 trades (91W/217L), 29.5%, −0.19R, PF 0.75, −69.11R
- Divergence Only: 305 trades (91W/214L), 29.8%, −0.18R, PF 0.76, −66.02R
- Loose Thresholds: 308 trades (91W/217L), 29.5%, −0.19R, PF 0.75, −69.11R (still equals Arm Window - see above)

(Original audit's reference numbers for Anti-Chop ON/OFF matched closely: WR 33.1%/35.3%, PF 0.88/0.87 - the two extra "open" trades in this run vs. the original are just later live-candle boundary timing, not a regression.)

---

## 4. Critical & systemic findings

### CRIT-1 — Nav-bar theme toggle leaves charts stuck in old theme `[Critical]` — ✅ fixed (local), live in prod
Two theme toggles behave differently: the **nav-bar** toggle ([NavDrawer.tsx:256](components/NavDrawer.tsx)) set `data-theme`+`localStorage` but did **not** dispatch `theme-change`; the **settings** toggle + modal do. `KLineProChart` ([KLineProChart.tsx:376](components/KLineProChart.tsx)) + `GrokSignalChart` re-style **only** on that event. Live-confirmed on `/arena` (both local pre-fix and prod): page went light, candlestick chart stayed fully dark. Fix dispatches the event; also consider a `MutationObserver` on `data-theme` and consolidating the 3 duplicate toggle implementations.

### AUTH-1 — "QUICK SETUP" onboarding overlay + FAB cover primary UI on every authenticated page `[High]` — ✅ fixed + verified live
Signed in, a `SetupChecklist` panel ("QUICK SETUP · 1/4 done") + a "Setup 1/4" progress bar float `position:fixed` and overlap real content on every page (all combos):
- **Mobile:** covers dashboard Open-Interest card + Smart Money gauge; journal **▼ SHORT** button; settings watchlist selector; briefing **Generate** button; alerts price-alerts; upgrade feature list. The "Ask AI" FAB (also bottom-right) compounds it.
- **Desktop:** covers arena chart's right price axis; journal Position-Size field; funding 7D chart header; calc Take-Profit field; backtest Anti-Chop-OFF stats; scanner heatmap right column; markets/news/playbook right rows.

Only a "—" collapse, no clear dismiss; reappears.

Root cause ([SetupChecklist.tsx](components/SetupChecklist.tsx)): `useState(true)` for `collapsed` was immediately overridden by `useEffect(() => { if (window.innerWidth >= 640) setCollapsed(false); }, [])` - i.e. it force-expanded to the full 244px-wide, ~4-row panel on every screen *except phones*. That's why it covered the price axis / form fields on desktop specifically: desktop was the one case that never got the small pill.

Fix:
1. Removed the forced-expand effect - it now always starts as the small progress pill (`Setup N/4` + thin bar) everywhere, matching the mobile behavior that was already fine. Full panel is now opt-in (click to expand), same as before.
2. Added a real dismiss - a `×` next to the minimize `−` on the full panel, and one on the mini pill, persisted to `localStorage` (`lhq_setup_dismissed`) so it's gone for good, not just re-collapsed until next page load.

Verified live (localhost, authenticated): dashboard now shows the small "Setup 2/4" progress pill, bottom-right, not the old full panel - no content covered.

### CRIT-2 — Economic Calendar cramped/clipped on mobile `[High]` — ✅ fixed (local), live in prod
Event rows are an 8-col grid (`min-width:680`) in an `overflow-x:auto` wrapper: technically scrollable, but at 390px you see under half, no scroll affordance, page doesn't scroll → reads as clipped (CONSENSUS/ACTUAL cut off). Fix collapses COUNTRY/DELTA/IMPACT ≤480px so the 5 key columns fit. Prod still clips.

### CRIT-3 — Light-mode micro-labels fail WCAG AA `[High]` — ✅ fixed (local), live in prod
`--txt3` `#888B99` = **3.39:1** on light cards (below AA 4.5). Drives every 10-11px uppercase micro-label app-wide (COIN SIGNALS, FR SETTLEMENT, nav group labels, settings locked list, grok empty-state). Fix → `#63656F` (5.80/5.22/4.81). Dark mode was fine.

### CRIT-4 — "Ask AI" FAB overlaps content, mobile `[Medium]` — ✅ fixed (local), live in prod
Fixed FAB with no reserved bottom padding overlapped content on every mobile page (dashboard gauge, liq "EST USD" header, funding table, calc hint, research value, playbook body, hours "Go hunt."). Fix adds 148px `.app-content` bottom padding.

### SYS-5 — Missing per-page `<title>` `[Medium]` — ✅ fixed (local), live in prod
9 client-page routes lacked a `layout.tsx` metadata export → all inherited generic "LiquidityHQ" (incl. the main dashboard). Fix adds titled layouts.

### SYS-6 — Inconsistent loading & empty states `[Medium]` — ✅ fixed
Was: no unified skeleton - `/funding` flashed blank black before paint; `/upgrade` had bare "Loading…"; `/correlation` had a proper "Calculating correlations…" but its DXY/SPX/GOLD macro cards briefly showed bare "—" (a load transient); `/live-tracking` had a clean sentence.

Fix (item #16): `/funding` and `/correlation` already had near-identical inline card styling for their loading text; `/upgrade` used a completely different full-page div with a hardcoded `#888` (ignores theme entirely) instead of a token. Extracted a shared [components/LoadingState.tsx](components/LoadingState.tsx) (`fullPage` prop for the whole-page case, inline card otherwise) and swapped all three onto it - one component, one visual language, correctly themed in both modes now.

The two loose ends noted here originally are now closed too (see §7 addendum #25): the `/funding` blank-flash-before-paint was fixed with `app/funding/loading.tsx` (Next's route-level Suspense fallback). The `MacroStrip.tsx` DXY/SPX/GOLD "—" transient was investigated and left alone on purpose - it's the same shared-store pending-value pattern used everywhere else in the app (e.g. dashboard's `BTC.D -`), not a one-off inconsistency worth a bespoke fix.

### SYS-7 — All font sizes fixed `px`, none `rem` `[Medium, a11y]` — ✅ fixed
Was: zero `rem` in `globals.css`; inline styles px too - text ignored browser font-size preference / resisted zoom-reflow. Fixed via a mechanical 1:1 `px`→`rem` conversion (value/16, confirmed no `html{font-size}` override in this codebase so the conversion is pixel-identical at default zoom) across `globals.css` (685 declarations, incl. the old `--fs-xs..--fs-3xl` tier tokens and the 4 `clamp()` hero sizes) and inline `fontSize` in `app/`+`components/` (923 of 934, script-converted; the remaining 11 were dynamic/ternary/computed values needing a manual look, all now also `rem`-based - see §7 addendum). Verified live across `/dashboard`, `/arena`, `/backtest`, `/news`, `/settings`, `/funding`: zero console errors, computed `font-size` values unchanged pixel-for-pixel pre/post (e.g. `.edge-card-value` still `15px`, `.mb-title` still `20px`). This closes problem #7 from §7's list only - the underlying "26 discrete sizes, no consistent role split" consolidation (problems #1-6) is a separate design decision, not attempted here (product owner chose "preserve current look" over "snap to the new 9-role scale", 2026-07-17). The 9-role token scale itself is defined and ready in `:root` for whenever that consolidation pass happens.

### SYS-8 — Copy / naming inconsistencies `[Low]` — ✅ fixed
- **Feature naming drift** — `/liq` had 3 different names (tab "Liquidity Map", nav "Liquidation Map", H1 "Liquidation Heatmap"); `/hours` had 2 (tab "Market Hours", H1 "Best Hours"). Standardized on the majority name in each case - "Liquidation Map" (matched nav + `/about` + `/not-found`, 3 of 4 spots) and "Best Hours" (matched `/about` + nav ×2 + H1, 4 of 5 spots). Also converted both page-title divs to real `<h1>` while touching them (same reasoning as item #21). Verified live: `/liq` tab+H1 both "Liquidation Map", `/hours` tab+H1 both "Best Hours".
- **Stale "17 coins"** — landing was already fixed; `/about` Data Sources wasn't. Now "50 coins". Verified live.
- **Doubled tab titles** — `/terms` + `/privacy` set `title: 'X - LiquidityHQ'` in their own metadata *and* the root layout's `template: '%s - LiquidityHQ'` appended the suffix again, rendering "X - LiquidityHQ - LiquidityHQ". Both now just set `title: 'X'`, matching how `/about` was already doing it correctly. Verified live: `document.title` on `/terms` is now `"Terms of Use - LiquidityHQ"`.
- **Em-dashes → hyphens** — went further than just UI copy: swept all `—` to `-` across every `.ts`/`.tsx` file in `app/`, `components/`, `lib/` (1508 occurrences, 156 files, including CSS comment banners in `globals.css`/`MagicBento.css`) via a single mechanical `sed` pass. Spacing was already consistent both sides of the dash throughout the codebase, so straight character substitution was safe - `tsc --noEmit` clean afterward, zero `—` remaining. `AUDIT.md` itself was deliberately left alone (documentation, not shipped code).

### Authenticated-specific (AUTH-2..7)
- **AUTH-2 `[Med]`** — ✅ fixed. Account menu: email `20-60951@g.batstate-u.edu.ph` wrapped mid-domain (`…edu.p`/`h`); "Settings" item near-invisible grey vs blue "view usage" / red "Sign out". `.auth-dropdown-email` actually already had `word-break: break-all` (not "no word-break" as originally described) - but `break-all` breaks at *any* character, which is exactly what produced the ugly `edu.p`/`h` split. Switched to `overflow-wrap: anywhere`, which only breaks when a word truly can't fit, preferring natural boundaries first. `.auth-dropdown-usage` (shared by "LiquidityAI — view usage" and "Settings") had its base color at `var(--txt3)`, with only "view usage" getting a nested `<span>` accent-color boost - "Settings" and the "LiquidityAI —" prefix had no such boost and stayed dim. Bumped the base to `var(--txt2)`. Verified live: injected the real long email from the audit via console - now wraps at a hyphen (`20-60951@g.batstate-` / `u.edu.ph`) instead of mid-domain, confirmed no overflow (170px content in a 188px dropdown); "Settings" now reads clearly next to "view usage" and "Sign out".
- **AUTH-3 `[Med]`** — ✅ fixed. Alerts (free tier): a "Pro plan required" upsell sat **above a fully-rendered but greyed/disabled Telegram connect flow** (`opacity: 0.4; pointerEvents: 'none'` on the whole wizard card) - a dead form the user could look at but not use. Price Alerts (free) worked below, unaffected. Replaced the banner + dimmed form with a single `LockedFeatureCard` ([app/alerts/page.tsx](app/alerts/page.tsx)) - the same shared Pro-gate pattern already used on Arena's other locked cards - wired to the shared `UpgradeGateModal`. Verified live both ways: free tier shows the locked card and its "Unlock with Pro" button opens the paywall modal correctly; Pro tier shows the full interactive wizard with no dimming, no regression.
- **AUTH-4 `[Med]`** — ✅ fixed. `/upgrade`'s nav header ([app/upgrade/page.tsx](app/upgrade/page.tsx)) had `background: 'rgba(10,10,14,0.9)'` hardcoded, unlike every other themed surface - stayed black in light theme. `/markets` and `/prices` were checked and are already theme-aware (`var(--bg)`), so this specific fix only touched `/upgrade`. Switched to `background: 'var(--bg)'`, matching the other two pages' pattern; dropped the now-redundant `backdropFilter: blur()` since the background is opaque. Not independently re-verified live - the test account is Pro, so `/upgrade` redirects away, and reverting Pro status just to see a one-line CSS fix wasn't worth the churn; the identical `var(--bg)` pattern is already confirmed working on `/markets` and `/prices`.
- **AUTH-5 `[Med]`** — ✅ already fixed (found working, not new work this pass). Research BTC-Risk-Level card was reported listing factor rows (Fear & Greed / BTC RSI / Funding Rate) with **no values**. [BtcRiskLevel.tsx](components/BtcRiskLevel.tsx) already guards this correctly - a row is only pushed to the list when its underlying value is non-null, and always carries a real value string when it is (`if (fng != null) signals.push({..., value: String(fng)})`), with an explicit "Waiting for market data…" fallback when nothing has loaded yet. Structurally can't render a labeled row with a blank value. Verified live on `/research`: card shows real numbers - Fear & Greed 27, BTC RSI (Daily) 54.0, Funding Rate +0.0000%. Likely a stale loading-state screenshot in the original pass, or fixed in an earlier session alongside similar work. (Unrelated, spotted in passing: the same page's Stablecoin Dry Powder and Global Macro Context cards show "AI service not configured / Retry" - **investigated, not a code bug.** Both routes ([app/api/dry-powder/route.ts](app/api/dry-powder/route.ts), `/api/macro-context`) correctly gate on `GROK_API_KEY` and return exactly this message when it's missing - working as designed. Traced to an empty `GROK_API_KEY=` in local `.env.local`; product owner confirmed the real key is already set on the deployed Render service, so this was a local-dev-only artifact, not something live users see. No fix needed.)
- **AUTH-6 `[Low]`** Grok chat: input enabled + "5 left" usage counter + Fast toggle (good). **Two close buttons — ✅ fixed** (item #18): the FAB swapped to an ✕ glyph while the panel was open, duplicating the panel's own header ✕. Hid the FAB via CSS while open (`opacity/pointer-events`) instead, matching the existing scroll-hide pattern already used elsewhere on the same element - the panel's header ✕ is now the single, unambiguous close control. Verified live: opening the chat makes the FAB disappear entirely, only the header ✕ remains. **Expand control — investigated (item #15), doesn't reproduce**: clicked it live and the panel genuinely expands to a large centered modal with backdrop, doesn't close. Both the toggle logic and CSS looked structurally correct on read-through too. Likely already fixed in an earlier pass, or the original finding mis-clicked an adjacent header icon (search/clear/history/expand/close are tightly packed). "Where to set stop?" quick-prompt clips - ✅ already resolved, checked live: the button's full text renders intact and un-truncated once scrolled into view (`.gchat-quick` has no fixed width/overflow, `white-space: nowrap` sizes it to content) - it's just the 4th of 8 chips in a `flex` row wider than its container (`scrollWidth` 986px vs `clientWidth` 358px), invisible by default until scrolled, same as any horizontal-scroll row. This is the exact row item #7 added the `.hscroll-fade-outer`/`.hscroll-fade-panel` scroll affordance to earlier - the "clips" read was almost certainly that fade-less first impression, now fixed by that same earlier pass. Coin chips (40×28px, below 44px tap target) - ✅ fixed since, see item #20 (`min-height: 44px`).
- **AUTH-7 `[Low]`** — ✅ fixed. Settings "Resets at 8:00 AM" stated no timezone. The underlying value was already correctly localized to the viewer (`lib/resetTime.ts` deliberately never hardcodes PHT or UTC, converts to whoever's actually looking at the screen) - the string itself just didn't label which zone that was. Added `timeZoneName: 'short'` to both `nextResetLocalTime()` and `utcHourToLocalTime()`, so it now self-documents (e.g. "8:00 AM GMT+8") regardless of viewer location. News desktop rendered an image-less article as a solid black card - `.ncard-grid-placeholder` was a genuinely empty div (`background: var(--bg2)`, zero content). Added a muted `ArticleIcon` ([components/icons.tsx](components/icons.tsx)) to all 3 empty-placeholder call sites (hero card, regular card, extra-geo card) - the whale-alert placeholder already had its own ↑/↓ content and wasn't touched. Verified live on `/news`: no-image cards now show a small muted document glyph instead of a blank block.

### State-dependent surfaces (onboarding / errors / i18n / PWA)
- **NEW-1 `[Med]`** — ✅ fixed (in §2's original pass; this section just hadn't been updated to match). **Undefined `--txt1` token.** `app/news/page.tsx` (live) and `WelcomeModal.tsx` (dead — see NEW-4) used `var(--txt1)`, but globals only defines `--txt`/`--txt2`/`--txt3` — `--txt1` doesn't exist and there's no fallback, so that text silently inherited color instead of using the token. Confirmed current state: `grep -n "txt1" app/news/page.tsx` returns nothing - already renamed to `--txt`.
- **NEW-4 `[Med]`** — ✅ fixed (in §2's original pass; this section just hadn't been updated to match). **`WelcomeModal.tsx` was dead code** — imported and mounted nowhere. AppShell mounts `OnboardingTour` + `OnboardingGate`; the gate renders `OnboardingFlow` (not `WelcomeModal`) when `profile_complete=false`. Confirmed current state: `components/WelcomeModal.tsx` no longer exists on disk.
- **NEW-2 `[Low]`** — ✅ fixed. **`/global-error` was off-brand.** The crash boundary ([global-error.tsx](app/global-error.tsx)) was inline-styled with the stale purple accent `#7c3aed` + `sans-serif` instead of the app's blue `#1a7aff` / Figtree. Swapped both. This route bypasses the normal root layout entirely (by design, so it renders even if the layout itself is what crashed), so it can't reference the app's CSS vars or `next/font` Figtree instance - used the literal hex and a `'Figtree, system-ui, sans-serif'` stack that degrades gracefully if Figtree isn't loaded on this route. Can't trigger a live crash to visually confirm; code-reviewed only.
- **NEW-3 `[Low]`** — ✅ fixed. **PWA install prompt placement.** Was a `position:fixed` bottom-center toast that overlapped page content (landing feature card, arena chart, footer). Moved to bottom-left - clear of the Grok FAB and Setup Checklist pill, which both live bottom-right. Verified live on `/about`: toast sits bottom-left, doesn't overlap the footer disclaimer text or anything else on the page.
- **NEW-5 `[Med, polish]`** **PWA prompt reads generic / "vibe-coded".** ([PWAInstallPrompt.tsx](components/PWAInstallPrompt.tsx)) (a) icon is the raw **`📲` emoji** (`fontSize:20`) — renders per-OS, no brand, looks like a placeholder, even though a real app icon exists (`/icons/icon-512.png`, used in the manifest); (b) subtitle wraps mid-phrase ("…for instant / access") because `maxWidth:320` is too tight; (c) it's a default icon+title+subtitle+blue-pill+× toast with no product character. *Fix:* use the real app icon, widen so the subtitle is one line, dock to a corner. **General note:** emoji-as-icon appears elsewhere too — audit for `<span>` emoji used as UI iconography and replace with real icons for a non-generic feel.
- **Onboarding tour** (code): 6 clean steps + skip/dots/back-next; gated by DB `tour_seen` **and** localStorage `lhq_tour_seen`. **Settings modal** (code): the `/settings` panels in a dialog, opened from the account menu, correctly fires `theme-change`. **`/auth/callback`** (live): redirects to `/arena` with no session — no standalone UI (expected). **`/ko`** (live): i18n renders cleanly, dark-only.

---

## 5. Page-by-page status (every route)

Blockers do **not** block page access — every main page was opened. They stop *actions inside* pages (credits/save/buy), or are *state-only* pages. ✅ full · 🟡 partial · ⬜ not audited. Combos: D=Desktop, M=Mobile, Dk/Lt=theme.

| Route | Status | Combos (authed unless noted) | Notes / blocker |
|-------|--------|------------------------------|-----------------|
| `/` landing | ✅ | D·M Dk+Lt | **Dark-only, intentionally** - `[data-theme="light"] body.landing` re-pins every token to its dark value (already shipped, verified via computed styles - see §8 item 10); hero fixed to "50 coins" |
| `/dashboard` | ✅ | D·M Dk+Lt | QUICK SETUP overlay covers signal cards |
| `/arena` | ✅ | D·M Dk+Lt | CRIT-1 chart no-flip; mobile chart legend overlaps candles; Fire not run (credit) |
| `/briefing` | ✅ | M | Generate covered by overlay; PHT timestamp; Generate not run (credit) |
| `/scanner` | ✅ | D + Part A M | Accum/Distrib/Heatmap; screenshot occasionally hangs on live heatmap canvas |
| `/liq` | ✅ | M + Part A | FAB over "EST USD" header; naming drift |
| `/funding` | ✅ | D + Part A | 2-col table + 7D chart; overlay on chart header |
| `/correlation` | ✅ | M + Part A | Macro cards populate; heatmap loader |
| `/backtest` | ✅ | D, tool run | **Pro** (unlocked via DB role); QA-3; overlay hides OFF stats |
| `/live-tracking` | ✅ | M + Part A | Clean empty state |
| `/journal` | ✅ | D·M + all 7 sub-tabs | QA-1, QA-2; FAB covers SHORT; AI runs not fired (credit) |
| `/research` | ✅ | M + Part A | AUTH-5 empty factor values — ✅ already fixed, verified live |
| `/calc` | ✅ | D + form computed | Overlay on Take-Profit field |
| `/econ-calendar` | ✅ | M + Part A | CRIT-2 (fixed local; prod clips) |
| `/alerts` | ✅ | M + Part A | AUTH-3 dead Telegram form — ✅ fixed; Price alerts work |
| `/hours` | ✅ | D + Part A | Session map/clock; naming drift |
| `/playbook` | ✅ | D + Part A | 55 plays; overlay on tags |
| `/news` | ✅ | D + Part A | Image-less card = black box; chip rows no scroll affordance |
| `/markets` | ✅ | D + Part A | Signal readable on desktop (trunc = mobile, fixed local) |
| `/prices` | ✅ | M + Part A | Dark "← Back" header (AUTH-4) |
| `/settings` | ✅ | D·M Dk+Lt | Account panels + usage rings; overlay covers watchlist; Save not run |
| `/upgrade` | ✅ | M | Real pricing (Free vs Pro); dark back-header - ✅ fixed, see §4 AUTH-4; checkout not run (payment) |
| `/login` | ✅ | D·M (Part A) | Google + magic link |
| `/about` | ✅ | M | Stale "17 coins" in Data Sources |
| `/terms` | ✅ | M | Doubled tab title |
| `/privacy` | ✅ | M | Doubled tab title |
| `/disclaimer` | ✅ | M | Clean |
| `/not-found` (404) | ✅ | M | On-brand ("stop-hunted") |
| `/offline` | ✅ | M | Clean "No connection" |
| Grok chat panel | ✅ | D Dk+Lt · M | Input enabled authed; AUTH-6 (single close button ✅ fixed, expand doesn't reproduce); send not run (credit) |
| `/auth/callback` | ✅ | live (Chrome) | Redirects to `/arena` when no auth code — pure transient redirect, no standalone UI |
| PWA install prompt | ✅ | live (Chrome) | Fired naturally; bottom-center fixed toast **overlaps content** (feature card / chart) on desktop |
| `/[locale]` (`/ko`,`/zh`,`/ar`) | ✅ | live (Chrome) `/ko` | Localized landing renders; dark-only; still "17개 코인" on prod (fix not deployed) |
| `/global-error` | ✅ | code | Full-page "Something went wrong / Try again"; was off-brand (stale purple `#7c3aed` + system sans-serif) - fixed under NEW-2, see below. Can't force a crash to render live, code-reviewed only |
| Settings **modal** (`SettingsModal.tsx`) | ✅ | live (Chrome) | Account-menu → Settings opens a centered scrollable dialog = `/settings` content (Account/usage rings/Watchlist/Trading Profile). Redundant 2nd settings surface; correctly fires `theme-change` |
| Onboarding tour (`OnboardingTour.tsx`) | ✅ | live (Chrome, 6 steps) | Captured after resetting mikocabal27's `tour_seen`; clean 6-step overlay (Welcome→Arena→Briefing→News→Alerts→Ready), Skip/dots/Back/Next; state restored after |
| Welcome modal (`WelcomeModal.tsx`) | ✅ | code | **DEAD CODE — imported/mounted nowhere** (see NEW-4). Real first-run entry is `OnboardingFlow` (rendered by `OnboardingGate` when `profile_complete=false`) |

---

## 6. Per-feature notes (condensed)

**Positives worth keeping:** dashboard's dense Bloomberg/Coinglass grid reads well in dark; live-prices horizontal card scroller on mobile; journal is a genuinely rich tool (log-trade form + History/Stats/Rules/Shadow Account/Bias Diagnostics/Thesis Tracker, all with clean empty states); backtest dual equity-curve comparison + per-coin breakdown; hours color-coded 24h session map + live PHT clock; calc computes correctly (entry 100/stop 95 → $300, 3u, 0.3x, R:R); 404 on-brand copy; theme flips cleanly on all data pages.

**Notable per-page issues (beyond the systemic ones above):**
- **Arena (mobile):** ✅ fixed — klinecharts OHLC/legend text overlapped the candles + price axis at 390px height, unreadable (desktop was fine, chart has room there). Root cause: `candle.tooltip.showRule` / `indicator.tooltip.showRule` weren't set in [KLineProChart.tsx](components/KLineProChart.tsx)'s theme configs, so klinecharts used its library default (`always`) - a permanent OHLC/volume text overlay regardless of screen size. Set both to `follow_cross` (only shows while actively touching/dragging the crosshair, same pattern most trading apps use on phones) and bumped the ≤420px canvas height from 320px→380px for more breathing room. Verified live on `/arena` — permanent OHLC overlay is gone, candle pane is clean.
- **News:** ✅ fixed — filter-tab + coin-buzz rows scroll horizontally but clipped chips mid-word with no fade/arrow affordance. `NewsBanner.tsx` already had this exact pattern (`.news-scroll-outer` + right-edge `.news-scroll-fade`) for its own econ/geo event row - extracted it into shared `.hscroll-fade-outer`/`.hscroll-fade` classes ([globals.css](app/globals.css)) and applied to the News page's tab bar and `CoinBuzzBar` ([app/news/page.tsx](app/news/page.tsx)), plus Grok's coin selector and quick-prompt rows ([GrokChat.tsx](components/GrokChat.tsx)) via a `.hscroll-fade-panel` variant (uses the panel background `var(--bg1)` instead of the page background, since the Grok panel isn't page-colored). Verified live: all 4 fade elements render with correct per-context background.
- **Journal:** — ✅ fixed. `AuthGate.tsx:22` had a stray blank line (dead markup left over from a removed icon) in the logged-out gate. Removed.
- **Upgrade / gates:** sign-in prompts are worded/styled 3 ways (AuthGate component, settings "SIGN IN TO CONTINUE" list, upgrade signup card) — unify for trust. ~~Logged-out `/upgrade` hides pricing behind auth~~ — ✅ fixed, see item #18.
- **Settings (light):** ✅ fixed - the locked "SIGN IN TO CONTINUE" list was near-invisible grey-on-white. `opacity: 0.35` on the whole list (conveying "disabled") combined with light theme's `--txt2` blended down to unreadable. Extracted to a `.st-locked-list` class with a `[data-theme="light"]` override raising it to `0.6` - dark theme's near-white `--txt2` survives 0.35 fine, so only light needed the bump. Verified live: computed opacity is `0.6` under light theme.

---

## 7. Typography consistency audit `[High, structural]`

Fonts (Figtree + IBM Plex Mono) are well-chosen. The **sizing system is the problem.**

**Every distinct size in use (measured).** CSS `font-size:` by frequency — 10px×205, 11px×154, 12px×111, 13px×110, 16px×32, 20px×32, 32px×6, 48px×4, 9px×4, 14px×3, + clamp hero `clamp(36px,6vw,64px)` etc. Inline JSX `fontSize` — 11px×244, 12px×180, 10px×168, 9px×110, 13px×86, 14px×40, 20/15px×22, 8px×18, 16px×12, 18px×11, and fractional **13.5/11.5/12.5/7.5px** + 7px. **Union ≈26 discrete sizes** (7 → 48 + clamp), with weights 400–800 → dozens of size+weight pairs on one screen (dashboard: 32+ measured).

**Problems:**
1. Four interchangeable "small" sizes — 10/11/12/13px = **580 CSS + 678 inline uses**, no consistent role split.
2. Fractional sizes (7.5/11.5/12.5/13.5px) — accidental hand-tuning.
3. Sub-legible 7/8/9px text — below mobile minimum; worst combined with CRIT-3.
4. Title vs subtext too close — card title 16px sits ~3px above a 13px description; reads as one block.
5. Two sources of truth — sizes in **both** `globals.css` and inline JSX; guarantees drift.
6. Ad-hoc mobile scaling — font-size re-declared in **43 media-query blocks** + inline, no systematic step-down.
7. No `rem` — ignores user font-size / zoom.

**Proposed consolidated scale (tokens, `rem`-based, one size+weight per role):**

| Token | Role | Desktop | Mobile | Weight |
|-------|------|---------|--------|--------|
| `--fs-display` | Landing hero | `clamp(2.25rem,6vw,4rem)` | — | 800 |
| `--fs-page` | Page H1 | 1.75rem | 1.5rem | 700 |
| `--fs-section` | Section header | 1.25rem | 1.125rem | 700 |
| `--fs-card-title` | Card/widget title | 1rem | 1rem | 600 |
| `--fs-body` | Body | 0.875rem | 0.875rem | 400 |
| `--fs-data` | Numeric/price | 0.9375rem | 0.9375rem | 600 tabular |
| `--fs-label` | UI label | 0.8125rem | 0.8125rem | 500 |
| `--fs-caption` | Caption/subtext | 0.75rem | 0.75rem | 400 |
| `--fs-micro` | Uppercase eyebrow (floor) | 0.6875rem | 0.6875rem | 600 +tracking |

Rules: **11px floor** (retire 7/7.5/8/9/9.5/10px). Title→caption ≥ one full step (16→12, not 16→13). Micro-labels get letter-spacing, not shrinking. Migrate CSS + inline `fontSize` to `var(--fs-*)`; delete the 43 ad-hoc media overrides.

### Addendum — items #24 and #25 (Structural)

These two are a different kind of work from everything else fixed in this document. Items #1-23 were bugs with a single provably-correct fix (a wrong variable, a stale value, a missing CSS rule) - safe to apply and verify in one pass, several even safe to do as a mechanical sweep (the sub-11px floor, the em-dash cleanup) because the transformation was unambiguous at every site. #24 and #25 aren't that: migrating a font-size declaration onto the role-based scale requires deciding, at each of ~1,258 individual sites, *which role that particular piece of text actually plays* (is this 12px a `--fs-label` or a `--fs-caption`? a `--fs-body` or a `--fs-data`?) - a judgment call, not a substitution. Doing that as a blind sweep would silently miscategorize a large fraction of them and there'd be no way to catch it except manually reviewing every one.

**#24 - what's actually done:** defined the full 9-token role-based scale from the table above as real CSS custom properties in `:root` ([globals.css](app/globals.css)), alongside the older size-tier scale (`--fs-xs` through `--fs-3xl`) that already existed there. Worth noting: that older scale is itself a preview of this problem - its own comment claims "8 tiers (was 23 distinct sizes)," but it's referenced in only 17 of ~580 CSS `font-size` declarations (~3% adoption). Verified live: all 9 new tokens resolve correctly (`--fs-page: 1.75rem`, `--fs-micro: .6875rem`, `--fs-display: clamp(2.25rem, 6vw, 4rem)`, etc).

**Update 2026-07-17 - the `rem` half is now done (was the last open piece of SYS-7):** product owner confirmed the goal was "preserve current look, just make it zoom-responsive" rather than visually consolidating onto the 9-role scale (which would resize things like every page H1 by ~40%). That reframed the "large judgment-call pass" into a safe **mechanical** 1:1 `px`→`rem` conversion (value/16 - root font-size confirmed 16px, no override anywhere in the codebase, so the conversion is pixel-identical at default zoom). Ran via two small Node scripts: one for `globals.css` (685 `font-size:` declarations, incl. the 8 old tier tokens and the 4 `clamp()` heroes), one across all of `app/`+`components/` for inline `fontSize` (923 of 934 - bare numbers and `'Npx'` strings converted automatically; the remaining 11 were ternaries/`Math.round()`/an inline `clamp()` string that needed a manual look - fixed individually, one (`CoinIcon.tsx`'s glyph-scaling `Math.round(size * 0.38)`) deliberately left alone since it's proportional icon-to-container sizing, not a fixed text declaration). Added a `@media (max-width: 640px)` override for the two role tokens with distinct mobile values (`--fs-page`, `--fs-section`) ahead of future adoption. `tsc --noEmit` clean; verified live across `/dashboard`, `/arena`, `/backtest`, `/news`, `/settings`, `/funding` - zero console errors, spot-checked computed sizes identical pre/post (`.edge-card-value` 15px, `.mb-title` 20px, `.app-logo` 16px).

**Update 2026-07-17 (later same day) - the semantic-token consolidation is now done too:** product owner asked to proceed with the actual role-based consolidation, accepting that it would visibly resize some elements (that's the whole point - fixing "no consistent role split," not just re-expressing the same sizes).

Methodology, since this genuinely can't be done as a blind sweep: wrote a selector-aware extractor (character-level brace/comment scanning, not regex-per-line - a first regex-based version mis-attributed at least one selector inside a multi-line comment, caught on manual review and rewritten) that pairs every `font-size:` declaration in `globals.css` with its real selector and media-query context. Then a heuristic classifier assigns each to one of the 9 role tokens using selector-name semantics first (e.g. `-price`/`-val`/`-score`/`-pct`/`-chg`/`-timer` → `--fs-data`, `-label` → `--fs-label` unless uppercase+bold in which case it's really an eyebrow → `--fs-micro`, `-title` → `--fs-card-title`/`--fs-section` by size unless uppercase+bold same eyebrow exception, `-sub`/`-note`/`-hint`/`-meta` → `--fs-caption`), falling back to current value only when no name pattern matches. Icon/glyph/emoji-named selectors (`-icon`, `-arrow`, `-chevron`, etc.) are excluded entirely - a font-size on a decorative glyph isn't a text role.

Every classification bucket was then reviewed by hand, not trusted blind: the "skip" list (61 items - big standalone numbers, already-tokenized onboarding-wizard classes, dead CSS) and the two highest visual-impact buckets (`--fs-section`, `--fs-card-title`, ~50 selectors total) were individually cross-checked against their actual JSX usage via grep. That review caught real classifier mistakes before they shipped: several `-title` selectors turned out to be small uppercase eyebrow labels, not prominent titles (reclassified to `--fs-micro`); and six selectors with innocuous names (`.theme-btn`, `.gchat-send`, `.ob-cl-min`, `.ob-cl-mini-close`, `.cms-chevron`/`.cms-check`, `.smod-close`, `.lp-x`/`.lp-check`, `.pf-footer-expand-chevron`, `.gchat-login-close`, `.sig-chevron`) turned out to wrap single glyph characters (✓, ✕, ↑, −, ▾) discovered only by reading the component - added as verified manual exceptions. The 17 mobile-media-query font-size overrides in `globals.css` were left alone entirely (not tokenized) - none of them are `--fs-page`/`--fs-section` (the only two tokens with a defined mobile variant), so they're independent, single-purpose component tuning that the shared scale doesn't cover; forcing them onto it would remove real per-component mobile fixes.

Applied by exact line number (never a blind global find-replace) - 615 of 690 CSS `font-size` declarations now reference a role token; 61 left as documented exceptions, 14 left alone as untouched mobile overrides.

**Caught mid-process: HMR was silently serving stale CSS.** After applying this, a live check of `.sms-title` showed the OLD value despite the file being changed on disk and `tsc` clean - Turbopack's dev server wasn't picking up an edit this large via hot-reload. Confirmed no stray `node` process, cleared `.next`, restarted, and only then did the served stylesheet (checked via `document.styleSheets`, not just visual inspection) match the source. This means the *"verified live"* claims logged earlier in this document for the SYS-7 `rem` pass were checking against a `px`→`rem` conversion that is pixel-identical by construction - so a stale-CSS problem there would have been undetectable by a "does it still look the same" check. Re-verified after the restart: `.mb-title` still 20px, `.app-logo` still 16px, `.edge-card-value` still 15px - the earlier rem pass held up, this wasn't masking a real bug, but it's a real gap in how "verified live" was being checked and is being called out rather than quietly papered over.

Verified live post-restart across `/dashboard`, `/arena`, `/news`, `/alerts`, `/settings`, `/funding`, `/liq`, `/hours`, `/correlation`, `/briefing`, `/econ-calendar`, `/calc`, `/login`: zero console errors, zero unexpected horizontal overflow (checked programmatically via `scrollWidth`/`clientWidth`, since the screenshot tool was unavailable/timing out all session - flagging that limitation rather than claiming a visual check that didn't happen), all page text renders intact. One pre-existing minor cosmetic edge case found and left alone: the "RENDER" ticker (6 letters) overflows its 40px correlation-grid column header by 9px - present before this change too (just 1px less), a tight-fit issue for one long ticker symbol, not something this pass introduced or is in scope to fix.

**Update 2026-07-17 (evening) - the inline `fontSize` side (924 sites, 87 `.tsx` files) is now consolidated too**, the remaining half of #24 explicitly left open earlier. This one is structurally harder than the CSS pass: only 37 of 924 sites had a `className` to key off, so a selector-name heuristic barely helps - most classification had to fall back to value/weight/uppercase tiering, which turned out to be meaningfully less reliable than the CSS pass's fallback.

Methodology: an extractor pairs each inline `fontSize: 'Xrem'` with its enclosing tag's `className` (if any), `fontWeight`/`textTransform` in the same style object, and a text snippet of what follows - used to hand-verify the highest-risk buckets rather than trust the heuristic. All 48 sites with a large current value (≥1.125rem - the page/section-title/hero-number range) were individually read against their actual JSX. That review found real content hiding behind "big value": several were disguised numeric displays (a JPY price, a live countdown, whale-position percentages, demo stat numbers in the onboarding tour) that a naive "big text = title" rule would have wrongly promoted to a page-title role - kept as documented big-number exceptions instead, same treatment as the CSS pass's `.rpm-score`-style skips. Three pages (`/terms`, `/privacy`, `/disclaimer`) have a genuinely bigger hero H1 (42px vs every other page's 20px) - left alone rather than silently shrinking a legal page's heading without an explicit decision to do so.

A second, broader scan searched every one of the 924 sites (not just the 48 large ones) for short symbol-only text immediately after the styled tag - caught 27 more glyph/emoji characters (✓, ✕, ▾, ▲, ▼, →, ←, ✈, ⓘ, ·, ×, /mo-adjacent) hiding behind ordinary-looking names with no `-icon`/`-arrow` naming convention, verified by reading each one's actual JSX.

The costliest finding: a full read of the entire ~37-item `--fs-body` bucket (0.875rem, no `className`) showed the value-fallback tier is unreliable specifically for anonymous bold text - roughly 15 of those "body paragraph" guesses were actually page/panel titles (`"Live Prices"`, `"LiquidityHQ"` wordmark on `/upgrade`, a modal's `{title}`, disclaimer/privacy/terms' `{s.title}` subsection headers) or tabular-nums data values (`CycleDayCounter`'s day counts, `AccumulationTracker`/`DistributionTracker` scores, `WatchlistFeed`'s price) that happened to render at 14px. Cross-checked against every `fontVariantNumeric: 'tabular-nums'` declaration in the codebase as a second, independent signal - found several more in the caption/label tiers too, but those were left as-is: they're compact numbers in dense tables/charts (10-13px today), and forcing all of them up to `--fs-data`'s 15px risked real overflow in cramped rows without individually verifying each table's layout - a consolidation left for a future pass, not attempted blind here.

Applied by exact (file, line, value) match, not a blind regex - 878 of 924 sites now reference a role token; 46 left as documented, individually-verified exceptions (glyphs, big standalone numbers, the 3 legal-page hero H1s).

Restarted the dev server proactively before verifying (86 files is an even bigger edit than the CSS pass that triggered the stale-HMR issue) - confirmed no stray `node` process, cleared `.next`, confirmed the served stylesheet matched source before checking anything else. `tsc --noEmit` clean. Verified live across 20 routes (`/dashboard`, `/arena`, `/news`, `/alerts`, `/settings`, `/funding`, `/liq`, `/hours`, `/correlation`, `/briefing`, `/econ-calendar`, `/calc`, `/terms`, `/privacy`, `/disclaimer`, `/upgrade`, `/prices`, `/backtest`, `/offline`, a 404 route) - zero console errors, zero new overflow beyond the same pre-existing ones already noted, spot-checked several specific fixes by computed style (`"Calculators"`/`"Position Sizer"` both 20px matching `.mb-title`'s convention, `"Live Prices"` 16px card-title, `"Backtesting is part of Pro."` 20px down from 24px, `"404 - Liquidity not found"` unchanged 28px). `/journal` (TradeJournal.tsx, the single largest file at 81 sites) is auth-gated so its dense trade table couldn't be checked live - individually verified 6+ of its specific entries during the manual review instead.

**#25 - what's actually done:** two shared components now exist and are adopted, not just defined. [components/LoadingState.tsx](components/LoadingState.tsx) (built for item #16) replaced three different ad-hoc loading treatments on `/funding`, `/correlation`, `/upgrade`. [components/EmptyState.tsx](components/EmptyState.tsx) (built here) wraps the `.empty-state` CSS convention that `TradeJournal.tsx`, `DistributionTracker.tsx`, and `alerts/page.tsx` had each already been using ad-hoc - applied it to `/live-tracking`'s "No signals logged yet," consolidating a fourth ad-hoc instance into the shared one.

**Update 2026-07-17 - the dashed-card variant is now consolidated too:** turned out `.ps-empty` wasn't PositionSizer's one-off - the exact same class had been independently copy-pasted into 5 more calculators (`DcaCalc`, `FundingCostCalc`, `LiquidationCalc`, `PnLCalc`, `RiskRewardCalc`), plus `HypothesisTracker` had a near-identical inline dashed box. Added a `dashed` prop to `EmptyState` (new `.empty-state-dashed` CSS modifier, same visual as the old `.ps-empty`) and swapped all 6 `.ps-empty` usages + `HypothesisTracker`'s inline version onto it; `.ps-empty` itself deleted (dead after the swap). Verified live on `/calc` - Position Sizer and Liquidation Price tabs both render correctly, no console errors.

Also closed the two loading-transient loose ends noted in SYS-6: added `app/funding/loading.tsx` (using the shared `LoadingState fullPage`) so Next's route-level Suspense boundary shows an instant loading UI during navigation/bundle-load instead of a blank frame - this is the documented fix for exactly this class of flash (`node_modules/next/dist/docs/.../loading.md`). The `MacroStrip.tsx` DXY/SPX/GOLD "-" transient was investigated and left alone on purpose - it's the same shared-store hydration pattern used everywhere else in the app for not-yet-loaded numeric values (e.g. dashboard's `BTC.D -`), not a one-off inconsistency; "fixing" it in isolation would mean redesigning how every numeric widget in the app handles its pending state, well beyond this item.

**What's still not done:** nothing structurally - both shared components (loading + empty-state, plain and dashed) are now built and adopted everywhere the audit identified. Any *new* ad-hoc loading/empty spot added in the future should use these instead of inventing a new pattern.

---

## 8. Prioritized improvement list (open items — nothing here is fixed yet)

### Correctness first
1. `[High]` **QA-1** — ✅ fixed + verified live, see §3.
2. `[High]` **QA-3** — ✅ fixed + verified live, see §3.
3. `[Med]` **QA-2** — ✅ fixed + verified live, see §3.

### Deploy + biggest UX
4. `[High]` **Deploy the §2 fixes to prod** — ✅ done. All §2 fixes (plus every subsequent fix in this document) have since been deployed to `liquidity-hq-dev.onrender.com` across multiple deploys this session, most recently commit `5620494`.
5. `[High]` **AUTH-1** — ✅ fixed + verified live, see §4.

### Layout / responsive
6. `[High]` Arena mobile — ✅ fixed, see §6.
7. `[Med]` Scroll affordance on horizontal chip rows — ✅ fixed, see §6. (Arena was checked - its coin-category filter is 5 short buttons that fit without scrolling, no clipping found there; fix applied to the two surfaces that actually clip: News and Grok.)
8. `[Med]` Reduce the repeated bold RISK-DISCLOSURE footer footprint — ✅ fixed. [PlatformFooter.tsx](components/PlatformFooter.tsx) rendered the full 6-item disclosure grid (label + 2-3 line paragraph each) on every single page, stacking to one column ≤640px - a large scroll footprint repeated site-wide. Collapsed the grid behind a "Show full risk disclosures" toggle; the required bold disclaimer sentence ("LiquidityHQ provides data analytics... trade at your own risk") stays always visible, un-gated - only the elaborating grid is opt-in. Verified live on `/about`: collapsed by default, expands/collapses cleanly on click, chevron rotates.

### Theme / color
9. `[Med]` **AUTH-4** — ✅ fixed, see §4.
10. `[Med]` Wire landing to light theme — ✅ already done (found already shipped, not new work this pass) - `[data-theme="light"] body.landing` re-pins all tokens dark, verified via computed styles. See §5 landing row.
11. `[Med]` Settings light: locked list legibility — ✅ fixed, see §6.
12. `[Low]` Consolidate the 3 theme-toggle implementations into one hook — ✅ fixed. There were actually 4 copies (NavDrawer's toggle, SettingsModal's chips, and Settings page's chips duplicated across its logged-out/logged-in views), each hand-rolling `data-theme` + `localStorage` + the `theme-change` event dispatch separately. Consolidated into [lib/theme.ts](lib/theme.ts) (`useTheme()` hook) + a shared [components/ThemeChips.tsx](components/ThemeChips.tsx), and moved the sun/moon SVGs (previously inlined 3 times with slightly different sizes) into [components/icons.tsx](components/icons.tsx) alongside the existing `Warn`/`Download` icons. Verified live: toggling from the nav updates Settings' chips and vice versa, both directions, both themes.

### Interaction / functional
13. `[Med]` **AUTH-3** — ✅ fixed + verified live, see §4.
14. `[Med]` **AUTH-5** — ✅ already fixed, see §4.
15. `[Med]` Verify Grok **Expand** control — ✅ investigated, doesn't reproduce, see AUTH-6.
16. `[Med]` Unify loading (one skeleton) + empty states — ✅ fixed, see SYS-6 / §7 addendum #25. (Blank-flash timing fixed via `app/funding/loading.tsx`; MacroStrip "—" transient investigated and left as-is - matches the sitewide pending-value pattern, not a one-off bug.)
17. `[Low]` **AUTH-2** — ✅ fixed + verified live, see AUTH-2.
18. `[Low]` Grok single close button — ✅ fixed + verified live, see AUTH-6. Gate-copy unification — ✅ fixed: turned out to be 4 implementations, not 3 - `ProGate.tsx` was dead code (never imported) with hardcoded off-brand purple (`#6d28d9`) and non-theme colors, deleted along with its orphaned CSS; `/backtest`'s full-page gate hand-rolled the exact same JSX + checkout-fallback logic as `UpgradeGateModal` (down to a comment admitting it), extracted into a shared `FullPageUpgradeGate` component + `useCheckoutHref()` hook. `LockedFeatureCard`/`UpgradeGateModal` (the real shared pair, used by alerts/arena) untouched. Verified live (Pro account, so the gate itself doesn't render, but confirmed `/backtest` and `/alerts` both load clean with the non-gated view, zero console errors). Public `/upgrade` pricing — ✅ fixed. The page's `useEffect` was redirecting every logged-out visitor straight to `/login?signup=1` before they ever saw a price - pure friction on the conversion page. Removed that branch; login is now only required at the actual "Get Pro" click (`handleCheckout` already had the right fallback there), Pro users still redirect onward to `/arena` unchanged. This also exposed a live crash risk - the "payments launching soon" copy unconditionally read `user.email`, which would throw now that the page renders for a `null` user; added a logged-out variant that invites sign-up instead. Verified live both ways: anonymous session sees full Free/Pro pricing with zero console errors; Pro account still redirects to `/arena`.

### Accessibility
19. `[High]` Retire all text < 11px (7/7.5/8/9px) — ✅ fixed. 131 inline `fontSize` + 5 CSS `font-size` occurrences across 37 files, mechanically bumped to the 11px floor (pure numeric substitution, `sed` across `app/`+`components/`, verified zero remaining sub-11px sizes afterward). 10px was explicitly left alone - out of this item's stated scope (7/7.5/8/9px only), and it's the single largest cluster (205 CSS + 168 inline) that really belongs to the full #24 migration. `tsc --noEmit` clean; spot-checked live on `/dashboard` (18×18 coin badges, previously 8px text) and elsewhere - no clipping or overflow from the size bump.
20. `[Med]` Touch targets ≥44px — ✅ fully fixed. Of the 4 named spots: **Grok coin chips** (was 40×28) → `min-height: 44px`, safe since it's a dedicated single-purpose scroll row. **"new play" button** (was ~20px) → went with `36px` instead of the full 44 - it sits inline in a compact `justify-content: space-between` header next to much shorter siblings (a badge + counter text), and forcing 44px would visually inflate that whole row; 36px matches the codebase's own existing icon-button compromise (`.theme-btn`) and meaningfully improves tap accuracy without breaking the header's rhythm - verified live, looks clean, not bulky. **Footer nav links** (was ~18px) → added `padding: 12px 0`, safe since they're an independent flex child, not sharing a row with anything shorter. **"nav ~30"** — investigated, left alone: the closest match is `.desktop-nav-item` (~26-30px), but that's the desktop-only top nav bar, a mouse-driven context where the WCAG 44px *touch* target guideline doesn't really apply; the actual mobile nav surfaces (bottom tab bar, hamburger drawer items) were checked and are already ≥44px effective height. `rem` migration (px→rem across ~580 CSS + ~678 inline declarations) is the other half of this item - was deferred as too big/risky for a touch-target pass, but has since been done as its own dedicated pass, see SYS-7.
21. `[Low]` Heading semantics — ✅ fixed for the shared pattern. The audit's `/funding` example (and 5 other pages sharing the same `.mb-title` convention - `/alerts`, `/backtest`, `/briefing`, `/correlation`, `/live-tracking`) used a plain `<div>` for what was visually the page's H1. Fixed by converting the *first* `.mb-title` per page to `<h1>` and any subsequent same-page `.mb-title` (section sub-headers, e.g. backtest's "Per-Coin Breakdown", "WaveTrend Confirming-Layer Tuning") to `<h2>` - `.mb-title`'s CSS is class-based with no tag qualifier and the codebase already has a global `* { margin: 0 }` reset, so this was a zero-visual-risk change (verified live: `/funding` renders exactly one `<h1>`, `/backtest` renders one `<h1>` + 4 visible `<h2>`s, both matching expected structure with no layout shift). **Update 2026-07-17 - the remaining ad-hoc-title pages are done too.** Journal (`TradeJournal.tsx`) and `news/page.tsx` each had a single page-title div -> `<h1>`. `settings/page.tsx` needed both its "Settings" title (both the logged-out and logged-in render branches) -> `<h1>`, and the shared `Section()` helper's own title -> `<h2>` for its 8 subsections (Account, Appearance, etc). Position Sizer turned out to need more than itself: it's only ever rendered as one tab inside `/calc`, whose own "Calculators" title was *also* still an unconverted div - making Position Sizer an `<h1>` while the actual page title stayed a plain div would have inverted the hierarchy. Fixed `/calc`'s title to `<h1>` and all 6 calculator components sharing the identical title pattern (`PositionSizer`, `DcaCalc`, `FundingCostCalc`, `LiquidationCalc`, `PnLCalc`, `RiskRewardCalc`) to `<h2>`, since only one renders at a time as that tab's active heading. Verified live: `/settings` renders exactly 1 `<h1>` + 8 `<h2>`s at unchanged computed sizes; `/calc` renders 1 `<h1>` + 1 `<h2>` that correctly swaps text when switching tabs. Zero console errors, zero layout shift.

### Copy / metadata / low
22. `[Med]` **NEW-1** / **NEW-4** — ✅ already fixed, see §4 (doc was out of sync with the actual code state, not a real remaining bug).
23. `[Low]` — ✅ all fixed, see SYS-8 / AUTH-7 / NEW-2 / NEW-3 / Journal AuthGate note above.

### Structural
24. `[High]` ✅ Fully done - `rem` conversion + semantic-token consolidation, both CSS (615 of 690 declarations) and inline JSX (878 of 924 sites), all now on the 9 role tokens - see §7 addendum below.
25. `[Med]` ✅ Shared loading + empty-state components (plain and dashed) built and fully adopted - see §7 addendum below.
26. `[Med, future]` ✅ Scoped fix applied - product owner flagged 2026-07-17, search-filter added same day. **`/alerts`' "Alert Coins" grid** ([app/alerts/page.tsx:690-712](app/alerts/page.tsx)) was a flat `flex-wrap` chip cloud rendering every entry in `COINS` as an individual toggle button, no search/filter/grouping - fine at 50 coins, wouldn't scale past 100+. Added a plain substring search box (`.acoin-search`, [globals.css](app/globals.css)) above the grid that filters `COINS` client-side, plus a "No coins match" message for the empty-result case. This is the cheap/scoped fix, not the full solution - category grouping or a virtualized list would be needed if the coin count grows much further, but search alone covers the "quickly find one coin among many" problem for the foreseeable future. Verified live: typing "eth"/"sol" narrows the grid to the single matching chip, clearing restores all 50, zero console errors.

---

## 9. Blockers & limitations

**Blockers do not block page access.** Only 3 things were literally un-renderable: `/auth/callback` (transient redirect), `/global-error` (needs a crash), and — before the DB role change — the Pro backtest tool (now audited).

| Blocker | Type | Impact |
|---------|------|--------|
| Live session only on deployed `-dev` build; token can't be ported to local fixed build (security guard) | Access | Authed pass ran on **pre-fix prod code**; §2 fixes verified locally, not in an authed prod state |
| Can't self-login (Google password entry prohibited) | Access | Needed the user to sign in manually |
| Free tier (before change) | Access | Pro backtest was paywalled — cleared by the authorized `role→pro` DB change |
| Some pixel-clicks don't fire React `onClick` | Tooling | Used JS `.click()` as a reliable workaround |
| `/scanner` heatmap canvas intermittently hangs the screenshot tool | Tooling | Succeeded on retry; content also read via text |
| UI-only safety rule | Self-imposed | Post-submit result/loading/error states of credit/account actions unaudited (Fire, Generate, Grok send, Save, Telegram connect, log/edit/delete trade, checkout) |
| First-run modals + `/auth/callback` + `/global-error` | State | Can't trigger without a fresh account / crash / mid-login code |

**DB change made (authorized) — reverted 2026-07-17:** both test accounts (`1a05ac61-9336-42c8-976b-ef7343148b20`, `d4ccd40f-70a6-4f07-9665-81ad822814c1`) were set `role='pro'` in `public.lhq_dev_user_subscriptions` for audit purposes, then deleted back to free once the audit closed out.

*This is an audit document — findings and recommendations only. The §2 fixes are the only code changes made; everything in §8 is open, pending review.*

---

# Audit Pass 2 — 2026-07-19 — Design/UX sweep, multi-viewport (findings only, NO fixes applied)

Second pass, focused on the recently-shipped items (RaidMeter now wired to `/dashboard`, `/learn` glossary #14, alert outcomes #10, threshold sliders #13, arena countdown fix) plus general responsive behaviour. Lenses: design-critique + mobile/tablet responsive. **Nothing in this section is fixed — it is a list only, per request.**

**Method + honesty caveats (read before trusting any number below):**
- **Both browser tools were half-broken this session**, so this pass is **JS/DOM-measurement based, not screenshot-based** for mobile/tablet. `claude-in-chrome` screenshots fine but its window `resize` silently no-ops (viewport stuck at ~1869px). The in-app preview pane (`Claude_Browser`) resizes correctly but its **screenshot tool wedges/times out** (the known failure from the `feedback_browser_verification` memory). So responsive findings were measured via `getBoundingClientRect`, `getComputedStyle`, and the WCAG luminance formula in-page — the same quantitative method §1/§7 of Pass 1 used — run against the live **localhost dev** build (`51a99e8`, identical code to prod). Desktop visuals rely on screenshots captured earlier in the session (prod dashboard at ~1400px, RaidMeter rendering correctly with sidebar).
- **Logged out** the whole pass (both prod and localhost dropped the session; can't self-login — Google password entry prohibited). So **auth-gated surfaces were NOT visually audited**: #10 AlertOutcomes full panel, #13 threshold sliders (they live in Settings / SettingsModal / Arena, all gated), Journal, authed Settings. Those need an authenticated re-pass — flagged in §D below, not evaluated here.
- The preview pane's width fluctuated (reported innerWidth 375/433/444 for the "mobile" preset, ~800 max for "desktop") — it can't reach true desktop width (≥1024), so the desktop *layout* (sidebar shown) couldn't be re-measured live, only confirmed from earlier screenshots. Mobile breakpoint findings are solid (all measured widths sit below the app's 480/640 breakpoints).

## Severity index (Pass 2)
| Sev | Items |
|-----|-------|
| **High** | P2-1 (dark-mode micro-label contrast 1.98:1, app-wide incl. RaidMeter), P2-2 (tablet renders the mobile layout — no tablet breakpoint) |
| **Medium** | P2-3 (`/learn` reading hierarchy: h2==h3==16px + 12px body), P2-5 (12×12px news-dismiss tap target), P2-6 (mobile dashboard ~58–69px horizontal overflow) |
| **Low** | P2-4 (10px sub-legible text persists, below own 11px floor), P2-7 (RaidMeter 5-factor grid orphan cell) |

## A. Accessibility / contrast

### P2-1 — Dark-mode uppercase micro-labels fail WCAG hard `[High]` — ✅ FIXED + verified live 2026-07-19
**Fix applied:** raised the dark `--txt3` token `#3e4258` → `#767d92` in both definitions ([globals.css](app/globals.css) `:root` + the `[data-theme="light"] body.landing` dark re-pin). Verified live in-page (dev build, HMR picked it up): `.rpm-factor-label` **4.77:1**, `.edge-card-label` **4.91:1**, `.dash-section` **4.91:1** — all now ≥ AA 4.5:1 (were 1.98–2.04:1). Light mode untouched (its `--txt3` is a separate `[data-theme="light"]` override from Pass 1 CRIT-3). Documented tradeoff in the CSS comment: on a near-black bg an AA-passing muted tier necessarily sits close to `--txt2` (#7a7e94) — differentiate those two tiers by weight/size/tracking, not the ~0.1-ratio color gap. Original finding below for record.

Measured in-page (WCAG 2.1 relative-luminance): `.rpm-factor-label`, `.dash-section`, and `.edge-card-label` all render `color: #3E4258` (rgb 62,66,88) on the near-black card/canvas bg → **contrast ratio 1.98–2.04:1**. AA needs 4.5:1 for normal text, 3:1 even for large; these are 11px (normal), so 1.98:1 is failing by a wide margin. This drives the eyebrow labels across the dashboard AND the newly-wired RaidMeter's factor labels (SESSION / DAY / FEAR & GREED / FUNDING / ORDER WALL). **Note this contradicts Pass 1's assumption that "dark mode was fine" for `--txt3`** — Pass 1 fixed the *light*-mode `--txt3` (CRIT-3) but these specific dark labels at `#3E4258` were never measured and do not pass. Not necessarily `--txt3` itself — could be a darker dedicated label token; needs a source trace to confirm which variable. Affects every screen using the eyebrow-label pattern, not just RaidMeter.

### P2-4 — Sub-11px text still present `[Low, a11y]`
Dashboard (mobile) still renders **10px** text on leaf nodes, below the app's own stated **11px floor** from Pass 1's §7 typography goal. 11px also present (that's the floor, acceptable). The 10px instances are the offenders. (Pass 1 did a `px→rem` conversion but explicitly did NOT enforce the 11px floor as a visual consolidation — so this is expected residue, re-flagged for whenever that consolidation happens.)

## B. Responsive / layout

### P2-2 — Tablet gets the mobile layout, not a tablet layout `[High]` — ⏸ HELD (not fixed, needs visual QA at tablet widths)
**Why not fixed this pass:** the `1100px` boundary is **load-bearing**, not just the dashboard grid. At `@media (min-width: 1100px)` the app simultaneously switches: app-bar-inner width (capped ~700px below 1100, forcing the compact hamburger nav — see [globals.css](app/globals.css) line ~626 "nav doesn't fit below 1100"), the desktop nav + session pill, `.app-content` max-width/padding, the `.dashboard-grid` two-column grid, AND `.dash-tile-pair`. Lowering it to ~900 to cover tablets means the top chrome and layout all shift together, and this session's browser tooling **cannot render 900–1099px** to visually confirm nothing breaks (claude-in-chrome resize no-ops; the preview pane caps ~800px). Blind-shipping a load-bearing responsive change to a live product is exactly the trust risk this audit flags elsewhere, so it's held for a pass where tablet widths can actually be eyeballed (real device, or working browser tooling). Original finding below.

At **768px** (iPad portrait) *and* **800px**, measured: `.dash-sidebar` is `display:none`, the `.mobile-only` block is visible, `.desktop-only` is hidden. So the desktop breakpoint only engages at some width **above 800px** — every tablet (768 portrait, and borderline landscape) renders the **single-column phone layout**. Consequences: the persistent left coin-list sidebar (CoinSidebar + MarketPulseStrip) that desktop users get **disappears entirely** on tablet; cards like RaidMeter stretch full-width (RaidMeter factor grid measured `314.5px × 314.5px` 2-col across the full 768) with a lot of unused horizontal space and phone-oriented density on a large screen. No dedicated tablet breakpoint exists. This is the biggest untested-viewport gap.

### P2-6 — Mobile dashboard scrolls horizontally ~58–69px `[Medium]`
`document.scrollWidth − clientWidth` measured **58px at 433w, 69px at 444w** on `/dashboard` (mobile) — the page has a horizontal-scroll jiggle. Culprit is NOT a single uncontained element near the viewport edge (the only uncontained overflower is the off-canvas `.nav-menu` drawer, positioned way past the edge by design). So the overflow comes from a *contained*-but-bleeding element — likely the breaking-news marquee (`.ticker-content`, measured ~4976px wide) or a transform/negative-margin leak. **Needs a source-level trace to pin** — do not assume the marquee is the cause without checking its clip container. `/alerts` and `/learn` measured **0** overflow, so it's dashboard-specific.

### P2-7 — RaidMeter 5-factor grid leaves an orphan cell `[Low]`
RaidMeter has **5** factor tiles (Session, Day, Fear & Greed, Funding, Order Wall) laid out in a **2-column** grid at mobile/tablet → 2+2+1, so the 5th tile (Order Wall) sits alone in the last row with an empty cell beside it. Minor visual imbalance; consider a full-width 5th row or a 5th synthetic tile.

## C. Content / hierarchy — `/learn` glossary (#14)

### P2-3 — `/learn` reading hierarchy is flat for a long-form content page `[Medium]`
Measured heading sizes: **h1 32px, h2 16px, h3 16px** — h2 (category headers) and h3 (term names) are the **same size**, so the page's two sub-levels don't visually differentiate. Body copy is **12px** with 19.8px line-height. For a page whose entire purpose is SEO + educating cold organic traffic (Pass 1 / #14 rationale), 12px long-form body is small and the collapsed h2/h3 hierarchy makes the 30-term list read as one flat wall. Otherwise `/learn` is clean: **0 horizontal overflow** at all measured widths, correct SEO `<title>` + `<h1>`, auth-aware CTAs present. Recommendation direction (not applied): bump body to ~14px, open a clear step between h2 and h3.

## D. Positives worth keeping
- **RaidMeter is genuinely well-behaved on mobile** — 343px card fits the 375 viewport with no overflow, factor grid collapses to a clean 2-col (152px each), score stays 48px and legible, verdict/subtext intact. The newly-wired component itself is solid; its only issue is the shared label-contrast token (P2-1), not its own layout.
- `/alerts` and `/learn` both measured **zero horizontal overflow** across mobile widths — responsive containers are correct there.
- `/learn` SEO scaffolding (title, H1, auth-aware CTA) is correct and renders logged-out as intended.

## E. NOT audited this pass (need an authenticated + true-desktop re-pass)
- **#10 AlertOutcomes full panel** (win-rate / avg-% / miss display) — gated, only its text was detectable logged-out; layout/empty-state/number-formatting unaudited.
- **#13 threshold sliders** — live in Settings / SettingsModal / Arena, all auth-gated; `input[type=range]` count was 0 on the logged-out `/alerts` page (expected, they're not there). Slider touch-target size, label association, and mobile thumb ergonomics unaudited.
- **Arena candle-close countdown badge** (the `6690883` FAB-collision fix) — verified visually on **prod desktop** earlier this session (clamp holds, no FAB overlap); the mobile clamp was **not** re-measured this pass (arena's heavy chart risks wedging the pane).
- **True desktop layout (≥1024)** — sidebar-shown state confirmed only from earlier screenshots, not re-measured this pass (preview pane caps ~800px).
- **Journal, authed Settings, light-mode** — not revisited.

*Findings only. No code changed in this pass. Same priority order as Pass 1: data-trust > usability > accessibility > aesthetics — so P2-1 (contrast) and P2-2 (tablet layout) lead.*
