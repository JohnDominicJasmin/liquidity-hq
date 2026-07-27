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

Nothing outstanding right now. Everything that was "mine" is either done
(above, all live on `main`/prod) or explicitly deferred below.

## ❓ OPEN — YOUR action (can't do from code)

Nothing outstanding right now.

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
`20260727f`) and verified by direct SQL: pool binds across different tools; a
pool-blocked call refunds its tool column without over-counting the pool; a
global-cap block refunds both; a per-tool-cap block consumes no pool slot.
Code is committed + pushed to `dev` (`40a5533`) and verified on localhost —
**not yet merged to `main`/prod.**

## i18n translation — paused (see also pendings/I18N_MIGRATION.md)

- Done: en, ko, zh, ar, ru (2370/2370, both DBs). Pending: vi, pt-BR, tr, es, id. Do not resume proactively.
