-- Arena's Anti-Chop Filter toggle used to be a localStorage-only setting -
-- Telegram/push EMA signal alerts had no way to see it, so a user with the
-- toggle on could get alerted on a signal their own chart hadn't confirmed
-- (or would never confirm) under the stricter filter. Syncing it server-side
-- lets checkEMASignal() compute both filter modes and deliver the one that
-- actually matches each recipient's own chart.
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_user_settings) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_user_settings).

alter table lhq_user_settings add column if not exists anti_chop_enabled boolean not null default false;
