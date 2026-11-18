-- NOT YET APPLIED TO ANY DATABASE.
-- Telegram alert controls (owner sweep 2026-11-18): quiet hours, snooze and pause, set on /alerts and by /pause and /resume in the bot, plus the mark that the one "plan ended" message was sent.
--
-- alert_quiet_start / alert_quiet_end   smallint 0-23, whole hours in the user's own timezone (user_settings.timezone); start > end crosses midnight; null = no quiet hours.
-- alert_snooze_until                    timestamptz; no Telegram alert before it; null = not snoozed.
-- alert_paused                          boolean; true after /pause until /resume or Resume on /alerts; null = never set (read as not paused).
-- telegram_lapse_notified_at            timestamptz; when the "plan ended, alerts paused" message was claimed. Server-only (written by the alert cron with the service role), so NOT granted below.
-- All nullable with no default: old rows stay null, which is exactly "not set". ADDITIVE. The check constraints keep the hours whole and in range even for a write that skips /api/settings.
--
-- THE GRANT IS PART OF THIS FILE: 20261021e revoked table-wide insert/update on lhq_user_settings from authenticated and re-granted only an allowlist of columns, so a new column
-- is not writable by the client until it is granted too (the settings PATCH would fail on it). Only the four columns /api/settings writes are granted. Idempotent.
--
-- ORDER: APPLY BEFORE THE DEPLOY THAT USES IT. Without the columns: the settings PATCH that carries them fails (the save toast says so), /status and /pause in the bot answer
-- "could not read / save", the alert cron holds nobody (its read fails and it logs that) and sends no "plan ended" message. Alerts themselves keep going.
--
-- Run ONE block per project (per 20260912b): prod block on prod qdpwhnvmhqgzijuwopso, the commented dev block on dev wdtjhrilakoitfcezxpx (qa and staging use it).
--
-- Roll back: alter table lhq_user_settings drop column alert_quiet_start, drop column alert_quiet_end, drop column alert_snooze_until, drop column alert_paused, drop column telegram_lapse_notified_at;

-- ── prod: qdpwhnvmhqgzijuwopso ──────────────────────────────────────────────
alter table lhq_user_settings add column if not exists alert_quiet_start smallint check (alert_quiet_start between 0 and 23);
alter table lhq_user_settings add column if not exists alert_quiet_end smallint check (alert_quiet_end between 0 and 23);
alter table lhq_user_settings add column if not exists alert_snooze_until timestamptz;
alter table lhq_user_settings add column if not exists alert_paused boolean;
alter table lhq_user_settings add column if not exists telegram_lapse_notified_at timestamptz;
comment on column lhq_user_settings.alert_quiet_start is 'Telegram quiet hours start, whole hour 0-23 in the user timezone; null = none.';
comment on column lhq_user_settings.alert_quiet_end is 'Telegram quiet hours end (not included), whole hour 0-23 in the user timezone; null = none.';
comment on column lhq_user_settings.alert_snooze_until is 'No Telegram alert before this time; null = not snoozed.';
comment on column lhq_user_settings.alert_paused is 'Telegram alerts paused by /pause until /resume; null = never set.';
comment on column lhq_user_settings.telegram_lapse_notified_at is 'When the one plan-ended Telegram message was claimed; server-only.';
grant insert (alert_quiet_start, alert_quiet_end, alert_snooze_until, alert_paused), update (alert_quiet_start, alert_quiet_end, alert_snooze_until, alert_paused) on public.lhq_user_settings to authenticated;

-- ── dev: wdtjhrilakoitfcezxpx (apply separately) ────────────────────────────
-- alter table lhq_dev_user_settings add column if not exists alert_quiet_start smallint check (alert_quiet_start between 0 and 23);
-- alter table lhq_dev_user_settings add column if not exists alert_quiet_end smallint check (alert_quiet_end between 0 and 23);
-- alter table lhq_dev_user_settings add column if not exists alert_snooze_until timestamptz;
-- alter table lhq_dev_user_settings add column if not exists alert_paused boolean;
-- alter table lhq_dev_user_settings add column if not exists telegram_lapse_notified_at timestamptz;
-- comment on column lhq_dev_user_settings.alert_quiet_start is 'Telegram quiet hours start, whole hour 0-23 in the user timezone; null = none.';
-- comment on column lhq_dev_user_settings.alert_quiet_end is 'Telegram quiet hours end (not included), whole hour 0-23 in the user timezone; null = none.';
-- comment on column lhq_dev_user_settings.alert_snooze_until is 'No Telegram alert before this time; null = not snoozed.';
-- comment on column lhq_dev_user_settings.alert_paused is 'Telegram alerts paused by /pause until /resume; null = never set.';
-- comment on column lhq_dev_user_settings.telegram_lapse_notified_at is 'When the one plan-ended Telegram message was claimed; server-only.';
-- grant insert (alert_quiet_start, alert_quiet_end, alert_snooze_until, alert_paused), update (alert_quiet_start, alert_quiet_end, alert_snooze_until, alert_paused) on public.lhq_dev_user_settings to authenticated;
