# i18n Migration — Progress & Reference

Read this before resuming i18n work in a new session. It exists so wave numbering, language status, and process rules don't drift or get re-litigated.

## What this is

Every UI string is being moved from hardcoded JSX text to `t('SOME_KEY')`, where the actual text is fetched from the backend. Architecture:

- `lib/labelKeys.ts` — `LABEL_KEYS` union type. **This is the compile-time gate**: `t()` only accepts keys from this array, so a typo'd key is a build error, not a silently blank string. Any new key must be added here.
- `lib/labels.ts` — `Locale` type, `SUPPORTED_LOCALES`, the `useLabels()` hook, `t(key, vars?)` signature. Missing key falls back to the raw key string (never crashes).
- `components/LabelsProvider.tsx` — client provider. Fetches `/api/labels?locale=X` once per locale change, exposes `t()` via context.
- `app/api/labels/route.ts` — public unauthenticated GET. Reads the DB table, merges English as fallback under the requested locale (so an untranslated key still shows English instead of nothing), 60s in-memory cache per locale.
- `supabase/migrations/2026*_labels*.sql` — one seed file per wave/group. All use `on conflict (key, locale) do update`, safe to re-run.

Two Supabase projects, both need every seed file run:
- **LiquidityHq** (`qdpwhnvmhqgzijuwopso`) = prod, table `lhq_labels`
- **Automations** (`wdtjhrilakoitfcezxpx`) = dev, table `lhq_dev_labels`

## Languages

**Supported** (locale codes wired into the switcher/type system, `lib/labels.ts`): 10 — `en, ko, zh, ar, vi, pt-BR, tr, es, id, ru`.

**Implemented app-wide** (has actual DB rows, not just the code path): **1 — `en` only.** Verified via `select distinct locale from lhq_labels` — every row is `en`.

**Not yet implemented app-wide**: 9 — `ko, zh, ar, vi, pt-BR, tr, es, id, ru`. Switcher lets a user pick them; `t()` silently falls back to English (or the raw key) since no translated row exists yet.

**Separate system, don't confuse the two**: the landing page (`lib/i18n/dictionaries.ts`) has real, fully-written `en`/`ko`/`zh`/`ar` translations already — but it's a different, static build-time dictionary, not DB-backed, and isn't touched by these waves. Landing-page language count has no bearing on app-wide status.

## Progress log

| Wave | Scope | Keys | Commit |
|---|---|---|---|
| 1 | Client plumbing, Prices page pilot, language switching, NavDrawer | 87 (10 Prices + 40 Settings + 37 Nav) | `afc96f9` `0d86e5e` `ce518f8` `b8cf12d` |
| 2 | Static pages (terms/privacy/disclaimer/about/login/not-found/upgrade), calc page + 6 calculator components, 9 shared components | 371 | `62003ae` |
| 3 | Dashboard | 70 | `b1816ed` |
| 4 | Arena + Markets | 191 (156 + 35) | `757ab7a` `fb8ea8f` |

**Current total: 723 label rows**, identical in both `lhq_labels` (prod) and `lhq_dev_labels` (dev). 31 files fully migrated: 13 pages (about, arena, calc, dashboard, disclaimer, login, markets, not-found, prices, privacy, settings, terms, upgrade) + 18 components (AuthGate, CoinMultiSelect, DcaCalc, FundingCostCalc, LabelsProvider, LanguageSelect, LanguageSync, LiquidationCalc, NavDrawer, PageHint, PnLCalc, PositionSizer, RiskRewardCalc, SettingsModal, ThemeChips, UpgradeGateModal, UsageMeter, UsageRings).

Two i18n-breaks-logic bugs caught and fixed during wave 4 (see commits `757ab7a`, `fb8ea8f`): a label string that was also being used as a comparison key (`b === 'Beats BTC'`, `h === 'vs BTC'`) instead of a stable id. Check for this pattern in every remaining file — any place a label's literal value doubles as comparison/lookup logic needs restructuring to `{key, ...}` (or a separate stable id) before translating it. Where a field only ever feeds a *derived* comparison value (Markets' `topSignal().col`), no restructuring is needed — only the rendered text changes.

Also confirmed during wave 4: `/api/labels` has a 60s fail-open cache (`app/api/labels/route.ts`) that serves `{}` on any Supabase fetch error — a transient network blip anywhere (even unrelated third-party APIs failing at the same time) can make every page show raw keys for up to 60s. Not a bug in the migration; if a live-verify screenshot ever shows raw keys across a whole page including the nav bar, check `preview_logs` for a `fetch failed` before assuming the migration broke something — wait past the TTL and reload.

## Remaining plan
- **Wave 5** — Funding, Correlation, Backtest, Live-tracking, Scanner, Liq
- **Wave 6** — Journal, Research, Econ-calendar, Alerts, Hours, Playbook, News, Briefing
- **Wave 7** — Trackers/detectors batch 1: AbsorptionDetector, AccumulationTracker, DistributionTracker, WhaleTradesFeed, SetupScanner, HypothesisTracker, AlertOutcomes, SignalAccuracy
- **Wave 8** — Trackers/detectors batch 2 + chart widgets batch 1: MultiTFAlignment, MultiTFSqueezeView, GexTable, CycleChart, DrawdownChart, Sparkline, Sparkline24h, CoinHeatmap
- **Wave 9** — Market-analysis widgets: LiqHeatmap, GrokSignalChart, MarketRead, MarketStructure, MarketConditionsWidget, VolatilityRegime, OnChainScore, GlobalMacroContext
- **Wave 10** — EconCalendarWidget, DryPowder, ConfluenceScore, BtcRiskLevel, CycleDayCounter, HigherTfMoveBadge, StopLossZone, SessionCountdown
- **Wave 11** — SOTD, BacktestStatsUI, TradeJournal, LiqFeed, CoinMarketSnapshot, OnboardingFlow, SpotlightTour, LearnContent
- **Wave 12** — `/ops` admin console (staff-only, not customer-facing) — lowest priority, proposed to defer entirely unless requested

Total scope is roughly 150 files; the wave list above is the current best breakdown but component names/counts may shift slightly as each wave is scoped in detail.

## Process rules (lessons learned this session — follow these)

1. **Batch size.** Agents reliably hit the output-token cap past 7+ files or a long self-report. Keep delegated batches to 4-5 files with a short report format. For one large file (Dashboard was 555 lines), self-chop into stages — one group of Edit calls per stage — instead of one giant edit.
2. **Don't trust agent self-reports for the key list.** Even when a report gets cut off, the file edits usually already landed. Pull the real list from `git diff`, not the agent's summary.
3. **Closeout order, every wave:** append new keys to `lib/labelKeys.ts` (anchor the edit on the literal `] as const;` line — it's unique in the file) → write one new `supabase/migrations/*_labels_seed_*.sql` → seed both `lhq_labels` and `lhq_dev_labels` via Supabase MCP `execute_sql` → `npx tsc --noEmit` must be clean → spot-verify 2-3 pages live → commit → push to `dev` (never `main`).
4. **Live verification uses `claude-in-chrome`, not the in-app Browser pane** — the in-app pane is known to wedge here (dead screenshots, stale state).
5. **Don't migrate computed/data-driven text** — `chartPattern`-derived strings, `classifyFunding()`/`oi1hSignal()` outputs, anything computed in `lib/` and merely rendered here. Only migrate strings literally authored in the component being edited.
6. **`app/offline/page.tsx` shows as git-modified but it's a CRLF-only diff**, no real content change. Leave it out of commits, don't "fix" it — outside scope.
7. **Widened array types defeat the compile-time check.** If a key list is a typed `const` array or feeds a `.map()`, TS will happily accept a typo'd string unless the array is `as const` or explicitly typed `LabelKey`. `tsc --noEmit` after every wave catches this — don't skip it.
