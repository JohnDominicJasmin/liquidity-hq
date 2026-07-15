# LiquidityHQ — Technical Feature Inventory

Prepared for pricing-tier architecture review. Every feature currently live in the codebase, with the files/routes that implement it and its resource-cost classification.

**Cost legend:**
- 🔴 **Heavy API** — hits a paid or rate-limited third-party API (Grok/xAI, CoinGlass, CMC) per request
- 🟡 **Light API** — hits a free/public exchange REST endpoint, now cached server-side
- 🔵 **DB** — reads/writes Supabase Postgres
- 🟢 **Pure compute** — client-side math only, no network cost beyond the raw price feed
- 🔌 **WebSocket** — persistent client-side stream (runs in the visitor's browser, not server load)

---

## 1. Core Market Data Infrastructure

### Live Ticker & Market Store
Maintains a persistent Binance WebSocket (`wss://stream.binance.com`) for spot price ticks across every tracked coin, plus a Binance futures liquidation stream (`!forceOrder@arr`) for the whale/liquidation feed, both running client-side in `MarketProvider`. A battery of `setInterval` polls fills in what WebSocket doesn't cover: Bybit funding/LSR/volume/klines (3–15 min cadence), Fear & Greed Index (24h), CoinMarketCap global dominance (5 min), and an alt-season score (15 min).
**Files:** `components/MarketProvider.tsx`, `lib/marketStore.ts`
**Cost:** 🔌 WebSocket (per-browser, not server load) + 🟡 Light API (polled REST, unauthenticated)

### Squeeze Score / Coin Health Grade
Composite 0–100 score from funding rate extremity, long/short ratio skew, and OI-vs-price divergence, weighted into independent-source-confirmed long-risk vs short-risk buckets; Coin Health further blends in RSI extremes and volume-vs-MA on top of the squeeze base. Both are pure functions over already-fetched `CoinData` — no additional network calls per computation.
**Files:** `lib/marketStore.ts` (`computeSqueezeScore`, `computeCoinHealth`)
**Cost:** 🟢 Pure compute

---

## 2. AI Arena — Signal Engine (flagship feature)

### EMA Ribbon Strategy + Anti-Chop Filter
Two-stage signal detection: an EMA9/20 cross arms a direction, then the first candle to close beyond EMA50 (with optional ATR-buffer, ribbon-spread, and EMA50-slope gates) confirms it, requiring N consecutive candles to hold before firing — N and the spread threshold are both tuned per timeframe (`PERSIST_BY_TF`, `SPREAD_MIN_BY_TF`), the latter calibrated against measured real EMA9/20 spread distributions per timeframe rather than one flat number. DEFAULT mode fires on raw cross (backtested PF 1.13); STRICT/"Anti-Chop" mode requires the full persistence + spread + slope stack (backtested PF 0.98) and is the opt-in toggle on the Arena chart.
**Files:** `lib/strategyCore.ts`, `lib/useEMAStrategy.ts`, `components/KLineProChart.tsx`
**Cost:** 🟡 Light API (1000-candle kline fetch per coin/timeframe) + 🟢 Pure compute (all signal math)

### WaveTrend (Cipher B) Confirmation
Independent momentum confirmation layer — cross-from-extreme or divergence detection on a WaveTrend oscillator, checked against the EMA ribbon's directional verdict as a secondary agree/disagree signal, not a standalone trigger.
**Files:** `lib/waveTrend.ts`
**Cost:** 🟢 Pure compute

### RSI Divergence (Reversal Warnings)
Detects bullish/bearish RSI divergence (price making a new extreme while RSI doesn't confirm) as a leading, distinct-colored warning marker on the chart — separate from and earlier than the lagging EMA ribbon signal.
**Files:** `lib/divergence.ts`
**Cost:** 🟢 Pure compute

### Market Structure (BOS/CHoCH)
Detects Break of Structure and Change of Character events from swing highs/lows on the 4H timeframe, surfacing the most recent structural flip with price level and time-ago.
**Files:** `components/MarketStructure.tsx`
**Cost:** 🟢 Pure compute

### Absorption Detector
Flags accumulation (buyers absorbing sell pressure — price should fall but holds) or distribution (sellers absorbing buy pressure) on the 15M timeframe, with duration tracking and 1H multi-timeframe confirmation.
**Files:** `components/AbsorptionDetector.tsx`
**Cost:** 🟢 Pure compute

### Order Flow Bias
Scores directional bias from a computed volume profile (point of control, value area) plus zone-based order-flow analysis, feeding into the "Order Flow Setup" confluence factor shown on Arena.
**Files:** `lib/orderFlowCore.ts`
**Cost:** 🟢 Pure compute

### Candle Pattern Detection
Classic reversal/continuation pattern recognition (engulfing, doji, hammer, etc.) run over the recent candle window, reduced to a bullish/bearish/neutral bias.
**Files:** `lib/patterns.ts`
**Cost:** 🟢 Pure compute

### Distribution Score
Scores how strongly current footprint data (volume, price action) suggests large players are exiting into strength — a standalone "smart money selling" signal distinct from the EMA/order-flow signals.
**Files:** `lib/distribution.ts`, `components/DistributionTracker.tsx`, `components/AccumulationTracker.tsx`
**Cost:** 🟢 Pure compute

### Confluence Score
Combines every already-computed directional signal (order flow, multi-timeframe RSI alignment, EMA ribbon, choppiness, RSI divergence, macro risk from JPY carry-trade level + upcoming econ events) into one weighted composite score and verdict banner.
**Files:** `lib/confluence.ts`, `components/ConfluenceScore.tsx`
**Cost:** 🟢 Pure compute

### Choppiness Index
E.W. Dreiss Choppiness Index (0–100) classifying the current regime as trending/transitional/choppy — a diagnostic warning shown alongside signals rather than a filter that silently suppresses them.
**Files:** `lib/strategyCore.ts` (`choppinessIndexArr`, `chopRegimeFor`)
**Cost:** 🟢 Pure compute

---

## 3. Backtest Engine

Simulates every historical signal the EMA strategy would have fired against the loaded candle window, filling entries only at the point the signal becomes honestly knowable (post-persistence-hold, never peeking at future closes), with fixed 2:1 R:R exits and full win/loss/open/net-R stat rollup. Runs identically against both live Arena data and the dedicated `/backtest` page for parameter experimentation.
**Files:** `lib/backtestEngine.ts`, `app/backtest/page.tsx`, `components/BacktestStatsUI.tsx`
**Cost:** 🟡 Light API (candle fetch) + 🟢 Pure compute

---

## 4. Scanners & Screening

### Setup Scanner
Cross-coin scan surfacing which tracked coins currently meet the EMA ribbon / squeeze / confluence entry criteria, refreshed against live `MarketProvider` state.
**Files:** `components/SetupScanner.tsx`, `app/scanner/page.tsx`
**Cost:** 🟢 Pure compute (reuses already-fetched market data)

### Multi-Timeframe Squeeze View
Grid view of squeeze scores across multiple coins and timeframes simultaneously for at-a-glance screening.
**Files:** `components/MultiTFSqueezeView.tsx`
**Cost:** 🟢 Pure compute

### Signal Accuracy Tracker
Historical hit-rate tracking of fired signals against actual outcomes, backed by a persisted signals table.
**Files:** `components/SignalAccuracy.tsx`, `app/api/signal-accuracy/route.ts`
**Cost:** 🔵 DB (`lhq_signals`) + 🟡 Light API (cached, 10 min TTL)

### Coin Heatmap / Drawdown Chart
Visual cross-coin performance/drawdown comparison over the loaded window.
**Files:** `components/CoinHeatmap.tsx`, `components/DrawdownChart.tsx`
**Cost:** 🟢 Pure compute

---

## 5. AI Research Tools (Grok-powered)

All routes below call xAI Grok server-side and are gated behind Supabase auth. All were audited and given server-side response caching this session — previously every visitor triggered a fresh paid Grok call per request.

### On-Chain Score
Grok agentic call using `web_search` + `x_search` tools to find current MVRV/SOPR/NVT/exchange-flow values and produce a weighted 0–100 composite bullish/bearish score with sourcing.
**Files:** `app/api/onchain/route.ts`, `components/OnChainScore.tsx`
**Cost:** 🔴 Heavy API (Grok + live web/X search) — cached 10 min

### Global Macro Context
Fetches DXY, VIX, Gold, WTI Oil, and 10Y Treasury yield from Yahoo Finance, then has Grok classify the composite backdrop as RISK_ON/RISK_OFF/NEUTRAL with crypto-specific implications.
**Files:** `app/api/macro-context/route.ts`, `components/GlobalMacroContext.tsx`
**Cost:** 🔴 Heavy API (5x Yahoo fetch + Grok) — cached 5 min

### Dry Powder (Stablecoin Supply)
Pulls 90-day stablecoin circulating supply from DeFi Llama, computes 30/90-day % change, and has Grok classify expansion/contraction as a liquidity-inflow signal.
**Files:** `app/api/dry-powder/route.ts`, `components/DryPowder.tsx`
**Cost:** 🔴 Heavy API (Grok) — cached 60 min

### Token Unlock / Vesting Risk
User enters a symbol; Grok analyzes known vesting schedules and rates 30/90-day sell-pressure risk from its training data.
**Files:** `app/api/token-unlock/route.ts`
**Cost:** 🔴 Heavy API (Grok) — cached 6h per symbol

### Smart Money Concepts (SMC) Snapshot
User selects an asset + timeframe; fetches 50 recent candles and has Grok identify market structure, fair value gaps, order blocks, and liquidity zones.
**Files:** `app/api/smc-snapshot/route.ts`
**Cost:** 🔴 Heavy API (Grok) — cached 2 min per asset+timeframe

### Behavioral Bias Analysis
Analyzes a user's own closed trade history (disposition effect, overtrading, momentum chasing, anchoring) via Grok — inherently per-user, not cacheable.
**Files:** `app/api/behavioral-bias/route.ts`
**Cost:** 🔴 Heavy API (Grok, per-user, uncached by design) + 🔵 DB (`lhq_trades`)

### Trade Thesis Health Check
User submits a freeform thesis + assumptions for an open position; Grok evaluates each assumption as HOLDS/WEAKENED/INVALIDATED with a 1–10 health score.
**Files:** `app/api/thesis-check/route.ts`
**Cost:** 🔴 Heavy API (Grok, per-user freeform input, uncached by design)

### Strategy Research
User describes a trading strategy in freeform text; Grok analyzes theoretical edge, optimal conditions, key risks, and suggests starting parameters.
**Files:** `app/api/strategy-research/route.ts`
**Cost:** 🔴 Heavy API (Grok, per-user freeform input, uncached by design)

### Hypothesis Tracker
Structured research-hypothesis CRUD with an AI-assisted "analyze" action and evidence log — a persistent research journal, not a one-shot query.
**Files:** `app/api/hypotheses/**`, `components/HypothesisTracker.tsx`
**Cost:** 🔴 Heavy API (analyze action only) + 🔵 DB (`lhq_hypotheses`, `lhq_hypothesis_evidence`)

### Quick / Deep Research (Arena)
The core per-coin AI analysis on the Arena page — full checklist read (200 SMA, ribbon alignment, funding, OI, volume, WaveTrend) sent to Grok for a directional verdict with entry/SL/TP.
**Files:** `app/api/grok/route.ts`, `app/api/grok-chat/route.ts`, `lib/grok.ts`
**Cost:** 🔴 Heavy API (Grok, per-user-triggered, usage-metered via `lhq_grok_usage`)

---

## 6. Alerts & Notifications

### Telegram Alert Engine
Cron-triggered scan (RSI extremes, EMA crosses, rapid moves, whale trades, news, fear/greed, daily summary, OI spikes) broadcast to every connected user's Telegram chat ID — a shared market-signal broadcast, not personalized per-user filtering.
**Files:** `app/api/telegram/alert/route.ts` (1,400+ lines — the largest route in the app), `app/api/telegram/*`
**Cost:** 🟡 Light API (multi-coin scan) + 🔵 DB (recipient list, mute state) + external Telegram Bot API

### Web Push Notifications
Full Web Push stack — VAPID-signed subscription, service worker `push`/`notificationclick` handlers, broadcast dispatch mirroring the same signal queue the Telegram engine builds.
**Files:** `app/api/push/*`, `public/sw.js`, `app/settings/page.tsx`
**Cost:** 🔵 DB (`lhq_push_subscriptions`) + external Web Push protocol (free, no per-message cost)

### Price Alerts
User-defined price-cross alerts, persisted per user, checked against live price feed and fired via Telegram/push.
**Files:** `app/api/price-alerts/route.ts`, `app/alerts/page.tsx`
**Cost:** 🔵 DB (`lhq_price_alerts`)

### Macro Alert (Econ Calendar)
Cron-triggered check for upcoming high-impact econ events, alerting ahead of release.
**Files:** `app/api/macro-alert/route.ts`
**Cost:** 🟡 Light API + 🔵 DB

---

## 7. News & Sentiment

### News Feed + Classification
Aggregates RSS + Finnhub news, classifies each headline by type (war/geo, macro/central-bank, crypto-specific) via keyword rules, and tags affected coins for the market-impact chips shown in the UI.
**Files:** `app/api/news-rss/route.ts` (30s cache), `app/api/news/finnhub/route.ts` (60s–1h cache), `lib/classify.ts`, `components/NewsProvider.tsx`
**Cost:** 🟡 Light API (already cached) + 🟢 Pure compute (classification)

### Fear & Greed Index / Sentiment Extremes
Alternative.me Fear & Greed score polled every 24h, surfaced as an extremes alert banner when at historical tails.
**Files:** `components/SentimentExtremesAlert.tsx`, `lib/marketStore.ts`
**Cost:** 🟡 Light API (24h poll)

---

## 8. Liquidation & Derivatives Data

### Liquidation Heatmap / Feed
Real-time liquidation event stream from Binance futures WebSocket, rendered as both a live feed and a price-level heatmap overlay on the Arena chart.
**Files:** `app/liq/page.tsx`, `components/LiqHeatmap.tsx`, `components/LiqFeed.tsx`
**Cost:** 🔌 WebSocket + 🔵 DB (`lhq_liq_events` for historical persistence)

### GEX Table (Options Gamma Exposure)
Deribit options data for BTC gamma exposure / put-call ratio, informing dealer-hedging-flow context.
**Files:** `components/GexTable.tsx`
**Cost:** 🟡 Light API (Deribit)

### Whale Trades Feed
Large-transaction detection from the live trade/liquidation stream.
**Files:** `components/WhaleTradesFeed.tsx`
**Cost:** 🔌 WebSocket

### Funding Rate Dashboard
Cross-exchange (Binance + Bybit) funding rate comparison across every tracked coin.
**Files:** `app/api/funding/route.ts` (20s cache, was previously `force-dynamic`/uncached), `app/funding/page.tsx`
**Cost:** 🟡 Light API (now cached)

### CoinGlass Proxy (Exchange Flow / Liquidation Levels)
Server-side proxy for CoinGlass exchange net-flow and liquidation-level charts (CORS workaround).
**Files:** `app/api/proxy/route.ts` (type=coinglass-flow / coinglass-liq)
**Cost:** 🔴 Heavy API (CoinGlass, paid key, 5 min cache)

### ETF Flow / Google Trends Proxy
SoSoValue BTC/ETH spot ETF net-flow data and Google Trends 7-day "bitcoin" search score, both server-proxied.
**Files:** `app/api/proxy/route.ts` (type=etf / trends)
**Cost:** 🟡 Light API (etf: 30 min cache; trends: 60 min cache, added this session)

---

## 9. Correlation & Cross-Market Macro

### Correlation Matrix
Cross-coin price correlation over the loaded window, visualized as a matrix.
**Files:** `app/correlation/page.tsx`
**Cost:** 🟢 Pure compute (reuses live market data)

### Macro Strip
Compact cross-asset ticker (DXY, VIX, Gold, Oil, JPY) shown as a persistent context strip.
**Files:** `components/MacroStrip.tsx`
**Cost:** 🟡 Light API

### JPY Carry-Trade Risk Monitor
Tracks USD/JPY level against BOJ-intervention danger zones (158/160) as a standalone macro-risk indicator feeding into the Confluence Score.
**Files:** `app/api/forex/jpy/route.ts` (5 min cache)
**Cost:** 🟡 Light API (cached)

### Economic Calendar
Upcoming high/medium-impact macro events (CPI, FOMC, NFP, etc.) with countdown and historical-impact notes.
**Files:** `app/api/econ-calendar/route.ts`, `app/econ-calendar/page.tsx`, `lib/classify.ts`
**Cost:** 🟡 Light API (multiple upstream sources, cached 1h–24h depending on data type)

---

## 10. Risk & Position Calculators (pure client-side)

Six standalone calculators, all zero-network pure math: Position Sizer, Liquidation Price Calc, PnL Calc, Risk/Reward Calc, Funding Cost Calc, DCA Calc.
**Files:** `app/calc/page.tsx` + `components/{PositionSizer,LiquidationCalc,PnLCalc,RiskRewardCalc,FundingCostCalc,DcaCalc}.tsx`
**Cost:** 🟢 Pure compute — zero backend cost, trivially free to offer at any tier

---

## 11. Trade Journal

Full trade CRUD (entry/exit/SL/notes/setup-type/result) with the resulting closed-trade history feeding both the Signal Accuracy tracker and the Behavioral Bias Grok analysis.
**Files:** `app/journal/page.tsx`, `components/TradeJournal.tsx`
**Cost:** 🔵 DB (`lhq_trades`)

---

## 12. Markets, Prices & Coin Data Tables

Sortable multi-coin tables (price, funding, OI, volume, squeeze score) — `/markets` is the fuller table, `/prices` a lighter list view.
**Files:** `app/markets/page.tsx`, `app/prices/page.tsx`, `lib/coinBadge.ts`
**Cost:** 🟢 Pure compute (reuses live `MarketProvider` state, zero incremental cost)

---

## 13. Session / Timing Tools

### Best Trading Hours
Session-overlap visualization (NY/London/Asia) with countdown to next session open/close, used to time entries around historical liquidity windows.
**Files:** `app/hours/page.tsx`, `lib/session.ts`, `components/SessionCountdown.tsx`, `components/SessionContext.tsx`
**Cost:** 🟢 Pure compute (client clock math, zero network cost)

### Market Cycle Tools
BTC halving-cycle day counter, cycle-position chart, and a volatility-regime classifier.
**Files:** `components/CycleDayCounter.tsx`, `components/CycleChart.tsx`, `components/VolatilityRegime.tsx`, `app/api/cycle/route.ts` (1h cache)
**Cost:** 🟡 Light API (cached) + 🟢 Pure compute

---

## 14. Auth, Billing & Account

### Authentication
Supabase Auth (email/password + session management), gating every AI/DB-backed route via bearer token verification.
**Files:** `components/AuthProvider.tsx`, `lib/supabase.ts`, `lib/supabase-admin.ts`
**Cost:** 🔵 DB (Supabase Auth)

### Subscription Billing (Lemon Squeezy)
Webhook-driven subscription state — HMAC-SHA256 signature verification (`timingSafeEqual`), handles `subscription_created/updated/payment_success/cancelled/expired`, writes `role: 'free' | 'pro'` to the subscriptions table. This is the actual tier-gating mechanism: `role === 'pro'` is checked in `grok`, `grok-chat`, `briefing`, and `AuthProvider`.
**Files:** `app/api/lemonsqueezy/webhook/route.ts`, `supabase/migrations/20260616_user_subscriptions.sql`
**Cost:** 🔵 DB, event-driven (no polling)

### User Settings & Preferences
Per-user dashboard config, coin watchlist, notification preferences, Telegram chat-ID linking.
**Files:** `app/settings/page.tsx`, `app/api/settings/route.ts`, `lib/settings.ts`
**Cost:** 🔵 DB (`lhq_user_settings`)

### Grok Usage Metering
Tracks per-user Grok API call count against tier limits, surfaced as a usage ring in Settings — the existing enforcement point for AI-feature rate limiting per pricing tier.
**Files:** `components/GrokUsageProvider.tsx`, `components/UsageRings.tsx`, `lhq_grok_usage` table
**Cost:** 🔵 DB

---

## 15. PWA / Platform Infrastructure

Offline fallback page, install-to-homescreen manifest, and a service worker handling both cache-first offline navigation and push notification display/click routing.
**Files:** `public/sw.js`, `app/offline/page.tsx`, `components/AppShell.tsx`
**Cost:** 🟢 Pure compute (browser-native, zero backend cost)

---

## Summary for Tier Architecture

| Cost tier | Feature count | Natural gate |
|---|---|---|
| 🔴 Heavy API (Grok/CoinGlass) | 10 features | **Hardest cost driver** — usage-metered already via `lhq_grok_usage`; natural Pro/Premium boundary |
| 🟡 Light API (cached exchange/macro data) | ~12 features | Cheap at any tier post-caching (this session's caching pass eliminated per-visitor fan-out cost here) |
| 🔵 DB-only | ~8 features | Cheap, scales with storage not compute — journal, alerts, hypotheses, settings |
| 🟢 Pure compute | ~15 features | **Zero marginal cost** — calculators, session tools, all EMA/order-flow/pattern math, markets tables. Safe to offer at any tier including free, since cost doesn't scale with usage |
| 🔌 WebSocket | 3 features | Client-side only — no server cost per visitor regardless of tier |

The 10 Grok-backed features are the only ones with real per-use marginal cost after this session's caching pass (five of them were previously uncached and burning a fresh paid call on every single visitor hit — now cached 2 min to 6h depending on how fast the underlying data actually moves). Everything else is either free compute, a cached public API, or a DB read that scales with storage rather than request volume.
