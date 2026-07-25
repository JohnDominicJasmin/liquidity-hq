# Security & Cost-Abuse Audit — LiquidityHQ

**Date:** 2026-07-24 **Scope:** third-party API cost exposure, signup/trial
abuse, traceability, general exploit surface.

> ✅ **Every P0/P1 finding from the original audit is fixed and deployed —
> live on prod, verified against the real URL, not just merged.** This doc
> now tracks only what's still genuinely open. Full history of what was
> found and fixed (F1–F12, the 27-route metered-API checklist, the 3-pass
> adversarial verification) lives in git log + `pendings/PENDING.md`'s
> changelog — nothing was silently dropped, it's just not repeated here.

## Still open (all LOW priority — nothing here is urgent)

- ~~🟡 AI-spend spike alert~~ — **fully done 2026-07-25.** Owner rejected
  Telegram as the channel; `app/api/ops/spike-alert/route.ts` now emails both
  of the owner's addresses (`lib/email.ts`'s `sendSpikeAlertEmail`, via the
  existing Brevo setup) once today's usage crosses 80% of `AI_GLOBAL_DAILY_MAX`,
  plus a top-of-page banner on `/ops` itself (`SpikeBanner`, same
  threshold/data source as the dashboard's own flag) so the trip is visible
  in-app too, not email-only. `spike_alerted` dedup column unchanged - still
  fires once per day, not once per tick. **Scheduler confirmed live** - n8n
  workflow "LHQ - AI Spike Alert" (`liquidityhq` folder), hourly Schedule
  Trigger -> HTTP GET `/api/ops/spike-alert`, published, real execution
  history shows hourly runs succeeding (checked live 2026-07-25, e.g.
  13:00/12:00/11:00 all succeeded in under 1s). Nothing left open here.
- ~~Per-user cap on the 3 cached xAI routes' cache-miss path~~ — **done
  2026-07-25.** dry-powder, macro-context, onchain now each go through
  `incrementToolUsage` on the cache-miss path only (same pattern as
  `token_unlock_count`/`smc_snapshot_count`) - a cache hit stays free for
  everyone, only the real xAI call counts against the caller's own daily
  quota. New columns + `increment_ai_usage()` whitelist entries applied live
  on both prod and dev.
- ~~IP/velocity signup Auth Hook~~ — **done 2026-07-25.** Supabase
  `before-user-created` Auth Hook `hook_restrict_signup_velocity` (migration
  `20260725p_signup_ip_velocity_hook.sql`) rejects the 6th+ signup from the
  same IP within 24h with a 429. Enabled live in Supabase Dashboard ->
  Authentication -> Auth Hooks on both prod and dev. Was optional (Turnstile
  + disposable-domain blocklist already covered the higher-value cases) but
  shipped anyway.

## Nothing else open

All P0/P1/P2 findings from the original audit are resolved, including the
one optional item (IP/velocity signup hook).

## Also still open, tracked elsewhere

- LemonSqueezy payment-feature items (`custom_data.user_id` binding,
  webhook idempotency, variant price) — see `pendings/LEMONSQUEEZY.md`.
  Deferred, not exploitable until payments go live.
- i18n translation for vi/pt-BR/tr/es/id — see `pendings/PENDING.md`.
  Unrelated to security, paused deliberately.
