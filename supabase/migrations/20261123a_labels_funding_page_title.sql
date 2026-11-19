-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- The page is called "Funding" in the top bar and the phone tab, so its heading says the same (PM audit 2026-11-17, #1185). 1 key x 5 locales; en equals the shipped default. ko/zh/ru/ar are the words the nav already uses for the same page (TNAV_FLOW_LABEL); AI-drafted, not native-reviewed.
--   FUNDING_PAGE_TITLE  was 'Funding Rate History'
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('FUNDING_PAGE_TITLE','en','Funding'),
('FUNDING_PAGE_TITLE','ko','펀딩'),
('FUNDING_PAGE_TITLE','zh','资金费率'),
('FUNDING_PAGE_TITLE','ru','Фандинг'),
('FUNDING_PAGE_TITLE','ar','التمويل')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('FUNDING_PAGE_TITLE','en','Funding'),
('FUNDING_PAGE_TITLE','ko','펀딩'),
('FUNDING_PAGE_TITLE','zh','资金费率'),
('FUNDING_PAGE_TITLE','ru','Фандинг'),
('FUNDING_PAGE_TITLE','ar','التمويل')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
