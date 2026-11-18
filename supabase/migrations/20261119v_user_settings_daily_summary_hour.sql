-- Daily Telegram summary at the user's chosen hour (PM, 2026-11-18): the hour (0-23) in the user's own user_settings.timezone. Null = never chosen = 07:00, so every
-- existing row keeps the old hour. ADDITIVE. Read by the alert cron (lib/dailySummary.ts), written by the /alerts hour picker through the settings PATCH.
--
-- THE GRANT IS PART OF THIS FILE: 20261021e revoked table-wide insert/update on lhq_user_settings from authenticated and re-granted only an allowlist of columns, so a new column
-- is not writable by the client until it is granted too (the settings PATCH would fail on it). Idempotent.
--
-- ORDER: APPLY BEFORE THE DEPLOY THAT USES IT. Without the column the cron's hour read fails and NO daily summary is sent (it never falls back to sending everyone at 07:00),
-- and the hour picker's save fails with the save toast. Reading settings is unaffected (select *).
--
-- Run ONE block per project (per 20260912b): prod block on prod qdpwhnvmhqgzijuwopso, the commented dev block on dev wdtjhrilakoitfcezxpx (qa and staging use it).
--
-- Roll back: alter table lhq_user_settings drop column daily_summary_hour;

-- ── prod: qdpwhnvmhqgzijuwopso ──────────────────────────────────────────────
alter table lhq_user_settings add column if not exists daily_summary_hour smallint check (daily_summary_hour between 0 and 23);
comment on column lhq_user_settings.daily_summary_hour is 'Daily Telegram summary hour (0-23) in the user timezone; null = 07:00.';
grant insert (daily_summary_hour), update (daily_summary_hour) on public.lhq_user_settings to authenticated;

-- ── dev: wdtjhrilakoitfcezxpx (apply separately) ────────────────────────────
-- alter table lhq_dev_user_settings add column if not exists daily_summary_hour smallint check (daily_summary_hour between 0 and 23);
-- comment on column lhq_dev_user_settings.daily_summary_hour is 'Daily Telegram summary hour (0-23) in the user timezone; null = 07:00.';
-- grant insert (daily_summary_hour), update (daily_summary_hour) on public.lhq_dev_user_settings to authenticated;
