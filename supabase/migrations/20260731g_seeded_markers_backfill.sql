-- Backfill the "defaults already applied" markers for existing users.
--
-- /alerts used to decide whether a user was brand-new by asking "do they have
-- any coin: rows / any ema_signal_ rows?". Turning a key ON deletes its row
-- (app/api/alert-prefs POST), so a user who switched every coin on has zero
-- coin: rows and is indistinguishable from a new signup - the seed re-ran and
-- silently re-muted all but btc/eth/sol on their next visit. Same for the
-- timeframe picker.
--
-- The page now gates on an explicit marker instead. This backfills that marker
-- for anyone who was already configured, so the fix does not itself trigger one
-- last unwanted re-seed.
--
-- Users are matched on HAVING rows, which is the same imperfect test the old
-- code used - it is the only signal available for historical data. Someone who
-- had genuinely turned every coin on is still re-seeded once, the final time.
-- At the time of writing prod has one user holding 45 coin: rows and 5
-- ema_signal_ rows, so nobody is in that bucket. Verified before running:
--   select count(*) filter (where key like 'coin:%')       as coin_rows,
--          count(*) filter (where key like 'ema_signal_%') as ema_rows
--     from lhq_muted_alerts;
--
-- The `seeded:` prefix cannot collide with a mute key: entryMuteKeys() in the
-- alert cron only ever emits <ruleKey>, coin:<c> and dir:<d>.
--
-- Idempotent - `on conflict do nothing` against the (user_id, key) primary key.

-- ── PROD (qdpwhnvmhqgzijuwopso) ──────────────────────────────────────────────
insert into lhq_muted_alerts (user_id, key)
select distinct user_id, 'seeded:coins' from lhq_muted_alerts where key like 'coin:%'
on conflict (user_id, key) do nothing;

insert into lhq_muted_alerts (user_id, key)
select distinct user_id, 'seeded:ema_signal_tfs' from lhq_muted_alerts where key like 'ema_signal_%'
on conflict (user_id, key) do nothing;

-- ── DEV (wdtjhrilakoitfcezxpx) ───────────────────────────────────────────────
-- insert into lhq_dev_muted_alerts (user_id, key)
-- select distinct user_id, 'seeded:coins' from lhq_dev_muted_alerts where key like 'coin:%'
-- on conflict (user_id, key) do nothing;
--
-- insert into lhq_dev_muted_alerts (user_id, key)
-- select distinct user_id, 'seeded:ema_signal_tfs' from lhq_dev_muted_alerts where key like 'ema_signal_%'
-- on conflict (user_id, key) do nothing;
