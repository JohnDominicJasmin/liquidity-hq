# i18n Migration — Progress & Reference

Read this before resuming i18n work in a new session. It exists so wave numbering, language status, and process rules don't drift or get re-litigated.

## What this is

Every UI string is being moved from hardcoded JSX text to `t('SOME_KEY')`, where the actual text is fetched from the backend. Architecture:

- `lib/labelKeys.ts` — `LABEL_KEYS` union type. **This is the compile-time gate**: `t()` only accepts keys from this array, so a typo'd key is a build error, not a silently blank string. Any new key must be added here.
- `lib/labels.ts` — `Locale` type, `SUPPORTED_LOCALES`, the `useLabels()` hook, `t(key, vars?)` signature. Missing key falls back to the raw key string (never crashes).
- `components/LabelsProvider.tsx` — client provider. Fetches `/api/labels?locale=X` once per locale change, exposes `t()` via context.
- `app/api/labels/route.ts` — public unauthenticated GET. Reads the DB table, merges English as fallback under the requested locale (so an untranslated key still shows English instead of nothing), 60s in-memory cache per locale. **Paginates in batches of 1000** (see the wave-6 bug below) — do not "simplify" this back to a single unranged `.select()`.
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
| 5 | Funding, Correlation, Backtest, Live-tracking, Scanner, Liq | 311 | `d86cc28` |
| 6 | Journal, Research, Econ Calendar, Alerts, Hours, Playbook, News, Briefing | 374 | `81cd158` |
| 7 | WhaleTradesFeed, SignalAccuracy, AccumulationTracker, DistributionTracker, AlertOutcomes, AbsorptionDetector, SetupScanner, HypothesisTracker | 149 | `58cfea8` |
| 8 | MultiTFAlignment, CoinHeatmap, MultiTFSqueezeView, DrawdownChart, CycleChart, GexTable | 95 | `dace675` |

**Current total: 1652 label rows**, identical in both `lhq_labels` (prod) and `lhq_dev_labels` (dev). 59 files fully migrated: 27 pages (about, alerts, arena, backtest, briefing, calc, correlation, dashboard, disclaimer, econ-calendar, funding, hours, journal, liq, live-tracking, login, markets, news, not-found, playbook, prices, privacy, research, scanner, settings, terms, upgrade) + 32 components (AbsorptionDetector, AccumulationTracker, AlertOutcomes, AuthGate, CoinHeatmap, CoinMultiSelect, CycleChart, DcaCalc, DistributionTracker, DrawdownChart, FundingCostCalc, GexTable, HypothesisTracker, LabelsProvider, LanguageSelect, LanguageSync, LiquidationCalc, MultiTFAlignment, MultiTFSqueezeView, NavDrawer, PageHint, PnLCalc, PositionSizer, RiskRewardCalc, SettingsModal, SetupScanner, SignalAccuracy, ThemeChips, UpgradeGateModal, UsageMeter, UsageRings, WhaleTradesFeed). Sparkline/Sparkline24h intentionally skipped — pure SVG renderers, zero hardcoded text.

## ⚠️ Critical bug found in wave 6 (fixed, `2435048`) — read this before touching `/api/labels` again

Crossing 1000 total label rows this wave silently broke every locale response: PostgREST enforces a server-side `db-max-rows` cap (1000 on this project) that clamps the response **regardless of what `.range()` the client requests** — adding `.range(0, 9999)` to the query did *not* fix it, because the cap is enforced server-side, not by the client's requested range. The route was returning exactly 1000 of 1408 rows, silently — no error logged, `200` status, valid JSON, just truncated. Every key past the cutoff rendered as a raw key on every page, including pages from earlier waves that had verified correctly before.

**What made this hard to diagnose:** the response was *byte-for-byte identical* across a full dev-server restart and a `.next` cache wipe, which pointed away from the real cause (a DB-side cap survives both) and wasted real time chasing "stale cache" theories. The tell that finally cracked it: fetch the endpoint directly with `curl` (bypassing every browser-tool abstraction, which can itself silently truncate large text — `get_page_text` hit its own token cap mid-JSON and appended a truncation notice that looked like the real response ending) and count keys in the raw response against the DB row count.

**The fix:** paginate in the route itself — loop `.range(from, from + 999)` in batches of 1000, accumulating until a short page comes back, instead of relying on a single request. See `app/api/labels/route.ts`.

**Diagnostic checklist if raw keys appear again:**
1. Is it *one* page or *every* page (including previously-verified ones)? Every page + previously-good keys now broken → check the row-count cap above, not your latest edit.
2. `curl -s "http://localhost:3000/api/labels?locale=en" | grep -oE '"[A-Z][A-Z0-9_]*":' | wc -l` — compare against `select count(*) from lhq_dev_labels where locale='en'`. Mismatch → the cap (or a regression of the pagination fix) is truncating again.
3. Only *then* consider the fail-open-cache/connectivity explanation below, which is a real but different failure mode.

Wave 5 was the first wave delegated to parallel agents (3 agents, 2 files each, balanced by line count) rather than done solo — the pattern worked: brief each agent with the same architecture doc + the comparison-key warning below, let them edit + self-report a compact key/value list, then close out centrally (append `labelKeys.ts`, one seed file per pair, single combined `tsc` pass, DB row-count reconciliation). Cross-checked one batch's diff line-by-line as a spot check rather than trusting every agent report at face value.

Nine i18n-breaks-logic bugs caught and fixed so far, across two recurring classes — always worth explicitly warning delegated agents about both (the wave-5+ agent prompts now include this warning verbatim, keep doing that):
- **Comparison-key bugs** (label string doing double duty as a comparison target): Arena/Markets (wave 4, `757ab7a` `fb8ea8f`) — `b === 'Beats BTC'`, `h === 'vs BTC'`; funding/page.tsx (wave 5, `d86cc28`) — `frSignal()`'s `crowd` string compared by value for contrarian counts; econ-calendar/page.tsx (wave 6, `81cd158`) — `countdown()` returned the literal `'Released'` string, also compared via `ct === 'Released'`; HypothesisTracker.tsx (wave 7, `58cfea8`) — hardened preventatively before it broke anything: `STATUS_META`/`EV_META` display text was also the comparison key for `h.status === s` / `evType === opt`, split into a `labelKey: LabelKey` field for display versus the untouched enum id for comparisons. All fixed the same way: restructure to a stable id/enum for the comparison, separate `LabelKey` for display.
- **Shadowing bugs** (a local variable/parameter literally named `t` shadowing the new `useLabels()` `t()`): backtest/page.tsx (wave 5) — `.map()` callback params named `t`; briefing/page.tsx and hours/page.tsx (wave 6, `81cd158`) — `const t = setInterval(...)` timer handles; news/page.tsx (wave 6) — `TABS.map(t => ...)` and a `hasBadge(t: Tab)` helper; WhaleTradesFeed.tsx and HypothesisTracker.tsx (wave 7, `58cfea8`) — `.filter/.reduce/.map(t => ...)` over trade/evidence-type objects; MultiTFSqueezeView.tsx (wave 8, `dace675`) — `tfs.filter(t => t.dir === ...)` renamed to `sig`.

Check for both patterns in every remaining file. Where a field only ever feeds a *derived* comparison value (Markets' `topSignal().col`), no restructuring is needed — only the rendered text changes.

**`/api/labels` fail-open cache — seen twice now, budget time for it.** `app/api/labels/route.ts` has a 60s in-memory cache that serves `{}` on any Supabase fetch error. Wave 4 saw a ~90s blip; wave 5 saw a *much* longer sustained outage (multiple minutes, `fetch failed` + 10-40s response times) that made raw keys show everywhere — including Dashboard's wave-3 keys, confirmed working earlier the same session, which is exactly how you tell this apart from a real regression: if a key that was previously verified is now raw too, it's the cache/connectivity, not your edit. DB content + `tsc --noEmit` are the two checks that stay reliable regardless of this — lean on those and don't burn excessive turns re-waiting if the live check won't clear.

## Remaining plan
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
8. **If a paired-file agent batch fails on the output-token cap, split it into solo agents per file, don't just retry the pair.** Wave 6's alerts+hours batch (alerts alone is ~770 lines, dense) failed with zero edits landed. Retrying as two separate single-file agents succeeded cleanly on both — the combined report length was the problem, not the edits themselves.
9. **Relayed agent-notification text can mangle special characters** — `&` came back as `&amp;` in every wave-6 agent report (HTML-entity escaping somewhere in the notification pipeline), while apostrophes, ellipses, and embedded newlines came through correctly. Spot-check a couple of `&`-containing values against `git diff` before trusting a report's exact text, rather than re-reading every line by hand. Same thing recurred in wave 7 (`>` came back as `&gt;` for WhaleTradesFeed's two "$50K" strings) — not a bug in the file, since the value only lives in the seed SQL you write yourself; just write the correct literal character (`>`, `&`) instead of pasting the report's escaped version.
10. **A page can transiently show every key raw (including old, previously-verified ones) right after navigation — that's an async-fetch load race, not a regression.** `LabelsProvider` fetches `/api/labels` client-side after mount; `get_page_text` called immediately after `navigate` can capture the DOM before that fetch resolves, so `t()` is still falling back to the raw key for every label on the page, old and new alike. Seen in wave 7 on `/scanner`. Distinguish from the real bugs below: wait ~2s (or re-run `get_page_text`) before concluding a page is broken — if it renders clean on the second read, it was just the race.
