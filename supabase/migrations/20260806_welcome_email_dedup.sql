-- Adds a claim column so app/api/auth/welcome-email/route.ts can send the
-- signup welcome email exactly once per account, via an atomic
-- UPDATE ... WHERE welcome_email_sent_at IS NULL ... RETURNING claim. No new
-- function/trigger/grants needed - lhq_user_subscriptions is already only
-- ever written by the signup trigger or the service-role admin client.
--
-- Run the PROD block in qdpwhnvmhqgzijuwopso, the DEV block (commented) in
-- wdtjhrilakoitfcezxpx.

-- ── PROD ─────────────────────────────────────────────────────────────────
alter table lhq_user_subscriptions
  add column if not exists welcome_email_sent_at timestamptz;

-- ── DEV (lhq_dev_ prefix) - run separately against the dev project ─────────
-- alter table lhq_dev_user_subscriptions
--   add column if not exists welcome_email_sent_at timestamptz;
