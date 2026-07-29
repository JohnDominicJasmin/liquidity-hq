# LiquidityHQ - Architecture

Last updated: July 16, 2026. This document describes the system as it exists in the codebase today. If code and this document disagree, the code wins - then fix this document.

LiquidityHQ is a crypto trading intelligence PWA: a Next.js 16 (App Router) application on Render, backed by Supabase (Postgres + Auth), with xAI Grok for AI analysis and Lemon Squeezy for subscription billing. It is a data and analytics tool only - it never executes trades and never holds exchange credentials.

---

## 1. Deployment Topology

Defined in `render.yaml`. Two Render web services, same codebase:

| Service | Branch | `NEXT_PUBLIC_APP_ENV` | Database tables |
|---|---|---|---|
| `liquidity-hq` (production) | `main` | `prod` | `lhq_*` |
| `liquidity-hq-dev` | `dev` | `dev` | `lhq_dev_*` |

Both services share one Supabase project. Isolation comes from the table-name prefix, switched in one place: `lib/tables.ts` exports a `T` registry (`T.trades`, `T.user_subscriptions`, ...) that every query goes through. **Never hardcode a table name - always import `T`.**

Workflow rule: all commits land on `dev` (auto-deploys to the dev service), `main` is release-only.

Secrets (`GROK_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LEMONSQUEEZY_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, VAPID keys) live in the Render dashboard and `.env.local` - server-side only, never `NEXT_PUBLIC_`. The only intentionally public env vars are the Supabase URL + anon key (safe under RLS), the PostHog key, the VAPID public key, and the Lemon Squeezy checkout URL.

---

## 2. Frontend Shell

Everything renders inside one provider tree, mounted from `app/layout.tsx`:

```
app/layout.tsx
└── AppShell (components/AppShell.tsx)          also registers /sw.js + theme
    └── PostHogProvider                          analytics
        └── AuthProvider                         Supabase session + role ('free' | 'pro')
            └── SettingsProvider                 per-user preferences
                └── MarketProvider               ALL live market data (section 3)
                    └── NewsProvider             news feed + classification
                        └── OnboardingProvider
                            └── GrokUsageProvider    per-user AI usage rings
                                ├── NavDrawer / NewsTicker
                                ├── <main> {page} + PlatformFooter </main>
                                ├── GrokChat
                                └── SetupChecklist / PWAInstallPrompt
```

Key consequence: any page can call `useMarket()`, `useAuth()`, `useNews()` etc. without wiring anything up. Pages are thin; the providers are the app.

The service worker (`public/sw.js`) handles offline navigation fallback (`/offline`) and Web Push display/click.

---

## 3. Core Data Streams

There are three distinct transport layers. Know which one you are touching.

### 3.1 Client-side WebSockets (browser, zero server cost)

Owned by `components/MarketProvider.tsx`:

- **Binance spot combined stream** (`wss://stream.binance.com:9443/stream?streams=...`, fallback host without port) - live price ticks for every tracked coin. If the socket drops, a 5-second REST poll takes over until it reconnects.
- **Binance futures liquidation stream** (`wss://fstream.binance.com/ws/!forceOrder@arr`) - feeds the whale trades feed, liquidation feed, and the BTC liquidation heatmap.

`components/KLineProChart.tsx` opens a third, per-chart socket: a Binance kline stream for the selected coin + timeframe (Bybit-only coins fall back to 5s REST polling).

### 3.2 Client-side REST polling (browser)

Also in `MarketProvider`, on `setInterval`: Bybit tickers/klines/long-short ratio (3-15 min), multi-timeframe RSI (15 min), Fear & Greed (24 h), CoinMarketCap dominance (5 min), alt-season score (15 min). Coin list, symbol maps, and per-coin display precision live in `lib/coins.ts` (`COINS`, `BINANCE_SYMS`, `BYBIT_SYMS`, `COIN_DEC`).

### 3.3 Server API routes (`app/api/*`)

Server routes exist for exactly three reasons:

1. **Secret-key proxying** - Grok, CoinGlass, Finnhub, Telegram. The key never reaches the client.
2. **CORS workarounds** - `api/proxy` (CoinGlass, Google Trends, SoSoValue ETF flows), `api/forex/jpy`, `api/econ-calendar`.
3. **Database writes with authority** - webhook, push subscriptions, price alerts.

**Server caching:** `lib/apiCache.ts` provides `cached(key, ttlMs, fetcher)` - a module-level in-memory TTL cache. Every route that fetches shared third-party data goes through it (or through Next's `next: { revalidate }`), so N concurrent visitors produce one upstream call. TTLs are sized to how fast the source actually moves: 5 s (Coinbase price), 20 s (funding), 2 min (SMC snapshot per asset+tf), 5-10 min (macro, on-chain), up to 6 h (token unlock per symbol). Only successful results are cached; a thrown fetcher leaves the cache untouched. Per-user AI calls (behavioral bias, thesis check, strategy research) are intentionally uncached.

**Cron-triggered routes** (`api/telegram/alert`, `api/macro-alert`, `api/signals/track`) are protected by a `CRON_SECRET` header check and fan out alerts to Telegram + Web Push.

---

## 4. Signal Engine

The math lives in pure, framework-free libraries so live UI and backtesting can never diverge:

- **`lib/strategyCore.ts`** - the EMA ribbon strategy, the single source of truth. Two-stage detection: an EMA9/20 cross *arms* a direction; the first candle closing beyond EMA50 (plus optional ATR buffer, ribbon-spread, and EMA50-slope gates) *confirms* it; the close must then *hold* beyond EMA50 for N consecutive candles. Every threshold is per-timeframe: `PERSIST_BY_TF` (hold length) and `SPREAD_MIN_BY_TF` (required EMA9/20 separation, calibrated to each timeframe's real spread distribution). Two presets: `DEFAULT_FILTER_PARAMS` (raw cross, fires immediately, backtested PF 1.13) and `STRICT_FILTER_PARAMS` (the Arena "Anti-Chop Filter" toggle, PF 0.98). Signals strictly alternate long/short. A signal whose hold window hasn't finished printing is emitted with `pending: true` - hollow marker on the chart, excluded from backtests.
- **`lib/useEMAStrategy.ts`** - the React hook wrapping strategyCore for the Arena page: fetches 1000 candles per coin+timeframe (module-level 5-min kline cache), computes the verdict checklist, and re-derives on filter toggles without refetching.
- **`lib/backtestEngine.ts`** - replays strategyCore signals against history. Entries fill only at the candle where the signal became knowable (after the persistence hold) - it cannot peek at future closes.
- Supporting pure-math libraries: `orderFlowCore` (volume profile + bias), `confluence` (composite score), `waveTrend`, `divergence` (RSI divergence), `patterns`, `distribution`, plus `computeSqueezeScore` / `computeCoinHealth` in `marketStore.ts`.

`components/KLineProChart.tsx` renders klinecharts v10 with custom overlays for signal markers (solid = confirmed, hollow = pending), RSI-divergence warnings, S/R levels, and draggable alert lines. It must receive `pricePrecision: COIN_DEC[coin]` in `setSymbol` - without it, sub-cent coins (PEPE, BONK) render as a flat line.

---

## 5. Monetization: the Entitlements System

One role, one source of truth: `lhq_user_subscriptions.role` is `'free' | 'pro'`. The string is `'pro'` everywhere - schema, webhook, server routes, client context. "Premium" is marketing language only; never introduce it as a code value.

### 5.1 Role lifecycle

1. User pays through Lemon Squeezy (checkout URL built by `lib/checkout.ts`, pre-filled with `user_id` in `checkout[custom]`).
2. Lemon Squeezy calls `app/api/lemonsqueezy/webhook/route.ts`. The handler verifies the `X-Signature` header with HMAC-SHA256 + `crypto.timingSafeEqual` against `LEMONSQUEEZY_WEBHOOK_SECRET`, then upserts the row: `subscription_created/updated/payment_success` with status `active` sets `role: 'pro'`; `cancelled/expired` sets `role: 'free'`.
3. The table has RLS: users can `SELECT` their own row only; nothing client-side can write it. Only the webhook (service-role client) writes.

### 5.2 Server-side gating - `lib/entitlements.ts`

The exact logic:

```ts
export async function getUserRole(token: string, userId: string): Promise<'free' | 'pro'> {
  const { data } = await sb(token).from(T.user_subscriptions)
    .select('role').eq('user_id', userId).maybeSingle();
  return data?.role === 'pro' ? 'pro' : 'free';
}
```

Three properties matter:

1. **User-scoped client, not service role.** `sb(token)` builds a Supabase client carrying the caller's own bearer token, so the RLS policy (`auth.uid() = user_id`) guarantees a token can only ever read its own role. No privilege escalation surface.
2. **Fail closed.** Any missing row, invalid token, or query error resolves to `'free'`, never to `'pro'`.
3. **One implementation.** It was extracted from three identical copies; `api/grok`, `api/grok-chat`, and `api/briefing` import it for tiered rate limits, and `api/onchain` + `api/macro-context` import it for hard gates.

Hard-gate pattern (the paid Grok call is unreachable without a valid Pro session, regardless of anything the client does):

```ts
const token = req.headers.get('Authorization')?.replace('Bearer ', '');
if (!token) return 401;
const { data: authData } = await sb(token).auth.getUser();   // validates the JWT
if (!authData.user) return 401;
const role = await getUserRole(token, authData.user.id);
if (role !== 'pro') return 403 { error: 'PRO_REQUIRED' };
```

### 5.3 Client-side gating - Arena timeframe clamp

Client state: `AuthProvider` fetches the role once per session and exposes `useAuth().isPro` plus `loading`. Client gates are UX, not security - the only endpoints with money attached are also gated server-side (5.2).

In `app/arena/page.tsx`:

```ts
const GATED_TFS: readonly ChartTf[] = ['1m', '5m', '15m'];
const FREE_FALLBACK_TF: ChartTf = '1h';
```

Two mechanisms cover every path onto a fast timeframe:

1. **Interception.** The chart toolbar's timeframe buttons call `onTfChange`, which Arena points at `handleTfChange`: if the user is free and the target is gated, open `UpgradeGateModal` (with the timeframe named in the headline) and *do not switch* - `readTf` stays where it was.
2. **The clamp.** A user can land on a gated timeframe without clicking: a `?tf=5m` URL parameter, a saved default in Settings, or a session that was Pro when the timeframe was chosen. An effect handles all of those:

```ts
useEffect(() => {
  if (authLoading || isPro) return;              // wait for the role; never clamp Pro
  if (GATED_TFS.includes(readTf)) setReadTf(FREE_FALLBACK_TF);   // bump to 1h
}, [authLoading, isPro, readTf]);
```

The `authLoading` guard is the important subtlety: role resolution is async, and `isPro` is `false` while it loads - clamping immediately would flash-downgrade a Pro user. Waiting until `loading` is false means Pro users never see the clamp and free users get bumped exactly once.

Because chart rendering (`KLineProChart`) and signal detection (`useEMAStrategy`) both consume the same `readTf` state, and Arena is the only consumer of either, this one clamp gates both the chart and the signals.

Other client gates, same pattern: `AbsorptionDetector` is simply not mounted for free users (it is a headless AI-context collector; its absence degrades gracefully to `'None'`), `ConfluenceScore` is replaced in place by `LockedFeatureCard` (exported from `components/UpgradeGateModal.tsx`) so the layout holds, and `/backtest` early-returns a full-page Pro panel after `authLoading` resolves.

---

## 6. Persistence (Supabase)

All tables accessed through the `T` registry (`lib/tables.ts`). Migrations in `supabase/migrations/`, run through the Supabase SQL editor. Highlights:

| Table | Purpose | Writes |
|---|---|---|
| `user_subscriptions` | role: free/pro + Lemon Squeezy state | webhook only (service role) |
| `user_settings` | preferences, Telegram chat id, defaults | user (RLS-owned) |
| `grok_usage` | per-user daily AI call counts (tier limits) | API routes |
| `trades` | trade journal (feeds behavioral-bias AI) | user |
| `price_alerts` | user price-cross alerts | user via API |
| `push_subscriptions` | Web Push endpoints per device | user via API |
| `signals` / `live_signals` | fired-signal history (accuracy tracking) | cron routes |
| `hypotheses` / `hypothesis_evidence` | research tracker | user |
| `liq_events` | liquidation history | client stream persistence |

Two Supabase clients exist server-side: user-scoped (`sb(token)`, respects RLS - default choice) and admin (`lib/supabase-admin.ts`, service role - only where authority is genuinely needed: webhook, push dispatch, alert fan-out).

---

## 7. Alerts Pipeline

`app/api/telegram/alert/route.ts` (the largest route, ~1600 lines) runs on a cron: scans all coins for RSI extremes, EMA crosses, rapid moves, whale trades, OI spikes, news, and fear/greed; respects per-group mutes (`muted_alerts`); applies session-aware cooldowns (tighter during NY hours); then broadcasts each signal to every connected Telegram chat id *and*, via `dispatchPush`, to every Web Push subscription (expired 410 endpoints are pruned on send). Alerts are a shared market broadcast, not per-user filtering.

---

## 8. Conventions That Bite If Ignored

- **Next.js 16 is not the Next.js you remember.** Read `node_modules/next/dist/docs/` before using an API you have not touched in this repo (see `AGENTS.md`).
- **Table names:** always `T.xxx`, never a literal - it is what keeps dev and prod data separate.
- **Role string is `'pro'`.** Not `'premium'`, not `'paid'`.
- **New third-party fetch in an API route?** Wrap it in `cached()` unless the response is genuinely per-user.
- **New Pro feature?** Server route: gate with `getUserRole` (fail closed). UI: gate with `isPro` after `authLoading` resolves, and show `LockedFeatureCard` / `UpgradeGateModal` rather than silently hiding things.
- **UI copy:** full words, no abbreviations; prices/percentages in the mono font per the Indigo Depth design system (`docs/DESIGN_SYSTEM.md`).
- **Signal logic changes go in `strategyCore.ts` only** - never fork the math into a component, or live and backtest results silently diverge.
