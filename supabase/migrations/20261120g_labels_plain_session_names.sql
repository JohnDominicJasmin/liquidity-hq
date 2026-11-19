-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- Plain session names in the Arena top bar and market read (PM 2026-11-19, #1113: 'God Tier' means nothing to a beginner). 3 keys x 5 locales; en equals the shipped defaults. ko/zh/ru/ar AI-drafted, not native-reviewed.
--   SESSION_NAME_GOD 'God Tier' -> 'Sunday window' (Sun 15:00-19:00 UTC)   SESSION_NAME_PRIME 'Prime' -> 'Evening window' (daily 18:00-21:00 UTC)   SESSION_NAME_DEAD 'Dead Zone' -> 'Quiet hours'
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('SESSION_NAME_GOD','en','Sunday window'),
('SESSION_NAME_GOD','ko','일요일 구간'),
('SESSION_NAME_GOD','zh','周日时段'),
('SESSION_NAME_GOD','ru','Воскресное окно'),
('SESSION_NAME_GOD','ar','نافذة الأحد'),
('SESSION_NAME_PRIME','en','Evening window'),
('SESSION_NAME_PRIME','ko','저녁 구간'),
('SESSION_NAME_PRIME','zh','晚间时段'),
('SESSION_NAME_PRIME','ru','Вечернее окно'),
('SESSION_NAME_PRIME','ar','نافذة المساء'),
('SESSION_NAME_DEAD','en','Quiet hours'),
('SESSION_NAME_DEAD','ko','조용한 시간'),
('SESSION_NAME_DEAD','zh','清淡时段'),
('SESSION_NAME_DEAD','ru','Тихие часы'),
('SESSION_NAME_DEAD','ar','ساعات هادئة')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('SESSION_NAME_GOD','en','Sunday window'),
('SESSION_NAME_GOD','ko','일요일 구간'),
('SESSION_NAME_GOD','zh','周日时段'),
('SESSION_NAME_GOD','ru','Воскресное окно'),
('SESSION_NAME_GOD','ar','نافذة الأحد'),
('SESSION_NAME_PRIME','en','Evening window'),
('SESSION_NAME_PRIME','ko','저녁 구간'),
('SESSION_NAME_PRIME','zh','晚间时段'),
('SESSION_NAME_PRIME','ru','Вечернее окно'),
('SESSION_NAME_PRIME','ar','نافذة المساء'),
('SESSION_NAME_DEAD','en','Quiet hours'),
('SESSION_NAME_DEAD','ko','조용한 시간'),
('SESSION_NAME_DEAD','zh','清淡时段'),
('SESSION_NAME_DEAD','ru','Тихие часы'),
('SESSION_NAME_DEAD','ar','ساعات هادئة')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
