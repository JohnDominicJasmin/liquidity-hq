# Pending Work

Single source of truth. Security audit = user's #1 priority (stop untraceable
API-cost abuse, signup/trial abuse, any exploit that breaches system/keys/logs).
Full audit deliverable: `pendings/SECURITY_AUDIT.md`. Pricing/costing analysis
is explicitly **paused** until this list is fully resolved — see
`pendings/PRICING_ANALYSIS.md` (aware of the issue, working it after this).

## ✅ ALL CODE WORK DONE — merged to `main`, deployed, smoke-tested (2026-07-24, 20 commits total)

Two merges today: 15 commits (homepage 200, `webhook_ok: true`), then 5 more
(`dep-d9hlm2cm0tmc73b4qum0`, live, re-smoke-tested: homepage 200, webhook
healthy). **Everything below is live on prod right now**, not just `dev` —
**except the non-xAI full-attribution item** (now covering `cmc`,
`news/finnhub`, `econ-calendar`, `proxy`), which is done and locally verified
but not yet committed (see status note on that bullet).

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
- **Global daily xAI circuit breaker** — one app-wide counter on top of per-user caps; stops a *fleet* of accounts each staying under their own cap. Built, live-tested (capped at limit, rolled back correctly), on both Supabase projects. **OFF until `AI_GLOBAL_DAILY_MAX` is set in Render** (see "your action" below).
- token-unlock / smc-snapshot cache-bypass closed.
- macro / telegram detect / bot-info / webhook per-IP rate-limited; telegram/test auth-required.
- **IP-spoof fix** — `getClientIp` read the client-controllable leftmost `X-Forwarded-For` hop; now reads the rightmost (Render-appended, trusted) hop. Every per-IP limit in the app now actually holds.
- **Non-xAI traceability, now full account-level** — *(done, verified locally, not yet committed/deployed)* every unauthenticated route that calls a metered/keyed external API now logs IP **and** user id (or `anon`) on every call: `cmc` (`CMC_API_KEY`), `news/finnhub` (`FINNHUB_KEY`), `econ-calendar` (shares `FINNHUB_KEY`), `proxy` (`COINGLASS_API_KEY` for the coinglass-flow/liq types). Checked every other API route for the same shape first — `macro`, `coinbase-price`, `cycle`, `ath`, `forex/jpy`, `funding`, `news-rss` all call keyless public APIs (Yahoo Finance, Coinbase, Bybit, CoinGecko, open.er-api.com, Binance futures, plain RSS) with no vendor cost/quota to attribute, so they're correctly out of scope. `MarketProvider`/`NewsProvider`/`EconCalendarWidget`/`ConfluenceScore` attach a bearer token when the caller happens to be signed in (`lib/supabase.ts` `getAuthToken()`); each route verifies it server-side (`auth.getUser()`) and logs the real user id, falling back to `anon` — auth stays optional, all four routes are still intentionally unauthenticated (public data for signed-out visitors too). Verified locally: fresh requests on `/markets` log `user=anon` for all four routes for a signed-out session, no regression. `npx tsc --noEmit` clean.
- Cron auth fail-closed, `CRON_SECRET` set, verified 200 on a live cron run.
- Telegram webhook: secret set + re-registered, `webhook_ok: true` confirmed. `/start` restored.
- Trial abuse: email dedup, revoked stray write grants, FK CASCADE→SET NULL, null-email = no trial.
- Error-message leakage: ~25 routes via `lib/apiError.ts`.
- LemonSqueezy webhook rejects `test_mode` in prod.
- Secrets/keys/logs audited clean. Admin traceability exists at `/ops`.
- Adversarial re-verification (live prod DB, 3 passes): 5/6 sampled fixes SOUND; 1 defect found + fixed same session.
- **Turnstile CAPTCHA on magic-link login** — code side DONE and verified (widget renders only when configured, CSP updated to allow `challenges.cloudflare.com`, button correctly gates on the token, Google OAuth untouched). Tested end-to-end locally with Cloudflare's official always-pass test key. **OFF until you complete the 3-step handoff below** — this is what actually stops unlimited-distinct-inbox trial farming.
- **Dev aligned to prod on `TELEGRAM_WEBHOOK_SECRET` + `NEXT_PUBLIC_APP_URL`** — both set on `liquidity-hq-dev` (`https://liquidity-hq-dev.onrender.com`), matching prod's setup. Deploy triggered automatically by the env var update (also picks up the non-xAI attribution commit above). Note: dev's Telegram webhook itself is still unregistered — this only makes the route ready to verify a secret if one is ever pointed at dev; no live Telegram traffic depends on it.

## ⛔ OPEN — code (mine)

Nothing outstanding right now. Everything that was "mine" is either done
(above, all live on `main`/prod) or explicitly deferred below.

## ⏸️ DEFERRED — low priority, explicitly scoped, not blocking anything

- **Admin $-cost view** — tied to the paused pricing analysis
  (`PRICING_ANALYSIS.md` §5E). Will build once pricing/caps are decided, so the
  cost constants are real rather than placeholders.

## ❓ OPEN — YOUR action (can't do from code)

- **Set `AI_GLOBAL_DAILY_MAX` in Render** (prod, and dev if/when its env vars
  get set) — this is what actually turns the circuit breaker ON. Pick a number
  tied to a daily $ budget you're willing to eat (see PRICING_ANALYSIS.md §5A
  for a worked example).
- **Turnstile CAPTCHA — 3-step handoff** (code is done, waiting on you):
  1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → Turnstile →
     create a widget for your domain. Copy the **Site key** and **Secret key**.
  2. Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key>` in Render (prod, and dev
     if you want it there too) — triggers a redeploy, same as any env var.
  3. Paste the **Secret key** into Supabase Dashboard → Authentication →
     Settings → Bot and Abuse Protection → Enable CAPTCHA protection → provider
     Turnstile → Save. The secret only ever lives in Supabase's config, never
     in this repo or Render.
  Do steps 2 and 3 together/same session — once Supabase's toggle is on, magic
  link requires a valid token, so the widget needs to already be live.
- **Disposable-email domain blocklist** (optional, pairs with CAPTCHA).

## 🔭 DEFERRED — tied to unfinished payment feature

- LemonSqueezy `custom_data.user_id` unbound from payer (MED) — not
  exploitable until payments live. Build checklist when resuming: bind user_id
  to verified LS customer; add webhook idempotency/replay protection.

## Next up (per user, after this list is fully resolved)

- `pendings/PRICING_ANALYSIS.md` — is $15/mo Pro profitable, per-user cost
  model, recommended reprice + cap resize. Paused, not forgotten.

## i18n translation — paused (see also pendings/I18N_MIGRATION.md)

- Done: en, ko, zh, ar, ru (2370/2370, both DBs). Pending: vi, pt-BR, tr, es, id. Do not resume proactively.
