-- Idempotency marker for the "your trial ends in 2 days" email, same shape and
-- reasoning as welcome_email_sent_at: the reminder job runs daily and would
-- otherwise re-send to the same account every single day of the window, which
-- is the fastest way to get a sender domain marked as spam.
--
-- The route claims it atomically (update ... where trial_reminder_sent_at is
-- null ... returning) so concurrent or overlapping cron runs cannot both send.
--
-- Deliberately nullable with no default: null means "not yet sent", which is
-- exactly the state every existing row should start in.
--
-- Run against BOTH projects - prod lhq_user_subscriptions,
-- dev lhq_dev_user_subscriptions.

alter table lhq_user_subscriptions
  add column if not exists trial_reminder_sent_at timestamptz;
