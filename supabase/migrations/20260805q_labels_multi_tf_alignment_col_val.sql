-- MULTI_TF_ALIGNMENT_COL_VAL - the EN column header was the bare abbreviation
-- "VAL", unclear at a glance what it means (the raw RSI reading, 0-100).
-- Spelling it out per the no-abbreviations UI copy rule. Other locales already
-- had a spelled-out word here (ko '값', zh '数值', ar 'القيمة') - only en was
-- short. Also adds the ru row, missing from an earlier translation wave.
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('MULTI_TF_ALIGNMENT_COL_VAL', 'en', 'VALUE'),
('MULTI_TF_ALIGNMENT_COL_VAL', 'ru', 'Значение')
on conflict (key, locale) do update set value = excluded.value;
