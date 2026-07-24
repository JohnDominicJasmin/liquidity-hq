-- One-time carryover: old EMA alert mute prefs -> new ema_signal_<tf> keys.
-- See pendings/ALERTS.md - checkEMASetup (4 timeframes) + checkEMACross are
-- replaced by checkEMASignal, and /alerts's toggle rows for them are gone.
-- ema_cross has no replacement (removed outright, no mapping). The 4
-- checkEMASetup timeframes map 1:1 to their new-TF equivalent:
--   ema_setup (4h) -> ema_signal_4h, ema_setup_1h -> ema_signal_1h,
--   ema_setup_30m -> ema_signal_30m, ema_setup_15m -> ema_signal_15m
--
-- Telegram alerts are prod-only (dev's webhook is unregistered), so this
-- only needs to run against prod (qdpwhnvmhqgzijuwopso).
--
-- Two steps:
-- 1. Direct carryover - a user who had explicitly muted an old key gets the
--    same mute on its new-TF equivalent. (Absence of a row already means
--    "on" under both the old and new system, so nothing to insert there -
--    only explicit mutes need replicating.)
-- 2. Cap enforcement - the new picker caps at ALERT_TF_CAP=3
--    (app/alerts/page.tsx) but the old system had 4 independent
--    default-on toggles. The ONLY way a user's carried-over set can exceed 3
--    is if none of the 4 old keys were muted at all (all 4 "on") - trim the
--    lowest-priority one (15m, the fastest/noisiest) to bring them to
--    exactly 3: 4h, 1h, 30m survive.

insert into lhq_muted_alerts (user_id, key)
select user_id, 'ema_signal_4h' from lhq_muted_alerts where key = 'ema_setup'
union
select user_id, 'ema_signal_1h' from lhq_muted_alerts where key = 'ema_setup_1h'
union
select user_id, 'ema_signal_30m' from lhq_muted_alerts where key = 'ema_setup_30m'
union
select user_id, 'ema_signal_15m' from lhq_muted_alerts where key = 'ema_setup_15m'
on conflict (user_id, key) do nothing;

insert into lhq_muted_alerts (user_id, key)
select c.user_id, 'ema_signal_15m'
from (
  select distinct user_id from lhq_muted_alerts
  union
  select user_id from lhq_user_settings where user_id is not null
) c
where
  not exists (select 1 from lhq_muted_alerts m where m.user_id = c.user_id and m.key = 'ema_setup')
  and not exists (select 1 from lhq_muted_alerts m where m.user_id = c.user_id and m.key = 'ema_setup_1h')
  and not exists (select 1 from lhq_muted_alerts m where m.user_id = c.user_id and m.key = 'ema_setup_30m')
  and not exists (select 1 from lhq_muted_alerts m where m.user_id = c.user_id and m.key = 'ema_setup_15m')
on conflict (user_id, key) do nothing;
