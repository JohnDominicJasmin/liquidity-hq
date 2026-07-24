-- lhq_trades had RLS enabled but the policy was `using (true)` for ALL
-- commands - a leftover from when this was a single-user personal tool
-- (see supabase/schema.sql's original comment). Now that signup is open to
-- anyone, this let any authenticated (even free-tier) user read, edit, or
-- delete every other user's entire trade journal - notes, entry/exit
-- prices, P&L, everything - both directly (the Trade Journal page has no
-- app-level filter either, it relies entirely on RLS) and via
-- app/api/shadow-account and app/api/behavioral-bias, which feed trades
-- into a Grok prompt and quote them back.
--
-- Table had no user_id column at all. Prod had 0 rows (safe, no backfill
-- needed). Dev has 1 test row from before this fix - left with user_id NULL
-- rather than guessed at; a NULL-owner row simply won't match any user's
-- `auth.uid() = user_id` check, so it's just inaccessible until manually
-- reassigned, which is the safe default.
--
-- Run once against BOTH lhq_trades (prod) and lhq_dev_trades (dev).

alter table lhq_trades add column if not exists user_id uuid references auth.users(id) on delete cascade;

drop policy if exists trades_authenticated_all on lhq_trades;
create policy "owner_all_trades" on lhq_trades
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
