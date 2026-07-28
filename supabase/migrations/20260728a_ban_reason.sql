-- Lets an admin record why an account was banned (app/api/ops/users/[id]/route.ts
-- passes it through to the ban notification email too). Lives on
-- lhq_user_subscriptions since that's already the one per-user row the ops
-- routes read/write for role/trial state - no new table needed.
--
-- Run the PROD block in qdpwhnvmhqgzijuwopso, the DEV block (commented) in
-- wdtjhrilakoitfcezxpx.

-- ── PROD ─────────────────────────────────────────────────────────────────
alter table lhq_user_subscriptions
  add column if not exists ban_reason text;

-- ── DEV (lhq_dev_ prefix) - run separately against the dev project ─────────
-- alter table lhq_dev_user_subscriptions
--   add column if not exists ban_reason text;
