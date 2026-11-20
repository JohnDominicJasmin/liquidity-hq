-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy that carries this PR (held for the release after v2026.11.23); DEV on wdtjhrilakoitfcezxpx.
--
-- ko / zh / ru leftovers from QA's re-measure (PM 2026-11-20): the econ-calendar source line (new key, en equals the default and the API string) and the /upgrade Free card 'Not included:' screen-reader text (existing key that had no ko / zh / ru row). AI-drafted, NOT native-reviewed.

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('ECON_CALENDAR_SOURCE_OFFICIAL','en','official schedules: BLS, BEA, Census, Fed'),
('ECON_CALENDAR_SOURCE_OFFICIAL','ko','공식 일정: BLS, BEA, Census, Fed'),
('ECON_CALENDAR_SOURCE_OFFICIAL','zh','官方日程：BLS、BEA、Census、Fed'),
('ECON_CALENDAR_SOURCE_OFFICIAL','ru','официальные расписания: BLS, BEA, Census, Fed'),
('UPGRADE_FREE_NOT_INCLUDED_SR','ko','포함되지 않음:'),
('UPGRADE_FREE_NOT_INCLUDED_SR','zh','不包含：'),
('UPGRADE_FREE_NOT_INCLUDED_SR','ru','Не входит:')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('ECON_CALENDAR_SOURCE_OFFICIAL','en','official schedules: BLS, BEA, Census, Fed'),
('ECON_CALENDAR_SOURCE_OFFICIAL','ko','공식 일정: BLS, BEA, Census, Fed'),
('ECON_CALENDAR_SOURCE_OFFICIAL','zh','官方日程：BLS、BEA、Census、Fed'),
('ECON_CALENDAR_SOURCE_OFFICIAL','ru','официальные расписания: BLS, BEA, Census, Fed'),
('UPGRADE_FREE_NOT_INCLUDED_SR','ko','포함되지 않음:'),
('UPGRADE_FREE_NOT_INCLUDED_SR','zh','不包含：'),
('UPGRADE_FREE_NOT_INCLUDED_SR','ru','Не входит:')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
