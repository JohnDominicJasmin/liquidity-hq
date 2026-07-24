# Pending Work

Single source of truth. Security audit = user's #1 priority (stop untraceable
API-cost abuse, signup/trial abuse, any exploit that breaches system/keys/logs).
Other work-tracking docs live in this `pendings/` folder too (I18N_MIGRATION,
OPS_ROADMAP).

## ⚠️ BIGGEST OPEN ITEM — security code fixes are on `dev`, NOT on prod yet

All of this session's security code changes are committed to `dev` only. Prod
runs `main`. Current split:
- **DB changes ARE live on prod** (applied directly via SQL): AI-usage cap
  function, trial dedup + grants hardening, RLS.
- **Env secrets ARE set on prod**: `CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET`,
  `NEXT_PUBLIC_APP_URL`.
- **But prod CODE (`main`) does NOT call the new caps/validation.** The DB cap
  function exists, yet the newly-capped routes (thesis-check, strategy-research,
  shadow-account, behavioral-bias, pine-script, hypotheses/analyze, token-unlock,
  smc-snapshot) still run their OLD uncapped versions on prod. Error-leakage fix,
  telegram/test auth, macro/webhook rate-limits, atomic-increment wiring — all
  dev-only.

**Action needed: merge `dev` → `main` and deploy so the fixes actually protect
prod.** Needs user go-ahead (large prod push). Until then prod's abuse surface is
only partially closed (cron auth + DB-level trial dedup + webhook secret).

## ✅ DONE on `dev` (verified; DB/infra already live on prod)

- AI cost caps (9 Grok routes) + TOCTOU race closed (atomic `increment_ai_usage`).
- token-unlock / smc-snapshot cache-bypass closed (strict input + cap on miss).
- macro / telegram detect / bot-info / webhook per-IP rate-limited; telegram/test auth-required.
- Cron auth fail-closed (`lib/cronAuth.ts`) — LIVE on prod (`main`), verified 200.
- Trial abuse: email dedup, revoked stray write grants, FK CASCADE→SET NULL, null-email = no trial — all LIVE on prod DB.
- Error-message leakage: ~25 routes via `lib/apiError.ts` (dev).
- Webhook `test_mode` rejected in prod (dev code; matters once payments live).
- Secrets/keys/logs audited clean. Admin traceability already exists at `/ops`.
- Adversarial re-verification (live prod DB): 5/6 sampled fixes SOUND; 1 defect found + fixed.

## 🔄 IN PROGRESS (right now)

- **Telegram webhook secret** — `TELEGRAM_WEBHOOK_SECRET` set in Render prod; discovered `NEXT_PUBLIC_APP_URL` was UNSET on prod (setup-webhook built a localhost URL → Telegram refused). Now set `NEXT_PUBLIC_APP_URL=https://liquidity-hq.onrender.com` + `setup-webhook ?force=1` fix shipped to `main`; **re-registering the webhook** once the deploy is live. Until then prod `/start` (new-user Telegram onboarding only) 401s; existing users' outbound alerts unaffected.

## ⛔ OPEN — code (mine)

- Rate-limiter IP-spoof (LOW) — `lib/rateLimit.ts` getClientIp trusts X-Forwarded-For.
- Add `TELEGRAM_WEBHOOK_SECRET` + `NEXT_PUBLIC_APP_URL` to the dev Render service + `.env.example` docs (dev deploy deferred re: hour cap).

## ❓ OPEN — YOUR action

- **Enable Supabase Auth CAPTCHA** (Dashboard → Auth → Settings → Bot & Abuse Protection). Only durable fix for unlimited *distinct real* inbox trial farming — not fixable in code.

## 🔭 DEFERRED — tied to unfinished payment feature

- LemonSqueezy `custom_data.user_id` unbound from payer (MED) — not exploitable until payments live. Build checklist when resuming payments: bind user_id to verified LS customer; add webhook idempotency/replay protection.

## 🌀 Audit passes — may still be running

- Background agents: API-cost completeness sweep, auth/IDOR/RLS. Fold in when they report; nothing new confirmed yet.

## i18n translation — paused (see also pendings/I18N_MIGRATION.md)

- Done: en, ko, zh, ar, ru (2370/2370, both DBs). Pending: vi, pt-BR, tr, es, id. Do not resume proactively.
