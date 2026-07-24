# Pending Work

Single source of truth for open items. Security audit was the focus 2026-07-24
(user's stated #1 priority: stop untraceable API-cost abuse, signup/trial abuse,
and any exploit that could breach the system, keys, or logs).

## ✅ DONE — security audit (all on `dev`; DB/infra changes already live)

- **AI cost caps** — 9 Grok routes daily-capped; TOCTOU race closed with an atomic Postgres `increment_ai_usage()` fn. `token-unlock` + `smc-snapshot` cache-bypass closed (strict input validation + cap on cache-miss only).
- **Non-AI API abuse** — `macro`, `telegram/detect`, `telegram/bot-info` per-IP rate-limited; `telegram/test` now auth-required (was anon-spammable to owner's Telegram).
- **Cron auth** — `CRON_SECRET` live in Render prod, 3 cron-job.org jobs send `x-cron-secret`, verified a live run returned 200. Fail-closed `lib/cronAuth.ts` merged to `main` (`7cfbb18`).
- **Trial abuse** — email-dedup (`lhq_trial_claims` + normalized email) so one real inbox = one trial ever. Round-2 hardening: revoked stray `anon`/`authenticated` write grants on `lhq_user_subscriptions` + `lhq_trial_claims` (RLS no longer the sole barrier to self-serve Pro); FK `CASCADE`→`SET NULL` (deleting an abuser no longer re-opens their trial); null-email signup grants no trial.
- **Webhook** — LemonSqueezy webhook rejects `test_mode` in prod (no fake-card Pro); signature verified fail-closed.
- **Error-message leakage** — ~25 routes no longer return raw Supabase/upstream error text; all routed through `lib/apiError.ts` (logs real cause server-side, returns generic message). `4116916`.
- **Secrets/keys/logs** — audited clean: no keys in client bundle, service-role key server-only, nothing secret in git, no secrets logged.
- **Admin traceability** — already existed at `/ops`: per-user AI usage, ban/unban, grant/revoke Pro, reset limits, all audit-logged. (User didn't know it was there.)

Adversarial re-verification pass (independent agent, read live prod DB): 5 of 6 sampled fixes SOUND; the 1 defect it found (trial-claims CASCADE) was fixed same session.

## ⛔ OPEN — needs code work (mine)

1. **Rate-limiter IP spoofable** (LOW) — `lib/rateLimit.ts` `getClientIp` trusts the first `X-Forwarded-For` value, which the client controls, so the per-IP limits can be rotated around. On Render the real client IP is a trusted proxy hop; use that instead. Small fix.

## ❓ OPEN — needs YOUR action (can't do from code)

2. **Signup CAPTCHA / throttle** (HIGH residual) — the one gap not fixable in code: unlimited *real distinct* inboxes still get fresh trials (signup is client→Supabase direct, no app choke point). Fix: Supabase Dashboard → Authentication → Settings → enable Bot & Abuse Protection (hCaptcha/Turnstile). This is *the* durable trial-farming fix.
3. **`TELEGRAM_WEBHOOK_SECRET`** — confirm it's set in both Render services. If unset, the inbound Telegram webhook can't authenticate updates. (Code validates it fail-closed; an unset secret means the webhook rejects everything OR accepts unauthenticated, depending on the route — needs a code+env check, see below.)

## 🔭 DEFERRED — tied to the unfinished payment feature

4. **LemonSqueezy `custom_data.user_id` unbound from payer** (MED) — a payer could attach Pro to another account. NOT exploitable until payments go live (nobody can pay yet). Becomes a build checklist item when the payment integration is resumed: bind the granted `user_id` to the verified LemonSqueezy customer/checkout identity, not the client-asserted `custom_data`. Also add webhook idempotency/replay protection at the same time.

## 🌀 In flight (may have finished)

- Two background audit passes were still running at last check — **API-cost completeness sweep** and **auth/IDOR/RLS**. Fold their findings in when they report; nothing from them confirmed as a new hole yet.

## i18n translation — paused (unrelated)

Paused 2026-07-24 (token budget). Do not resume proactively — user will ask.
- Done: en, ko, zh, ar, ru (2370/2370 rows, both DBs). Pending: vi, pt-BR, tr, es, id.
