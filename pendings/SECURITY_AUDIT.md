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

- ~~🟡 AI-spend spike alert~~ — **done 2026-07-25**. Owner rejected Telegram
  as the channel; `app/api/ops/spike-alert/route.ts` now emails both of the
  owner's addresses (`lib/email.ts`'s `sendSpikeAlertEmail`, via the existing
  Brevo setup) once today's usage crosses 80% of `AI_GLOBAL_DAILY_MAX`, plus
  a top-of-page banner on `/ops` itself (`SpikeBanner`, same threshold/data
  source as the dashboard's own flag) so the trip is visible in-app too, not
  email-only. `spike_alerted` dedup column unchanged - still fires once per
  day, not once per tick. Scheduler (n8n) still needs pointing at the route -
  not a security gap once wired, just not live yet.
- **Per-user cap on the 3 cached xAI routes' cache-miss path** (dry-powder,
  macro-context, onchain). Fixed-key caching already bounds cost to ~1
  call/TTL, but there's no per-user counter for symmetry/attribution with
  the rest of the metered routes. Not attempted.
- **IP/velocity signup Auth Hook (optional).** A Supabase
  `before-user-created` Auth Hook could reject when >N signups come from one
  IP/day. Turnstile CAPTCHA + the disposable-domain blocklist already cover
  the higher-value cases here, so this is genuinely optional, not a gap.

## Also still open, tracked elsewhere

- LemonSqueezy payment-feature items (`custom_data.user_id` binding,
  webhook idempotency, variant price) — see `pendings/LEMONSQUEEZY.md`.
  Deferred, not exploitable until payments go live.
- i18n translation for vi/pt-BR/tr/es/id — see `pendings/PENDING.md`.
  Unrelated to security, paused deliberately.
