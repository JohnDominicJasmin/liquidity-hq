-- #1630 Step 1 (the cancel flow): where a cancellation is recorded, and the membership it belongs to.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- NOT APPLIED. Applying is a write to the shared database: the owner's word each time, and QA's ok on the timing, because any DDL fires a
-- PostgREST schema reload (#1025) and must not land during a test pass.
--
-- NOTHING IN THE SHIPPED CODE NEEDS THIS FILE TO HAVE RUN. The cancel state works without it - it is recorded on the membership's own row
-- in lhq_whop_webhook_events (event 'lhq.membership'), the same no-migration pattern as 'lhq.applied', 'lhq.retry' and
-- 'lhq.pending_claim'. These columns are the NEXT step, not this one, and they buy one thing the marker row cannot:
--
--   NO 48-HOUR GRACE ONCE CANCELLED (PM's ruling, 2026-10-29). lib/paidPeriod.ts already implements it - planKindOfRow reads an
--   OPTIONAL `cancel_at_period_end` off the row and drops PAID_GRACE_MS when it is true - but five readers decide Pro from that row
--   (components/AuthProvider.tsx, lib/entitlements.ts, /api/subscription, the Telegram alert cron, the macro-alert cron) and a flag only
--   some of them can see is worse than one none of them can: the same account would be Pro in the browser and free in the API for two
--   days. So the rule ships DORMANT and consistent - every reader keeps today's behaviour exactly - and turns on in one commit once this
--   migration has been applied.
--
--   THE SEQUENCE MATTERS AND IS NOT NEGOTIABLE: apply this file FIRST, then widen the five selects. Asking PostgREST for a column that
--   does not exist fails the WHOLE read, and those reads are what decides whether someone is Pro. Widening first would take Pro away
--   from every paying customer at once.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ADDITIVE ONLY. Three nullable columns on an existing table; nothing is altered, renamed or dropped, and the running app is unaffected
-- before and after. There is nothing to roll back.
--
--   whop_membership_id    the `mem_...` this account's Pro came from. Lifted from `data.membership.id` on the payment body we already
--                         store (documented as "The membership attached to this payment"). It is the ONLY id a cancellation can be
--                         matched on: membership.updated names the membership, never the payment and never our account, and the email in
--                         it is a Whop profile address that need not be the LiquidityHQ one.
--   cancel_at_period_end  the customer has told Whop to stop renewing. Access is NOT affected while the period runs - that is the whole
--                         promise in Terms §Cancellation - it only removes the late-renewal grace at the end, because a cancelled
--                         membership has no renewal coming to be late.
--   canceled_at           when they cancelled. Display and audit only; no decision reads it. Spelled with one `l`, matching Whop's field.
--
-- Run against BOTH projects, ONE SECTION AT A TIME: the prod block is live below, the dev block is commented out (the 20260930a
-- convention, so running this file against prod can never create a dev object there).

alter table lhq_user_subscriptions
  add column if not exists whop_membership_id   text,
  add column if not exists cancel_at_period_end boolean,
  add column if not exists canceled_at          timestamptz;

-- DEV: the same three columns on the dev twin.
--
-- alter table lhq_dev_user_subscriptions
--   add column if not exists whop_membership_id   text,
--   add column if not exists cancel_at_period_end boolean,
--   add column if not exists canceled_at          timestamptz;
