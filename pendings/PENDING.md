# Pending Work

Single source of truth. The original security audit (stop untraceable
API-cost abuse, signup/trial abuse, any exploit that breaches system/keys/logs)
is **fully resolved** - every finding fixed and live on prod, including the
last optional item (signup IP-velocity Auth Hook, 2026-07-25). The pricing
analysis that decided the $25/mo price point is also fully implemented and
live. Both of those write-ups (`SECURITY_AUDIT.md`, `PRICING_ANALYSIS.md`)
were removed 2026-07-25 since neither had anything pending left in it - see
git history if the original detail is ever needed. Same for `ALERTS.md` (the
alert-cron cost/signal-quality plan) - fully superseded, xAI removed
entirely from every alert type, also removed. LemonSqueezy payment-feature
items (deferred, payments not live yet) are in `pendings/LEMONSQUEEZY.md`.

## ❓ YOUR decision — upgrade Supabase to Pro before real payments launch

Checked live in the dashboard 2026-08-07: **the org is on the Free plan, and
Free does not include project backups at all** - not "7 days," zero. The
Database → Backups page states this directly: "Free Plan does not include
project backups. Upgrade to the Pro Plan for up to 7 days of scheduled
backups." Confirmed via `get_organization`: `"plan":"free"`.

Real cost, read off the actual pricing panel (not estimated): **Pro starts at
$25/month**, usage-based above included quotas (100,000 MAU / 8GB disk / 250GB
egress included). Gets you daily backups retained 7 days, plus 7-day log
retention. Current usage (2 test accounts) is nowhere near the included
quotas, so in practice this would be a flat $25/mo for a long while.

Decision, deliberately deferred: **not urgent with zero real users - nothing
of value would be lost today.** But there is currently no recovery path at all
if a bad migration, a mistaken delete, or a Supabase-side incident hits prod.
Upgrade **before flipping on real payments** (see `pendings/LEMONSQUEEZY.md`),
not after the first paying signup - that is the point where "no backup"
stops being theoretical.

No payment method is on file for the org yet (`Billing` page confirmed
"No payment methods"), so this needs the user directly - can't be actioned
from code.

## ✅ RESOLVED — xAI credit outage (found + fixed 2026-07-24)

xAI account had hit $0.00 credit balance ("no credits remaining"), which would
have broken every live Grok/xAI feature for real users. Topped up **$10**
(new balance ~$9.96, confirmed on console.x.ai billing) and **auto top-up
enabled** ($10 charge when balance falls to $5 or below) so this doesn't
recur silently. Closed.

## ✅ ALL CODE WORK LIVE ON PROD (2026-07-24)

Four merges today, all deployed: 15 commits (homepage 200, `webhook_ok:
true`), then 5 more (`dep-d9hlm2cm0tmc73b4qum0`), then non-xAI attribution +
pricing/cap repricing (`beb2a8d`), then the `/ops` cost view + disposable-email
blocklist (`da737f7`, deploy `dep-d9hofvd7vvec73er9o4g`, **manually deployed
by you and confirmed live** — re-smoke-tested: homepage 200,
`/api/telegram/status` → `{"configured":true}`, `/upgrade` verified in a real
browser showing `$25/mo` and the trimmed 5/3/10/40/18/75/18 caps). Everything
below is live on prod right now, not just `main`.

- **Raw i18n label keys flashing on every full page load** (user-reported via
  screen recording, `/dashboard` + confirmed on `/markets`, `/arena`,
  `/settings` typed directly into the URL bar) — root-caused by `curl`ing the
  SSR HTML directly: raw `KEY_NAME` strings were literally in the
  server-rendered payload on every full page load (client-side `Link` nav was
  already flash-free - a different code path than what was fixed earlier).
  `LabelsProvider` had no SSR-safe default. Fixed by seeding a static English
  label snapshot (`lib/labelDefaults.en.json`) as the initial state - worst
  case is now a brief English flash before the real locale loads, never a raw
  key. Verified 0 raw-key matches on all 4 routes **on prod itself** post-deploy.
  Writeup + regeneration process in `pendings/I18N_MIGRATION.md`.
- AI cost caps on all 9+2 xAI/Grok routes + TOCTOU race closed (atomic `increment_ai_usage`).
- **Global daily xAI circuit breaker — LIVE.** One app-wide counter on top of per-user caps; stops a *fleet* of accounts each staying under their own cap. Built, live-tested (capped at limit, rolled back correctly), on both Supabase projects. `AI_GLOBAL_DAILY_MAX=2000` now set on both Render services (prod + dev) — the breaker is ON.
- token-unlock / smc-snapshot cache-bypass closed.
- macro / telegram detect / bot-info / webhook per-IP rate-limited; telegram/test auth-required.
- **IP-spoof fix** — `getClientIp` read the client-controllable leftmost `X-Forwarded-For` hop; now reads the rightmost (Render-appended, trusted) hop. Every per-IP limit in the app now actually holds.
- **Non-xAI traceability, now full account-level — LIVE on prod.** Every unauthenticated route that calls a metered/keyed external API now logs IP **and** user id (or `anon`) on every call: `cmc` (`CMC_API_KEY`), `news/finnhub` (`FINNHUB_KEY`), `econ-calendar` (shares `FINNHUB_KEY`), `proxy` (`COINGLASS_API_KEY` for the coinglass-flow/liq types). Checked every other API route for the same shape first — `macro`, `coinbase-price`, `cycle`, `ath`, `forex/jpy`, `funding`, `news-rss` all call keyless public APIs (Yahoo Finance, Coinbase, Bybit, CoinGecko, open.er-api.com, Binance futures, plain RSS) with no vendor cost/quota to attribute, so they're correctly out of scope. `MarketProvider`/`NewsProvider`/`EconCalendarWidget`/`ConfluenceScore` attach a bearer token when the caller happens to be signed in (`lib/supabase.ts` `getAuthToken()`); each route verifies it server-side (`auth.getUser()`) and logs the real user id, falling back to `anon` — auth stays optional, all four routes are still intentionally unauthenticated (public data for signed-out visitors too). Verified locally: fresh requests on `/markets` log `user=anon` for all four routes for a signed-out session, no regression. `npx tsc --noEmit` clean.
- Cron auth fail-closed, `CRON_SECRET` set, verified 200 on a live cron run.
- Telegram webhook: secret set + re-registered, `webhook_ok: true` confirmed. `/start` restored.
- Trial abuse: email dedup, revoked stray write grants, FK CASCADE→SET NULL, null-email = no trial.
- Error-message leakage: ~25 routes via `lib/apiError.ts`.
- LemonSqueezy webhook rejects `test_mode` in prod.
- Secrets/keys/logs audited clean. Admin traceability exists at `/ops`.
- Adversarial re-verification (live prod DB, 3 passes): 5/6 sampled fixes SOUND; 1 defect found + fixed same session.
- **Turnstile CAPTCHA on magic-link login — LIVE on prod.** Widget "LiquidityHQ Login" created in Cloudflare (hostnames `liquidity-hq.onrender.com` + `liquidity-hq-dev.onrender.com`, Managed mode). `NEXT_PUBLIC_TURNSTILE_SITE_KEY` set on both Render services (prod deploy `dep-d9hnd57lk1mc73eagneg` confirmed `live`). Secret key saved in Supabase (`LiquidityHq` prod project) → Authentication → Attack Protection → Captcha provider `Turnstile by Cloudflare`, toggle on. Verified end-to-end on the real prod URL: the Turnstile checkbox ("Verify you are human") renders live on `/login`, not just the earlier loading placeholder. This is what actually stops unlimited-distinct-inbox trial farming — closed.
- **Dev aligned to prod on `TELEGRAM_WEBHOOK_SECRET` + `NEXT_PUBLIC_APP_URL`** — both set on `liquidity-hq-dev` (`https://liquidity-hq-dev.onrender.com`), matching prod's setup. Deploy triggered automatically by the env var update (also picks up the non-xAI attribution commit above). Note: dev's Telegram webhook itself is still unregistered — this only makes the route ready to verify a secret if one is ever pointed at dev; no live Telegram traffic depends on it.
- **Admin $-cost view, LIVE on prod** — new `lib/aiCost.ts` (real per-token rates:
  $1.25/$0.20/$2.50 input/cached/output per 1M, plain-call ≈$0.0041,
  search-call ≈$0.0091, matching the pricing analysis - see git history,
  `pendings/PRICING_ANALYSIS.md` was removed 2026-07-25). `/api/ops/ai-cost`
  now returns real $ figures (24h/7d/30d, global + per-user), sorted top-10
  spenders by $ with role + margin (Pro revenue minus cost), and the global
  circuit breaker's today-vs-cap usage with an 80%-threshold spike flag.
  `/api/ops/users/[id]` gets the same per-day $ + 14-day margin. New table
  registry entry `T.global_ai_usage`. 11 new English-only labels (admin-only
  surface, labels API already falls back to English for any other locale —
  see `pendings/PENDING.md`'s i18n-paused note). Verified: `tsc` clean, `/ops`
  loads with no console errors (correctly gated to `/ops/login` signed-out),
  cost formula cross-checked by hand against a real `lhq_dev_grok_usage` row.
  **Not verified end-to-end as a signed-in admin** — that needs your actual
  login, I don't have ops credentials. Prod currently has zero `lhq_grok_usage`
  rows in the last 30 days (real usage hasn't accumulated yet / credits were
  out), so the card will show its empty state until there's real traffic.
- **Disposable-email domain blocklist — LIVE on both DB projects.** New
  `lhq_disposable_email_domains` table (46-domain starter list — mailinator,
  guerrillamail, 10minutemail, yopmail, temp-mail.org, and similar
  well-known throwaway providers; not exhaustive, extend by hand over time).
  `lhq_grant_signup_trial()` now checks the signup email's domain against it
  — a match still gets a free-tier account (same non-destructive pattern as
  the existing dedup logic), just `trial_ends_at = null` instead of a fresh
  14-day trial. Pairs with Turnstile: CAPTCHA stops scripted mass signups,
  this catches a human manually farming trials with real throwaway addresses.
  Verified live via direct SQL (not a real signup): `test@mailinator.com` →
  blocked, `real.person@gmail.com` → not blocked, `YOPMAIL.COM` uppercase →
  still correctly matched. Applied to both `qdpwhnvmhqgzijuwopso` (prod) and
  `wdtjhrilakoitfcezxpx` (dev).

## ⛔ OPEN — code (mine)

### Coinglass v4 migration — DEFERRED until there is revenue (decided 2026-07-30)

**Owner's decision: do not pay for Coinglass until the product has monthly
revenue or paying users.** Revisit then — not before. Nothing here is waiting on
a technical answer, so do not re-raise it as an open question.

`btcExchangeNetFlow` and the Arena BTC liquidation heatmap are both off. The
`/public/v2/` API they used is retired (HTTP 500 for every symbol, even with the
key), and v4 answers `{"code":"401","msg":"Upgrade plan"}` on the current tier.
There is no free Coinglass API tier — $29/mo to $699/mo, and the tier→endpoint
mapping is **not published**, so when this is revisited, confirm with Coinglass
support that a given tier includes `/api/exchange/balance/chart` *before* paying.
See `docs/INFRASTRUCTURE.md` §5 for the full evidence.

The leaked-key note in that section still applies: the current key was exposed
and deliberately not rotated, since nothing uses it. **Rotate it before ever
upgrading**, or the exposed key inherits whatever plan is bought.

Nothing is broken for users: both call sites failed soft, so the value stayed
null and the heatmap card (rendered conditionally on `btcLiqLevels.length`)
simply stopped appearing. No wrong numbers were ever shown.

To restore once a plan covers it — this is a URL + parsing change, not a
rebuild, because every consumer is still wired:
1. Point the two `coinglass-*` branches in `app/api/proxy/route.ts` at
   `https://open-api-v4.coinglass.com`, and send the key as the `CG-API-KEY`
   header (v2 used `coinglassSecret`).
2. Re-add a `fetchCoinglassData` fetcher in `components/MarketProvider.tsx`
   filling `btcExchangeNetFlow` and `btcLiqLevels` (removed there, with the
   reasoning, in the same commit as this note).
3. Adjust response parsing to the v4 shape.

**This also gates per-coin exchange flow — see the next entry.**

### Per-coin exchange flow — BACKLOG, blocked on a data source (2026-07-31)

The second half of the alt money-flow request. The first half shipped: sector
rotation is live in Quick, Deep, Chat and the Confluence Score
(`lib/sectorRotation.ts`), built entirely from data already on hand.

**What it measures:** whether a token is moving ONTO exchanges or OFF them.
Coins arriving at an exchange are generally there to be sold, so rising inflow
is incoming sell pressure; coins leaving to private wallets are accumulation.

**Why per-coin, and why it matters for alts specifically:** the app already had
this for BTC only (`store.btcExchangeNetFlow`, fed into the AI prompts — now
dead with Coinglass). BTC's float is huge and liquid, so exchange flow moves it
slowly. An alt is thin: one whale or an unlocked VC tranche landing on an
exchange can be a meaningful share of circulating supply, and price reacts hard.
Seeing that arrive before it is sold is the actual edge.

**It does NOT overlap with sector rotation** — the two answer different
questions and are meant to be read together:
- Sector rotation: is money moving into alts as a group, or back into BTC?
  Macro, relative. The tide.
- Per-coin exchange flow: is *this token's* supply moving to where it gets sold?
  Coin-specific, supply-side. Whether your particular boat is taking on water.

Rotation can read "capital rotating into alts" — a green light — while the coin
in front of you has a large tranche hitting exchanges. Nothing in the app warns
about that today.

**Options when this is revisited, cheapest first:**
1. Have Grok fetch it via search on demand, the way `/api/onchain` already does
   for MVRV/SOPR/NVT. Costs AI tokens rather than a subscription, but is slower
   and less precise, and cannot be charted.
2. A non-Coinglass provider with per-symbol exchange flow. Not yet researched -
   do that before assuming Coinglass is the only option.
3. Coinglass paid plan (see the entry above), only after their support confirms
   which tier actually includes `/api/exchange/balance/chart`.

Wiring is straightforward once a source exists: `store.btcExchangeNetFlow` is
already threaded into the prompts, so the work is generalising that field
per-coin and adding it to `lib/sectorRotation.ts`'s output — not new plumbing.

### API health tracking on `/ops` — PHASE 1 SHIPPED 2026-07-31

**Live in prod.** `lhq_api_health` + `lhq_record_api_health()`, written by the
ingest crons via `lib/apiHealth.ts`, surfaced by the External API Health card
(`app/ops/_cards.tsx`, `app/api/ops/api-health`).

It paid for itself within two minutes of going live: `rss:CryptoSlate` was
returning **HTTP 403 from Render's IP** while returning 200 with ~10 items from
a home connection. Nobody knew - and it had previously been guessed, wrongly, to
be healthy. That failure is invisible to local testing by construction, which is
the whole argument for measuring from where the code actually runs. Left in
place deliberately (see the comment in `lib/newsFeeds.ts`); it is now visibly
Down rather than silently empty.

**Telegram delivery instrumented 2026-07-31** (`telegram:sendMessage`). This
one turned out to be a bug, not just a gap: `tg()` was a bare `Promise.all`
inside `catch {}` that never inspected the response, so every failure Telegram
reports as a *resolved* non-2xx - bot blocked, chat not found, unparseable HTML
in the body - was indistinguishable from a delivered message. Now checks
`res.ok`, keeps Telegram's own `description` as the reason, and emits one
`[alert] fired=... sent=... failed=...` log line per run (the route previously
had no logging at all). Partial delivery counts as a failure; nothing is
recorded on a run that attempted no sends, so a quiet tick cannot mark the
source healthy. Verified against real traffic: log `sent=1 failed=0` and the
health row `"1 sent"` agree to the second.

**PHASE 2 SHIPPED 2026-07-31.** Live in prod: 32 sources tracked, reading
29 healthy / 2 degraded / 1 down on the card.

Added: `binance:klines`, `bybit:klines` (via `lib/ribbonCandles` - the single
funnel the alert cron and `/api/alerts/preview` share), `binance:funding`,
`bybit:funding`, `yahoo:{oil,dxy,spx,gold,jpy}` per symbol, `cmc:global-metrics`,
`cmc:listings`, `coinbase:BTC-USD`, `er-api:USD`, `google-trends:bitcoin`,
`sosovalue:etf-flows`, `brevo:smtp`, `webpush:vapid`, `xai:grok`.

Two new helpers in `lib/apiHealth.ts`. The crons keep calling `recordApiHealth`
directly (once a minute, one write per source costs nothing); the routes use
`trackHealth`/`reportHealth`, which coalesce per source - a state change writes
immediately, a repeat waits 30s - because those run per page load. The write is
not awaited: Render is a long-lived Node process, so the floating promise
completes without putting a Supabase round trip in front of every response.

**It found two more silently-dead dependencies on the first run, and both
reproduce from Render** (unlike CryptoSlate, which only fails from Render, these
fail everywhere - so it is the dependency, not the IP):
- `google-trends:bitcoin` - "trends explore blocked"
- `sosovalue:etf-flows` - no response from either host
Both fed the Grok prompt context as `googleTrends` / `etfFlows`, so every AI
analysis had been running with those fields blank. **RESOLVED 2026-08-01: both
fields dropped from the prompt entirely** rather than replaced. They were never
worth a new dependency - a fallback string (`'AI will search'`) meant the model
was being told to go look it up anyway, so removing them costs nothing and stops
the prompt claiming context it does not have. Both sources stay in the
suppression list so they do not park red rows on the card. If a real ETF-flow or
search-interest source ever turns up, that is a new feature, not a repair.

Also surfaced: `finnhub:crypto` reporting "no articles (key missing or upstream
down)" while `finnhub:general` returns 100.

**Coinglass deliberately NOT tracked** - known dead by decision with no callers,
so it would park two permanently red rows and train the eye to ignore red. Add
it as part of the v4 migration.

Correction to an earlier note here: Web Push was described as needing special
handling because `dispatchPush` is `void`-ed and "may not finish before the
process is frozen". That was serverless reasoning applied to a persistent Node
process - on Render the floating promise does complete. It still reports from
inside `dispatchPush` rather than from a tally in the handler, but only because
the handler has already returned by then. A 410 counts as an expired
subscription, not a delivery failure.

**ALERTING SHIPPED 2026-07-31** (`lib/healthAlert.ts`). Emails the owner when a
source hits `consecutive_failures >= 3`, and again when it recovers. Rides the
hourly econ-snapshot cron - it needed an hourly schedule and that was the only
hourly cron; its own route plus a new cron-job.org entry is exactly what
`api/ops/spike-alert` did, which was built 2026-07-25, never wired, and is still
dead. **If that cron is ever deleted or repointed, health alerting stops
silently** - the stale calendar would be the visible symptom, the missing alerts
would not be.

Threshold is 3 in a row, matching the card, deliberately not one failure -
Finnhub flaps (~3 in 50 samples as isolated ticks) and would otherwise page
every few hours. Does NOT alert on staleness: most sources are only written when
a user-facing route is hit, so with no overnight traffic they stop reporting,
which is unmonitored rather than broken and must not send email at 4am.

Verified in prod, every branch: down detected and emailed (landed in the inbox,
not spam, from `noreply@liquidity-hq.com`); a repeat run while still down stayed
silent; a suppressed source was dropped from state. Recovery was verified on dev.

Two things learned doing it, both worth keeping:
- The Brevo deliverability worry recorded elsewhere in these docs is **stale**.
  It now sends from a real domain, not a freemail address, and reached Gmail's
  inbox first try. Applies to the welcome and trial-reminder emails too.
- `updated_at` on `lhq_app_config` is NOT maintained by these writes and there
  is no trigger, so it is useless as a "did this run" signal - it sat unchanged
  across two later writes. Compare the value, not the timestamp. The same trap
  already bit `structure_signal_dedup` earlier the same day.

Suppression list lives in `app_config.api_health_alert_suppress` and is seeded
with the three known-dead sources. Edit the array to add or remove - no deploy.

Original rationale, kept because it is the design constraint:

Owner's #1 follow-up after the news push-delivery work. There was no single
place that answered "which of our external APIs is actually working". The gap
was real and this project had already been bitten by it more than once:

- Three `feeds.reuters.com` and two `feeds.apnews.com` RSS feeds sat in the feed
  list silently returning nothing (dead at DNS) — nobody could have known
  without hand-testing each URL.
- `truthsocial.com/@realDonaldTrump.rss` returned **200 OK** while serving an
  HTML app shell with zero `<item>` elements. A naive uptime check would call
  that healthy. Status code alone is not health.
- Global Macro Context failed persistently in the past and only surfaced after
  a user noticed, which is what prompted wiring `apiError()` into GlitchTip.
- `FINNHUB_KEY` being empty produces an empty result, not an error.

What it should cover (every external dependency, not just the noisy ones):
Finnhub, the RSS feed list, Coinglass, CoinMarketCap, xAI/Grok, DeFi Llama,
Yahoo Finance, FRED, ForexFactory, Binance/Bybit, Telegram, Brevo, Supabase.

Design decisions, all now implemented in phase 1 — keep them when extending:
- **Health is semantic, not HTTP status** — "did we get usable rows back", not
  "did it return 200". TruthSocial is the proof, and CryptoSlate's 403 is the
  reason the check has to run from Render rather than a laptop.
- Per-source last-success and last-failure timestamps plus a rolling window.
  `last_ok_at` is deliberately preserved across failures: the widening "last ok
  3d ago" gap is what makes a dead source obvious.
- The ingest crons are the write points — they already touch every feed once a
  minute, so per-source outcomes cost nothing, and a separate prober would
  re-hammer the same endpoints for worse data.
- Read/modify/write of the window and the failure counter lives in SQL, not app
  code: two crons can report the same source in the same minute and would race.
- Staleness outranks the last outcome. A source that last succeeded but stopped
  being reported is unmonitored, not healthy.
- `recordApiHealth` never throws. Health tracking that can break the job it
  measures is worse than none.
- `docs/feature-inventory.md` has the full dependency list for phase 2.

### "Check now" button on `/alerts` — FIXED and live in prod (2026-07-31)

Was returning **401 on every press** since the cron routes were made fail-closed
(`7cfbb18`): it called `GET /api/telegram/alert` directly, and a browser has no
cron secret. Nobody noticed because a broken button just looks like a failed
check.

Fixed with a separate read-only route, `app/api/alerts/preview` - NOT by
loosening the cron gate, which would re-open an endpoint that can burn AI budget
and message every connected chat on demand. Reads the caller's Supabase JWT,
answers for that user only, Pro-gated, 4/min per user. Sends nothing and mutates
nothing; there is no send path in the file and it does not import the alert
route, so it cannot reach `tg()` or the dedup maps.

The dedup point is the one worth remembering: those maps are what stop an
already-announced signal firing again, so a preview that consumed a slot would
SUPPRESS the real alert that followed and the user would silently never get it.
Any future "preview"/"test" surface must keep that property.

Scope is the EMA rule + market-structure breaks (the two with per-coin/timeframe
settings on that page, both pure functions over candles). The UI carries a scope
line saying so - without it, "No conditions active right now" reads as a claim
about every alert type. Verified in prod with a real Pro session: returns only
the user's own coins and enabled timeframes.

**Watch as usage grows:** each press fans out to (coins x timeframes) kline
fetches - up to ~50 at the page's own caps - and the limiter is the in-memory
one in `lib/rateLimit.ts`, which assumes Render's single long-lived process. Two
things break together if the service is ever scaled to multiple instances: the
per-user limit becomes per-instance, and Binance/Bybit rate-limit exposure rises
with it. Neither matters at one user; both need revisiting before real traffic.

### PEPE/BONK chart: axis too wide on fast timeframes - COSMETIC, logged (2026-08-01)

On 15m the Arena chart's y-axis spans roughly 0.0023-0.0030 while the candles
occupy a much narrower band, so they render squashed into the middle. Correct
scale, no negative ticks - just ~10x more range than the data needs. 1h and
above look right.

Not the same bug as the one fixed today. That one produced a zero-centred axis
with NEGATIVE price ticks and a flat line, and came from feeding klinecharts
per-token values (~2e-8 candle range) it cannot scale. Fixed by keeping the
chart on Bybit's 1000x contract price and labelling it `1000PEPE/USDT`.

Most likely cause of what remains: a long EMA, or an S/R level from the 200-bar
lookback, sitting far from price on a fast timeframe and dragging the range.
Unverified - stated as a starting point, not a diagnosis.

Deliberately stopped here. Cosmetic, affects two coins on the fastest
timeframes, and today already produced two wrong hypotheses from me on this
exact chart (blamed the analysis overlay, then pricePrecision - the precision
attempt is recorded in lib/coins.ts so it is not repeated).

### The 1000x fix flushed out four separate bugs - worth remembering the shape

One root cause (Bybit quoting PEPE/BONK per 1000 tokens, normalised in two
places and missed in four) surfaced three more the moment it was fixed, because
correct-but-tiny numbers finally reached code that had never seen them:

1. `lhq_alert_fires` compared raw against 1000x prices - 22 rows at +-100,000%,
   dragging the Track Record average to -126.70% against a +0.27% median.
2. EMA and structure alerts quoted PEPE entry/SL/TP at 1000x the ticker.
3. Three price formatters floored too shallow: the structure card printed `$0`,
   the alert body would have printed `$0.0000`, the S/R chip printed `$0.00003`
   for a level at 0.0000271.
4. The chart could not render the true per-token scale at all.

The lesson worth keeping: fixing a magnitude bug does not end at the fix. Every
consumer downstream had been silently calibrated to the wrong magnitude, and
each one has to be re-checked against the corrected value. Grep for the symbol
prefix, then check every formatter and every stored price on the path.

### Confluence Score is unvalidated - agreement now recorded, needs time (2026-08-01)

`agree_count` / `agree_net` were added to `lhq_alert_fires` and are writing
correctly in prod (verified on the first tick after deploy). They record how
many DISTINCT rule keys fired for a coin in the same scan and how they split on
direction. Analysis query is in migration `20260801a`.

**Do not read it yet.** Every row so far is `agree_count: 1` - a solo fire has
no agreement to measure - and the interesting slice (`>= 2`, especially `>= 3`)
accumulates slowly. Needs a few weeks plus 24h resolution on top. A small sample
will happily show a fake edge.

This does NOT persist the Arena Confluence Score, and cannot: its Order Flow
factor (weight 25) is built from OI trend, CVD divergence, taker buy ratio, POC
and VWAP, all of which reach the browser over its own market feed and none of
which the cron holds. See the migration comment.

### What the outcome data said, and its limits (2026-08-01)

First real measurement across 6,201 resolved fires, after the PEPE/BONK unit
corruption was cleaned out:

| rule | n | win rate | avg 24h |
|---|---|---|---|
| ema_signal_1d | 51 | 80.4% | +13.36% |
| ema_signal_4h | 299 | 59.2% | +2.45% |
| ema_signal_1h | 677 | 61.3% | +1.27% |
| ema_signal_30m | 1218 | 60.5% | +1.11% |
| **rsi** | 592 | **52.7%** | **+0.31%** |
| ema_signal_5m | 782 | 51.5% | +0.11% |
| ema_signal_1m | 1983 | 49.6% | -0.01% |
| whales | 216 | 48.1% | **-0.39%** |

This is what justified removing the RSI double-count - momentum was carrying ~45
of ~95 directional weight while winning barely more than a coin flip.

**Three caveats that must travel with these numbers:**
- 24h horizon biases toward slow signals. A 1m alert is not meant to be held a
  day, so the timeframe ranking is partly measurement artifact. RSI vs EMA-1h is
  a fair comparison though - same horizon.
- **12 days, one market regime** (Jul 19-31), no out-of-sample check.
  `ema_signal_1d` at n=51 is as likely a trending fortnight as an edge.
- `ema_signal_1m` is the largest sample and has no edge at 24h; `whales` is
  negative. Neither has been acted on.

## ❓ OPEN — YOUR action (can't do from code)

Nothing blocking. `dev` and `main` hold identical content, `main` on `e23cf33`;
all 2026-07-31/08-01 work is shipped and verified. Prod's running build is
`4e713d0` - the one commit since is docs-only, so no deploy was triggered.

## 🔭 DEFERRED — tied to unfinished payment feature

Moved to `pendings/LEMONSQUEEZY.md` (LemonSqueezy variant price, the
`custom_data.user_id` binding gap, webhook idempotency) — not urgent, payments
aren't live yet.

## ✅ Pricing analysis + repricing — DONE 2026-07-24

The pricing analysis doc (removed 2026-07-25, fully resolved - see git
history for the original write-up) was rewritten with real xAI grok-4.3 rates
(console.x.ai/models, cross-validated against this account's actual invoice)
— the old output rate assumption was **6× too high** ($15/M assumed vs
$2.50/M real). That correction, plus a real-competitor-pricing check
($16-$50/mo is normal for this market), led to a final decision — **all
implemented and verified live**, not just analyzed:

- `AI_GLOBAL_DAILY_MAX = 2,000` — set on both Render services.
- **Pro price $15 → $25/mo** — updated everywhere: `/upgrade`, landing page
  (4 locales), DB-backed checkout CTA label (5 locales, both Supabase
  projects), `lib/labelDefaults.en.json` regenerated.
- **Pro caps trimmed** in `lib/limits.ts`: quick 50→40, deep 25→18, chat
  100→75, search 25→18, briefing 10→8, one-shot tools 25→18 each.
- **Free caps trimmed**: quick 7→5, deep 5→3, chat 15→10, search 5→3,
  briefing 3→2, tools 5→3 each. Landing-page hand-typed copy (4 locales)
  updated to match.
- Result: a fully cap-maxing Pro account now costs an estimated **~$42/mo**
  against $25 revenue (1.67× underwater — down from the original 19×).
  Free worst-case dropped to **~$6.54/mo** for $0 revenue (was ~$54).

**Live on prod** — verified in a real browser against
`liquidity-hq.onrender.com/upgrade`: `$25/mo` and the trimmed caps both render
correctly.

## ✅ Second repricing — worst case now PROFITABLE (2026-07-27, on `dev`)

Recomputing straight from `lib/limits.ts` + `lib/aiCost.ts` gave a worse
number than the ~$42 above: **~$52.01/mo** worst case (303 plain calls/day ×
$0.0041 + 54 search calls/day × $0.0091), i.e. **2.08× underwater** at $25
revenue. Fixed by attacking where the ceiling actually sat.

Diagnosis: **43% of the worst-case bill was the 11 one-shot tools**, whose
independent 18/day caps multiply out to a 198-call/day ceiling — for tools
nobody runs 18 times a day. Trimming each per-tool number would have made
every tool feel stingy for no structural gain, so they were **pooled**
instead.

- **Shared tool pool**: `AI_LIMITS.pro.toolPool = 25`/day across all 11
  one-shot tools; free stays per-tool (`toolPool: null`) so a free user can
  still sample every tool. A Pro user who only runs SMC snapshots now gets
  **25/day, up from 18**, while the ceiling drops — more generous per tool
  AND cheaper.
- `increment_ai_usage()` gained `p_pool_limit` + a `tool_pool_count` column,
  checked/incremented atomically alongside the per-tool counter. New `-2`
  sentinel = pool exhausted, distinct from `null` (per-tool) and `-1`
  (global breaker), so the 429 names the cap that actually blocked.
- Other caps trimmed: Pro quick 40→30, deep 18→10, chat 75→50, search
  18→10, briefing 8→4. Free chat 10→5, free tools 3→2.
- **New worst case: ~$22.62/mo vs $25 revenue — profitable.** Realistic
  usage (10-30% of caps) lands at 70-90% margin. Free worst case
  $8.24 → **$6.12/mo**.
- `/upgrade` now advertises the pool too (new `UPGRADE_PRO_FEATURE_TOOL_POOL`
  label, `{tools}` interpolated from `limits.ts`) — the landing page already
  did, and the two pricing surfaces must not disagree.

**Migrations already applied to BOTH Supabase projects** (`20260727e`,
`20260727f`, `20260727g`) and verified by direct SQL: pool binds across
different tools; a pool-blocked call refunds its tool column without
over-counting the pool; a global-cap block refunds both; a per-tool-cap block
consumes no pool slot. Also smoke-tested over real HTTP against PostgREST with
the exact argument names `lib/aiUsage.ts` sends (returned `1, 2, -2` against a
pool of 2), so the wiring is proven end to end, not just in SQL.

### Pre-ship alignment audit (2026-07-27) — 2 fixes it forced

1. **Tool pool was invisible in the UI.** `tool_pool_count` existed in the DB
   but never reached the client — `GrokUsageInfo` and `/api/grok` both stopped
   at the same 5 fields. Since pooling made the effective tool ceiling much
   tighter (198/day → 25/day), a user spreading ~6 runs over ~5 tools was fine
   before and is blocked now, with a hard 429 as the first warning. Plumbed
   through as `tool_pool_used`/`tool_pool_limit` + a 6th "Tools" ring
   (Pro-only; the component filters out any ring whose limit is 0, which also
   makes a pre-field payload render nothing instead of `NaN`). Modal widened
   400px → 460px so all six fit one row.
2. **`components/GrokChat.tsx` reported the wrong cause.** It discarded the
   server message and hardcoded "No chat messages left today", so a circuit-
   breaker trip told users their personal quota was gone while the meter beside
   it showed quota left. Now uses the server's wording.

Also fixed stale comments the audit surfaced: `app/api/grok-chat/route.ts`
restated the caps in its docblock and had gone stale across **two** repricings
(claimed Free 15 chat + 5 search, Pro 100 + 25); `app/api/ops/ai-cost/route.ts`
said "8 one-shot tools" (there are 11); `lib/aiCost.ts` cited a deleted doc.

**Verified in the real browser signed in as Pro:** usage meter shows 0/30 and
1/10, the usage modal shows all six rings (30 / 9 / 49 / 9 / 4 / 24 remaining)
matching the API payload exactly, no console errors. `/upgrade` and the landing
page verified signed-out in all locales. Swept all 2,436 label keys — zero
hardcoded caps, everything templated.

Code is committed + pushed to `dev` (through `9a5a5e0`) — **not yet merged to
`main`/prod.**

## i18n translation — paused (see also pendings/I18N_MIGRATION.md)

- Done: en, ko, zh, ar, ru (2370/2370, both DBs). Pending: vi, pt-BR, tr, es, id. Do not resume proactively.
