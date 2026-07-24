# Pending Work

Single source of truth. Security audit = user's #1 priority (stop untraceable
API-cost abuse, signup/trial abuse, any exploit that breaches system/keys/logs).
Full audit deliverable: `pendings/SECURITY_AUDIT.md`. Other work-tracking docs
in this folder too (I18N_MIGRATION, OPS_ROADMAP).

## ✅ `dev` MERGED TO `main` AND DEPLOYED — prod is now fully protected

2026-07-24: merged 15 commits `dev`→`main` (2 conflicts in hypotheses routes,
resolved to dev's version — has the ownership checks + apiError). tsc clean,
deploy `dep-d9hktcb7uimc73fes8l0` went **live**. Smoke-tested: homepage 200,
`telegram/bot-info` → `webhook_ok: true`. All fixes below are now live on prod,
not just `dev`.

## ✅ DONE — verified live on prod (code + DB + infra all in sync now)

- AI cost caps on all 9+2 xAI/Grok routes (thesis-check, strategy-research,
  shadow-account, behavioral-bias, pine-script, hypotheses/analyze,
  token-unlock, smc-snapshot, grok, grok-chat, briefing) + TOCTOU race closed
  (atomic `increment_ai_usage`).
- token-unlock / smc-snapshot cache-bypass closed (strict input + cap on cache-miss only).
- macro / telegram detect / bot-info / webhook per-IP rate-limited; telegram/test auth-required.
- Cron auth fail-closed (`lib/cronAuth.ts`), `CRON_SECRET` set — verified 200 on a live cron run.
- Telegram webhook: `TELEGRAM_WEBHOOK_SECRET` + `NEXT_PUBLIC_APP_URL` set, webhook re-registered with secret_token — `webhook_ok: true` confirmed post-deploy. `/start` restored.
- Trial abuse: email dedup (normalized, Gmail dot/+tag folding), revoked stray write grants on subscription tables, FK CASCADE→SET NULL, null-email = no trial.
- Error-message leakage: ~25 routes now via `lib/apiError.ts` (generic client message, real cause logged server-side).
- LemonSqueezy webhook rejects `test_mode` in prod.
- Secrets/keys/logs audited clean. Admin traceability already exists at `/ops` (per-user usage, ban/unban, grant/revoke Pro).
- Adversarial re-verification (live prod DB, 3 passes): 5/6 sampled fixes SOUND; the 1 defect found (trial-claims CASCADE) fixed same session.

## ⛔ OPEN — code (mine, not urgent)

- **Global daily circuit breaker for xAI** — per-user caps exist but nothing stops a *fleet* of farmed accounts each staying under their own cap. Recommended in SECURITY_AUDIT.md §3.2: one global counter row + env threshold, alert on trip. Not built yet.
- Rate-limiter IP-spoof (LOW) — `lib/rateLimit.ts` getClientIp trusts X-Forwarded-For first value; derive from Render's trusted proxy hop instead.
- Add `TELEGRAM_WEBHOOK_SECRET` + `NEXT_PUBLIC_APP_URL` to the **dev** Render service + `.env.example` docs (dev deploy deferred re: hour cap — not urgent, dev isn't the live webhook target).
- Attribute non-xAI metered routes (CMC, Finnhub) to a user instead of IP-only (SECURITY_AUDIT.md §3.4).
- Admin cost view: add $-estimate column + global daily total + spike alert to `/ops` (SECURITY_AUDIT.md §5).

## ❓ OPEN — YOUR action (can't do from code)

- **Enable Supabase Auth CAPTCHA** (Dashboard → Auth → Settings → Bot & Abuse Protection, Turnstile/hCaptcha). The only durable fix for unlimited *distinct real* inbox trial farming.
- **Disposable-email domain blocklist** (optional, pairs with CAPTCHA) — mailinator-style throwaway domains still get a trial today.

## 🔭 DEFERRED — tied to unfinished payment feature

- LemonSqueezy `custom_data.user_id` unbound from payer (MED) — not exploitable until payments live. Build checklist when resuming: bind user_id to verified LS customer; add webhook idempotency/replay protection.

## i18n translation — paused (see also pendings/I18N_MIGRATION.md)

- Done: en, ko, zh, ar, ru (2370/2370, both DBs). Pending: vi, pt-BR, tr, es, id. Do not resume proactively.
