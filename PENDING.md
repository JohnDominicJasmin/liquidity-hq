# Pending Work

Tracked backlog from ongoing security audit + i18n pause. Update as items close.

## Security audit — closed findings (2026-07-24)

1. ~~**Uncapped Grok-cost routes**~~ — DONE. `thesis-check`, `strategy-research`, `hypotheses/[id]/analyze`, `shadow-account`, `behavioral-bias`, `pine-script` capped via `lib/aiUsage.ts`. `282732a` on `dev`.
2. ~~**TOCTOU race on daily AI usage caps**~~ — DONE. All 9 AI routes now use an atomic `increment_ai_usage()` Postgres function instead of read-then-upsert. `3f25d72` on `dev`.
3. ~~**`token-unlock`/`smc-snapshot` cache-key bypass**~~ — DONE. Strict input validation (charset/allowlist) + daily cap on the cache-miss path only, so cache hits stay free. `c1336e4` on `dev`.
4. ~~**Unlimited trial abuse**~~ — DONE. `lhq_grant_signup_trial()` now dedupes by normalized email (Gmail dot/plus-alias, generic +tag) via a permanent claims table — one real inbox, one trial, ever. Verified live on both Supabase projects. Does NOT stop disposable-domain abuse (mailinator etc.) — that needs a Supabase Auth Hook or CAPTCHA, dashboard-level config outside SQL migrations. `c1336e4` on `dev`.
5. ~~**Cron routes unauthenticated in prod**~~ — DONE end to end. `CRON_SECRET` set in Render prod env, all 3 cron-job.org jobs send `x-cron-secret`, verified a live 6:10 PM cron run returned `200 OK` post-deploy. `lib/cronAuth.ts` fail-closed fix also merged `dev` → `main` (`7cfbb18`). Note: Render's `liquidity-hq-prod` has `autoDeploy: off`, so prod is still serving the commit before this merge — functionally fine since that commit's old inline check + the now-set `CRON_SECRET` already enforces correctly; a fresh deploy isn't urgent, just not yet triggered.
6. ~~**Uncapped/unauthenticated non-AI routes**~~ — DONE. `macro`, `telegram/detect`, `telegram/bot-info` now per-IP rate-limited (previously zero limiting at all; `macro` also had `cache:'no-store'` on 5 Yahoo Finance calls per request — switched to a 60s Next fetch cache). `telegram/test`'s silent fallback to the global `TELEGRAM_CHAT_ID` let an anonymous caller spam the owner's real Telegram — auth is now mandatory before any send. `c1336e4` on `dev`.
7. ~~**Admin traceability**~~ — turned out to already exist. `/ops` has per-user AI usage breakdown, ban/unban (via `auth.admin.updateUserById`), grant/revoke Pro, reset AI limits, all audit-logged to `admin_audit_log`. Nothing built, just wasn't known about.

## Security audit — open findings

Not started, ranked by severity:

1. **Verbose error leakage** — ~20 routes return raw `error.message`/`String(e)` to callers, leaks Supabase/PostgREST internals (bounded to authenticated/admin callers only, not public).
2. **LemonSqueezy `custom_data.user_id` trust gap** — client-supplied at checkout, a user could redirect their own paid entitlement onto another account.
3. **Independent adversarial re-audit** — user asked for the fix set above to be re-checked multiple times, not single-pass. In progress.

## i18n translation — paused

Paused 2026-07-24, resuming consumed too much token budget. Do not resume proactively — user will ask.

- Done: en, ko, zh, ar, ru (2370/2370 rows, both prod + dev Supabase).
- Pending: vi, pt-BR, tr, es, id.
