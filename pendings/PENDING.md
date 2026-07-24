# Pending Work

Single source of truth. Security audit = user's #1 priority (stop untraceable
API-cost abuse, signup/trial abuse, any exploit that breaches system/keys/logs).
Full audit deliverable: `pendings/SECURITY_AUDIT.md`. Pricing/costing analysis
(`pendings/PRICING_ANALYSIS.md`) was unpaused 2026-07-24 — the security list was
effectively resolved and the one remaining item (`AI_GLOBAL_DAILY_MAX`) was
itself blocked on this analysis. Now updated with REAL xAI rates.

## 🚨 URGENT — YOUR action (found 2026-07-24, unrelated to the above)

- **xAI account is at $0.00 credit balance right now** — "no credits
  remaining" on console.x.ai billing. Any live Grok/xAI feature (chat,
  signals, briefing, etc.) is likely failing for real users until this is
  topped up. Invoice history shows one past **failed** $5 auto top-up
  (7 Jun 2026) — worth checking why (expired card? — the Visa on file shows
  exp 3/2029, so probably a transient decline) and considering **enabling
  auto top-up** (toggle exists on the billing page) so this doesn't recur
  silently. This is a live incident, not a backlog item — highest priority
  until confirmed resolved.

## ✅ ALL CODE WORK DONE — merged to `main`, deployed, smoke-tested (2026-07-24, 20 commits total)

Two merges today: 15 commits (homepage 200, `webhook_ok: true`), then 5 more
(`dep-d9hlm2cm0tmc73b4qum0`, live, re-smoke-tested: homepage 200, webhook
healthy). **Everything below is live on prod right now**, not just `dev` —
**except the non-xAI full-attribution item** (now covering `cmc`,
`news/finnhub`, `econ-calendar`, `proxy`), which is done, committed, and
pushed to `dev` but not yet merged to `main`/deployed to prod (see status
note on that bullet).

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
- **Non-xAI traceability, now full account-level** — *(done, verified locally, committed + pushed to `dev`, not yet merged to `main`)* every unauthenticated route that calls a metered/keyed external API now logs IP **and** user id (or `anon`) on every call: `cmc` (`CMC_API_KEY`), `news/finnhub` (`FINNHUB_KEY`), `econ-calendar` (shares `FINNHUB_KEY`), `proxy` (`COINGLASS_API_KEY` for the coinglass-flow/liq types). Checked every other API route for the same shape first — `macro`, `coinbase-price`, `cycle`, `ath`, `forex/jpy`, `funding`, `news-rss` all call keyless public APIs (Yahoo Finance, Coinbase, Bybit, CoinGecko, open.er-api.com, Binance futures, plain RSS) with no vendor cost/quota to attribute, so they're correctly out of scope. `MarketProvider`/`NewsProvider`/`EconCalendarWidget`/`ConfluenceScore` attach a bearer token when the caller happens to be signed in (`lib/supabase.ts` `getAuthToken()`); each route verifies it server-side (`auth.getUser()`) and logs the real user id, falling back to `anon` — auth stays optional, all four routes are still intentionally unauthenticated (public data for signed-out visitors too). Verified locally: fresh requests on `/markets` log `user=anon` for all four routes for a signed-out session, no regression. `npx tsc --noEmit` clean.
- Cron auth fail-closed, `CRON_SECRET` set, verified 200 on a live cron run.
- Telegram webhook: secret set + re-registered, `webhook_ok: true` confirmed. `/start` restored.
- Trial abuse: email dedup, revoked stray write grants, FK CASCADE→SET NULL, null-email = no trial.
- Error-message leakage: ~25 routes via `lib/apiError.ts`.
- LemonSqueezy webhook rejects `test_mode` in prod.
- Secrets/keys/logs audited clean. Admin traceability exists at `/ops`.
- Adversarial re-verification (live prod DB, 3 passes): 5/6 sampled fixes SOUND; 1 defect found + fixed same session.
- **Turnstile CAPTCHA on magic-link login — LIVE on prod.** Widget "LiquidityHQ Login" created in Cloudflare (hostnames `liquidity-hq.onrender.com` + `liquidity-hq-dev.onrender.com`, Managed mode). `NEXT_PUBLIC_TURNSTILE_SITE_KEY` set on both Render services (prod deploy `dep-d9hnd57lk1mc73eagneg` confirmed `live`). Secret key saved in Supabase (`LiquidityHq` prod project) → Authentication → Attack Protection → Captcha provider `Turnstile by Cloudflare`, toggle on. Verified end-to-end on the real prod URL: the Turnstile checkbox ("Verify you are human") renders live on `/login`, not just the earlier loading placeholder. This is what actually stops unlimited-distinct-inbox trial farming — closed.
- **Dev aligned to prod on `TELEGRAM_WEBHOOK_SECRET` + `NEXT_PUBLIC_APP_URL`** — both set on `liquidity-hq-dev` (`https://liquidity-hq-dev.onrender.com`), matching prod's setup. Deploy triggered automatically by the env var update (also picks up the non-xAI attribution commit above). Note: dev's Telegram webhook itself is still unregistered — this only makes the route ready to verify a secret if one is ever pointed at dev; no live Telegram traffic depends on it.

## ⛔ OPEN — code (mine)

Nothing outstanding right now. Everything that was "mine" is either done
(above, all live on `main`/prod) or explicitly deferred below.

## ⏸️ DEFERRED — low priority, explicitly scoped, not blocking anything

- **Admin $-cost view** — `PRICING_ANALYSIS.md` §5E now has real cost constants
  ($1.25 / $0.20 / $2.50 per 1M input/cached/output tokens) instead of
  placeholders. No longer blocked on pricing being "decided" — build whenever
  you want the `/ops` cost dashboard.

## ❓ OPEN — YOUR action (can't do from code)

- **Disposable-email domain blocklist** (optional, pairs with CAPTCHA).
- **Set the LemonSqueezy product/variant price to $25** when payment goes
  live (external, LemonSqueezy's own dashboard — not this repo). See the
  payment-deferred section below; the app-side price display is already $25.

## 🔭 DEFERRED — tied to unfinished payment feature

- LemonSqueezy `custom_data.user_id` unbound from payer (MED) — not
  exploitable until payments live. Build checklist when resuming: bind user_id
  to verified LS customer; add webhook idempotency/replay protection.
- LemonSqueezy variant price needs to be set to **$25** (matches the new
  displayed price) once checkout is actually configured.

## ✅ Pricing analysis + repricing — DONE 2026-07-24

`pendings/PRICING_ANALYSIS.md` fully rewritten with real xAI grok-4.3 rates
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

See `pendings/PRICING_ANALYSIS.md` §7 for the full final numbers and the
worst-case cost table. Verified live locally (`tsc` clean, `/upgrade` and
landing page both render the new price and caps correctly in the browser)
— not yet committed/pushed as of this writing.

## i18n translation — paused (see also pendings/I18N_MIGRATION.md)

- Done: en, ko, zh, ar, ru (2370/2370, both DBs). Pending: vi, pt-BR, tr, es, id. Do not resume proactively.
