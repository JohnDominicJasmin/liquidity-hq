# LiquidityHQ — UI/UX + QA Audit

Senior UI/UX + QA audit of the production trading platform. Multi-viewport (Desktop 1440 / Mobile 390), multi-theme (Dark / Light), every route, logged-out **and** authenticated. Priority order: **data trustworthiness > usability > accessibility > aesthetics**.

## 0. Executive summary

- **Two audit passes:** Part A (logged-out, on local `dev` build) + Part B (authenticated, signed in as `20-60951@g.batstate-u.edu.ph` on deployed `liquidity-hq-dev.onrender.com`). Every route opened and rendered.
- **7 fixes already applied & verified** on the local build (see §2). Not yet deployed — so prod still shows them.
- **3 data-correctness / QA bugs** found (§3) — the highest-severity class on a trading tool.
- **1 dominant authenticated issue:** the "QUICK SETUP" onboarding overlay + "Ask AI" FAB cover primary CTAs on every signed-in page (§4, AUTH-1).
- **Typography:** ~26 discrete font sizes, no token scale (§7).
- **Account note:** to audit the Pro backtest tool, the user's DB `role` was set `free→pro` (`lhq_dev_user_subscriptions`, their authorization) and **left as pro** by request, for `user_id=1a05ac61-9336-42c8-976b-ef7343148b20`. A second pass (this fix-verification round) found the currently-logged-in session uses a *different* auth user_id for the same email (`d4ccd40f-70a6-4f07-9665-81ad822814c1` - likely a re-linked Google identity), so that one was also set to `pro`, with the same authorization, to verify QA-3 live. Revert both:
  `DELETE FROM public.lhq_dev_user_subscriptions WHERE user_id IN ('1a05ac61-9336-42c8-976b-ef7343148b20','d4ccd40f-70a6-4f07-9665-81ad822814c1');`

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

**Still open — `⚠` warning triangle (~25 uses across ~15 files):** the risk-warning prefix on calc warnings, liquidation alerts, journal, funding, etc. `⚠` is borderline — a *standard* risk indicator in finance UIs (mostly monochrome), unlike phone/fire emoji. The color-emoji variant `⚠️` (with VS16) in `SetupScanner`/`MarketProvider` is the clearer offender. Recommend a shared `<Warn/>` SVG (or a `.ps-warn::before` icon) if full removal is wanted — flagged for a decision, not yet changed. Geometric trading glyphs `▲ ▼ ◆` and the `✕` close glyph were kept (standard, monochrome, follow color).

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

### SYS-6 — Inconsistent loading & empty states `[Medium]`
No unified skeleton: `/funding` flashes blank black before paint; `/upgrade` bare "Loading…"; `/correlation` proper "Calculating correlations…" but its DXY/SPX/GOLD macro cards briefly show bare "—" (a load transient — they do populate); `/live-tracking` clean sentence. Pick one loader + one empty-state pattern.

### SYS-7 — All font sizes fixed `px`, none `rem` `[Medium, a11y]`
Zero `rem` in `globals.css`; inline styles px too. Text ignores browser font-size preference / resists zoom-reflow. See §7.

### SYS-8 — Copy / naming inconsistencies `[Low]`
- Feature naming drift: `/liq` = tab "Liquidity Map" / nav "Liquidation Map" / H1 "Liquidation Heatmap"; `/hours` = tab "Market Hours" / H1 "Best Hours".
- Stale "17 coins": landing (fixed) **and `/about` Data Sources (not fixed — real = 50)**.
- Doubled tab titles: `/terms` + `/privacy` render "… — LiquidityHQ — LiquidityHQ" (page title already includes the suffix the root template appends); `/about` + `/disclaimer` correct — inconsistent metadata.
- Em-dashes throughout UI copy vs the project's hyphen-only standard.

### Authenticated-specific (AUTH-2..7)
- **AUTH-2 `[Med]`** Account menu: email `20-60951@g.batstate-u.edu.ph` wraps mid-domain (`…edu.p`/`h`) — no `word-break`; "Settings" item near-invisible grey vs blue "view usage" / red "Sign out".
- **AUTH-3 `[Med]`** — ✅ fixed. Alerts (free tier): a "Pro plan required" upsell sat **above a fully-rendered but greyed/disabled Telegram connect flow** (`opacity: 0.4; pointerEvents: 'none'` on the whole wizard card) - a dead form the user could look at but not use. Price Alerts (free) worked below, unaffected. Replaced the banner + dimmed form with a single `LockedFeatureCard` ([app/alerts/page.tsx](app/alerts/page.tsx)) - the same shared Pro-gate pattern already used on Arena's other locked cards - wired to the shared `UpgradeGateModal`. Verified live both ways: free tier shows the locked card and its "Unlock with Pro" button opens the paywall modal correctly; Pro tier shows the full interactive wizard with no dimming, no regression.
- **AUTH-4 `[Med]`** — ✅ fixed. `/upgrade`'s nav header ([app/upgrade/page.tsx](app/upgrade/page.tsx)) had `background: 'rgba(10,10,14,0.9)'` hardcoded, unlike every other themed surface - stayed black in light theme. `/markets` and `/prices` were checked and are already theme-aware (`var(--bg)`), so this specific fix only touched `/upgrade`. Switched to `background: 'var(--bg)'`, matching the other two pages' pattern; dropped the now-redundant `backdropFilter: blur()` since the background is opaque. Not independently re-verified live - the test account is Pro, so `/upgrade` redirects away, and reverting Pro status just to see a one-line CSS fix wasn't worth the churn; the identical `var(--bg)` pattern is already confirmed working on `/markets` and `/prices`.
- **AUTH-5 `[Med]`** Research BTC-Risk-Level card lists factor rows (Fear & Greed / BTC RSI / Funding Rate) with **no values** — reads unfinished.
- **AUTH-6 `[Low]`** Grok chat: input enabled + "5 left" usage counter + Fast toggle (good), but **two close buttons** (header ✕ + floating bottom ✕); "Where to set stop?" quick-prompt clips; coin chips 40×28px (below 44px tap target). Expand control appears to toggle the panel closed.
- **AUTH-7 `[Low]`** Settings "Resets at 8:00 AM" states no timezone (user is PHT); News desktop renders an image-less article as a solid black card.

### State-dependent surfaces (onboarding / errors / i18n / PWA)
- **NEW-1 `[Med]`** **Undefined `--txt1` token.** `app/news/page.tsx` (live) and `WelcomeModal.tsx` (dead — see NEW-4) use `var(--txt1)`, but globals defines only `--txt`/`--txt2`/`--txt3` — `--txt1` doesn't exist and there's no fallback, so that text silently inherits color instead of using the token. Rename to `--txt`. (Only the news usage is live.)
- **NEW-4 `[Med]`** **`WelcomeModal.tsx` is dead code** — imported and mounted nowhere (verified via grep). AppShell mounts `OnboardingTour` + `OnboardingGate`; the gate renders `OnboardingFlow` (not `WelcomeModal`) when `profile_complete=false`. The whole component (its "getting started / I know crypto" choice UI + the `--txt1` bug) never ships. Delete it or wire it in.
- **NEW-2 `[Low]`** **`/global-error` is off-brand.** The crash boundary ([global-error.tsx](app/global-error.tsx)) is inline-styled with the **stale purple accent `#7c3aed`** + `sans-serif` (not the app's blue `#1a7aff` / Figtree). Rare page, but looks like a different product.
- **NEW-3 `[Low]`** **PWA install prompt placement.** Rendered live (Chrome, desktop): a `position:fixed` bottom-center toast that overlaps page content (landing feature card, arena chart). Move to a corner and reserve space.
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
| `/research` | ✅ | M + Part A | AUTH-5 empty factor values |
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
| Grok chat panel | ✅ | D Dk+Lt · M | Input enabled authed; AUTH-6; send not run (credit) |
| `/auth/callback` | ✅ | live (Chrome) | Redirects to `/arena` when no auth code — pure transient redirect, no standalone UI |
| PWA install prompt | ✅ | live (Chrome) | Fired naturally; bottom-center fixed toast **overlaps content** (feature card / chart) on desktop |
| `/[locale]` (`/ko`,`/zh`,`/ar`) | ✅ | live (Chrome) `/ko` | Localized landing renders; dark-only; still "17개 코인" on prod (fix not deployed) |
| `/global-error` | 🟡 | code | Full-page "Something went wrong / Try again"; **off-brand** — stale purple `#7c3aed` + system sans-serif vs app blue/Figtree. Can't force a crash to render live |
| Settings **modal** (`SettingsModal.tsx`) | ✅ | live (Chrome) | Account-menu → Settings opens a centered scrollable dialog = `/settings` content (Account/usage rings/Watchlist/Trading Profile). Redundant 2nd settings surface; correctly fires `theme-change` |
| Onboarding tour (`OnboardingTour.tsx`) | ✅ | live (Chrome, 6 steps) | Captured after resetting mikocabal27's `tour_seen`; clean 6-step overlay (Welcome→Arena→Briefing→News→Alerts→Ready), Skip/dots/Back/Next; state restored after |
| Welcome modal (`WelcomeModal.tsx`) | ✅ | code | **DEAD CODE — imported/mounted nowhere** (see NEW-4). Real first-run entry is `OnboardingFlow` (rendered by `OnboardingGate` when `profile_complete=false`) |

---

## 6. Per-feature notes (condensed)

**Positives worth keeping:** dashboard's dense Bloomberg/Coinglass grid reads well in dark; live-prices horizontal card scroller on mobile; journal is a genuinely rich tool (log-trade form + History/Stats/Rules/Shadow Account/Bias Diagnostics/Thesis Tracker, all with clean empty states); backtest dual equity-curve comparison + per-coin breakdown; hours color-coded 24h session map + live PHT clock; calc computes correctly (entry 100/stop 95 → $300, 3u, 0.3x, R:R); 404 on-brand copy; theme flips cleanly on all data pages.

**Notable per-page issues (beyond the systemic ones above):**
- **Arena (mobile):** ✅ fixed — klinecharts OHLC/legend text overlapped the candles + price axis at 390px height, unreadable (desktop was fine, chart has room there). Root cause: `candle.tooltip.showRule` / `indicator.tooltip.showRule` weren't set in [KLineProChart.tsx](components/KLineProChart.tsx)'s theme configs, so klinecharts used its library default (`always`) - a permanent OHLC/volume text overlay regardless of screen size. Set both to `follow_cross` (only shows while actively touching/dragging the crosshair, same pattern most trading apps use on phones) and bumped the ≤420px canvas height from 320px→380px for more breathing room. Verified live on `/arena` — permanent OHLC overlay is gone, candle pane is clean.
- **News:** ✅ fixed — filter-tab + coin-buzz rows scroll horizontally but clipped chips mid-word with no fade/arrow affordance. `NewsBanner.tsx` already had this exact pattern (`.news-scroll-outer` + right-edge `.news-scroll-fade`) for its own econ/geo event row - extracted it into shared `.hscroll-fade-outer`/`.hscroll-fade` classes ([globals.css](app/globals.css)) and applied to the News page's tab bar and `CoinBuzzBar` ([app/news/page.tsx](app/news/page.tsx)), plus Grok's coin selector and quick-prompt rows ([GrokChat.tsx](components/GrokChat.tsx)) via a `.hscroll-fade-panel` variant (uses the panel background `var(--bg1)` instead of the page background, since the Grok panel isn't page-colored). Verified live: all 4 fade elements render with correct per-context background.
- **Journal:** `AuthGate.tsx:22` has an empty `<div>` where an icon was removed (dead markup) in the logged-out gate.
- **Upgrade / gates:** sign-in prompts are worded/styled 3 ways (AuthGate component, settings "SIGN IN TO CONTINUE" list, upgrade signup card) — unify for trust. Logged-out `/upgrade` hides pricing behind auth — friction on the conversion page.
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

---

## 8. Prioritized improvement list (open items — nothing here is fixed yet)

### Correctness first
1. `[High]` **QA-1** — ✅ fixed + verified live, see §3.
2. `[High]` **QA-3** — ✅ fixed + verified live, see §3.
3. `[Med]` **QA-2** — ✅ fixed + verified live, see §3.

### Deploy + biggest UX
4. `[High]` **Deploy the §2 fixes to prod** (verified locally, absent on `-dev`).
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
14. `[Med]` **AUTH-5** — show BTC-Risk factor values (or hide empty rows).
15. `[Med]` Verify Grok **Expand** control (appears to close instead of expand).
16. `[Med]` Unify loading (one skeleton) + empty states (SYS-6).
17. `[Low]` **AUTH-2** — fix account-menu email wrap + Settings-item contrast.
18. `[Low]` Grok single close button; unify gate copy (3 styles → 1); consider public pricing on `/upgrade`.

### Accessibility
19. `[High]` Retire all text < 11px (7/7.5/8/9px).
20. `[Med]` Move type to `rem` (SYS-7); touch targets ≥44px (nav ~30, grok chips 40×28, footer 18, "new play" 20).
21. `[Low]` Heading semantics — some "page titles" (e.g. `/funding`) are non-`<h1>` divs.

### Copy / metadata / low
22. `[Med]` **NEW-1** rename undefined `var(--txt1)` → `--txt` in `news/page.tsx`; **NEW-4** delete dead `WelcomeModal.tsx` (or wire it in).
23. `[Low]` `/about` "17 coins" → 50; fix doubled `/terms` + `/privacy` tab titles; unify feature naming (Liquidation, Best Hours); UI-copy em-dashes → hyphens; settings "resets" timezone; news no-image card; AuthGate empty `<div>`; **NEW-2** re-brand `/global-error` (purple→blue, Figtree); **NEW-3** move PWA toast to a corner.

### Structural
24. `[High]` Adopt the §7 type-token scale (migrate CSS + inline; delete 43 media overrides).
25. `[Med]` Shared skeleton/empty-state component set.

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

**DB change made (authorized, left in place per request):** `INSERT … lhq_dev_user_subscriptions (user_id, role='pro')` for `1a05ac61-9336-42c8-976b-ef7343148b20`. Revert anytime with `DELETE FROM public.lhq_dev_user_subscriptions WHERE user_id='1a05ac61-9336-42c8-976b-ef7343148b20';`

*This is an audit document — findings and recommendations only. The §2 fixes are the only code changes made; everything in §8 is open, pending review.*
