-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- The Telegram daily summary lists at most 10 squeeze setups and ends with '... and N more' (PM 2026-11-19). 2 keys x 5 locales; en equals the shipped default; ar stays English (held, like the rest of 20261119z5). ko/zh/ru AI-drafted, not native-reviewed.
--   TG_DS_MORE_PRE  new, start of line: '... and'   TG_DS_MORE_POST  new, end of line: 'more'   (the number sits between them)
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('TG_DS_MORE_PRE','en','… and'),
('TG_DS_MORE_PRE','ko','… 외'),
('TG_DS_MORE_PRE','zh','… 另有'),
('TG_DS_MORE_PRE','ru','… и ещё'),
('TG_DS_MORE_PRE','ar','… and'),
('TG_DS_MORE_POST','en','more'),
('TG_DS_MORE_POST','ko','개 더'),
('TG_DS_MORE_POST','zh','个'),
('TG_DS_MORE_POST','ru','шт.'),
('TG_DS_MORE_POST','ar','more')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('TG_DS_MORE_PRE','en','… and'),
('TG_DS_MORE_PRE','ko','… 외'),
('TG_DS_MORE_PRE','zh','… 另有'),
('TG_DS_MORE_PRE','ru','… и ещё'),
('TG_DS_MORE_PRE','ar','… and'),
('TG_DS_MORE_POST','en','more'),
('TG_DS_MORE_POST','ko','개 더'),
('TG_DS_MORE_POST','zh','个'),
('TG_DS_MORE_POST','ru','шт.'),
('TG_DS_MORE_POST','ar','more')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
