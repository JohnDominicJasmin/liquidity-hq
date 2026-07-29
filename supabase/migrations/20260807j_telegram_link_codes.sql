-- One-time codes that prove a Telegram chat belongs to the account claiming it.
--
-- The hole this closes: telegram_chat_id was accepted straight from a client
-- PATCH to /api/settings, with nothing checking the caller owned that chat. So
-- any account could set it to somebody else's chat ID and the alert cron would
-- push their signals to that person's phone every five minutes, with no way for
-- the victim to stop it - they never opted in, so there was nothing to opt out
-- of. Telegram chat IDs are small sequential integers, so guessing valid ones
-- is trivial.
--
-- The fix inverts who supplies the value. The app hands the user a code, the
-- user sends it to the bot from the chat they actually control, and the WEBHOOK
-- writes the chat_id server-side. The client never supplies it at all.
--
-- Single-use and short-lived: `used_at` is claimed atomically by the webhook
-- (update ... where used_at is null ... returning) so a code that leaks after
-- redemption is inert, and `expires_at` bounds the window for one that leaks
-- before.
--
-- Service-role only - the link-code route and the webhook are the only readers
-- and writers, both via getSupabaseAdmin(). RLS on with no policies denies
-- anon/authenticated outright, matching lhq_trial_claims.
--
-- Run against BOTH projects (prod lhq_telegram_link_codes,
-- dev lhq_dev_telegram_link_codes).

create table if not exists lhq_telegram_link_codes (
  code       text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

alter table lhq_telegram_link_codes enable row level security;
revoke all on lhq_telegram_link_codes from anon, authenticated;

-- Supports "invalidate this user's outstanding codes before issuing a new one",
-- so requesting a fresh code cannot leave several live at once.
create index if not exists lhq_telegram_link_codes_user_idx
  on lhq_telegram_link_codes (user_id);
