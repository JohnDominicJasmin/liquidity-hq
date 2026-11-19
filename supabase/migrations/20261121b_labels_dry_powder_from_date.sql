-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- The /research dry-powder text shows the most recent stored text with its date when today's is not written yet (PM 2026-11-19, no failing data). 1 key x 5 locales; en equals the shipped default. ko/zh/ru/ar AI-drafted, not native-reviewed.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('DRY_POWDER_FROM_DATE','en','From {date}'),
('DRY_POWDER_FROM_DATE','ko','{date} 기준'),
('DRY_POWDER_FROM_DATE','zh','截至 {date}'),
('DRY_POWDER_FROM_DATE','ru','От {date}'),
('DRY_POWDER_FROM_DATE','ar','بتاريخ {date}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('DRY_POWDER_FROM_DATE','en','From {date}'),
('DRY_POWDER_FROM_DATE','ko','{date} 기준'),
('DRY_POWDER_FROM_DATE','zh','截至 {date}'),
('DRY_POWDER_FROM_DATE','ru','От {date}'),
('DRY_POWDER_FROM_DATE','ar','بتاريخ {date}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
