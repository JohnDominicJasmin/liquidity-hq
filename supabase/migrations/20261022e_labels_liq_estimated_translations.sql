-- #1626 finding 9 (owner, 2026-10-22): the liquidation ladders are labelled "Estimated", so the LIVE badge on the current-price bar
-- between them cannot be read as covering them. ONE new key: LIQ_HEATMAP_ESTIMATED_TAG.
--
-- HELD: DO NOT APPLY until a speaker of each language has read these four values.
--
-- English does NOT need this file. It is a NEW key, so until any row exists every locale falls back to the build default in
-- lib/labelDefaults.en.json ("Estimated") - correct everywhere, just untranslated. That is the owner's "English now, the rest later"
-- decision from 2026-10-22 (#1689), applied here rather than re-asked: ar/ko/ru/zh below are Dev machine translations with no native
-- review, and an unreviewed translation on a label whose whole job is honesty is the wrong trade.
--
-- WHAT A REVIEWER IS CHECKING: that each value is the word a trader in that language would use for a figure the product calculated
-- rather than measured - closer to "estimated" than to "approximate" or "about".
--
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx), and only on the owner's word.

insert into lhq_labels (key, locale, value) values
('LIQ_HEATMAP_ESTIMATED_TAG','en','Estimated'),
('LIQ_HEATMAP_ESTIMATED_TAG','ar','تقديري'),
('LIQ_HEATMAP_ESTIMATED_TAG','ko','추정치'),
('LIQ_HEATMAP_ESTIMATED_TAG','ru','Оценка'),
('LIQ_HEATMAP_ESTIMATED_TAG','zh','估算')
on conflict (key, locale) do nothing;

-- DEV: the same rows against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('LIQ_HEATMAP_ESTIMATED_TAG','en','Estimated'),
-- ('LIQ_HEATMAP_ESTIMATED_TAG','ar','تقديري'),
-- ('LIQ_HEATMAP_ESTIMATED_TAG','ko','추정치'),
-- ('LIQ_HEATMAP_ESTIMATED_TAG','ru','Оценка'),
-- ('LIQ_HEATMAP_ESTIMATED_TAG','zh','估算')
-- on conflict (key, locale) do nothing;
