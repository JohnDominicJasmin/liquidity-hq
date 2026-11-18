-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso after QA measures /markets ru at 390; DEV on wdtjhrilakoitfcezxpx.
--
-- /markets in Russian was 397 px wide at 390: the short Signal text "Новые покупатели" ran 7 px past its column (QA #2269 cell Y1). PM shortened the ru wording of this and the Smart buyers signal on the dev and prod databases on 2026-11-18; this file records those rows so the repository matches (and so prod gets it). ru only: the English default is unchanged. AI-drafted, not native-reviewed.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('MARKETS_SIGNAL_NEW_BUYERS_SHORT','ru','Новый спрос'),
('MARKETS_SIGNAL_SMART_BUYERS_SHORT','ru','Умный спрос')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('MARKETS_SIGNAL_NEW_BUYERS_SHORT','ru','Новый спрос'),
('MARKETS_SIGNAL_SMART_BUYERS_SHORT','ru','Умный спрос')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
