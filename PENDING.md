# Pending Work

Tracked backlog from ongoing security audit + i18n pause. Update as items close.

## Security audit — open findings

1. ~~**Uncapped Grok-cost routes**~~ — DONE. `thesis-check`, `strategy-research`, `hypotheses/[id]/analyze`, `shadow-account`, `behavioral-bias`, `pine-script` now capped via `lib/aiUsage.ts` (free 5/day, pro 25/day each). Committed `282732a` on `dev`, not yet merged to `main`.

2. ~~**TOCTOU race on daily AI usage caps**~~ — DONE. All 9 AI routes (`grok`, `grok-chat`, `briefing` + the 6 one-shot tools) now use an atomic `increment_ai_usage()` Postgres function instead of read-then-upsert. Committed `3f25d72` on `dev`, not yet merged to `main`.

Not started, ranked by severity:

3. **`token-unlock/route.ts` cache-key bypass** — cache keyed off unvalidated input, trivially bypassed to force fresh expensive calls.
4. **Verbose error leakage** — ~20 routes return raw `error.message`/`String(e)` to callers, leaks Supabase/PostgREST internals (bounded to authenticated/admin callers only, not public).
5. **Unlimited trial abuse** — signup has no email verification/dedup, same person can spin up infinite fresh 14-day Pro trials.
6. **LemonSqueezy `custom_data.user_id` trust gap** — client-supplied at checkout, a user could redirect their own paid entitlement onto another account.

## Waiting on user action (code done, blocked on infra)

- **Cron-secret fix** — `lib/cronAuth.ts` written, fail-closed, applied to `telegram/alert`, `macro-alert`, `signals/track`, `telegram/setup-webhook`. Sitting on `dev` only, NOT merged to `main`. Needs, in order:
  1. Generate a `CRON_SECRET` value.
  2. Add `x-cron-secret` header to the 3 live cron-job.org jobs.
  3. Set `CRON_SECRET` in Render prod env.
  4. Then merge to `main` (deploying before steps 1-3 breaks the live cron jobs — they currently send no auth header).

## i18n translation — paused

Paused 2026-07-24, resuming consumed too much token budget. Do not resume proactively — user will ask.

- Done: en, ko, zh, ar, ru (2370/2370 rows, both prod + dev Supabase).
- Pending: vi, pt-BR, tr, es, id.
