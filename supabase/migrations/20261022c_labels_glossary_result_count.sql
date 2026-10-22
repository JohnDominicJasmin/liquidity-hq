-- #1673 item 5 (owner, 2026-10-22: the Glossary "Match the app"): while a search is typed, /learn says how many terms match. New key
-- LEARN_CONTENT_RESULTS_COUNT ({count} of {total} terms); English default is in lib/labelDefaults.en.json. No other glossary copy changes:
-- the heading is the existing MAIN + ACCENT keys rendered as one plain string.
--
-- A new key, so `do nothing`: it only fills the gap and can never overwrite a row someone has since approved. ar/ko/ru/zh are Dev machine
-- translations, NOT native-reviewed.
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out (apply to dev only when QA says no test pass is running).
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).
-- Until applied, every locale shows the English default.

insert into lhq_labels (key, locale, value) values
('LEARN_CONTENT_RESULTS_COUNT','en','{count} of {total} terms'),
('LEARN_CONTENT_RESULTS_COUNT','ar','{count} من {total} مصطلحًا'),
('LEARN_CONTENT_RESULTS_COUNT','ko','용어 {total}개 중 {count}개'),
('LEARN_CONTENT_RESULTS_COUNT','ru','{count} из {total} терминов'),
('LEARN_CONTENT_RESULTS_COUNT','zh','共 {total} 个术语，匹配 {count} 个')
on conflict (key, locale) do nothing;

-- DEV: the same rows against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('LEARN_CONTENT_RESULTS_COUNT','en','{count} of {total} terms'),
-- ('LEARN_CONTENT_RESULTS_COUNT','ar','{count} من {total} مصطلحًا'),
-- ('LEARN_CONTENT_RESULTS_COUNT','ko','용어 {total}개 중 {count}개'),
-- ('LEARN_CONTENT_RESULTS_COUNT','ru','{count} из {total} терминов'),
-- ('LEARN_CONTENT_RESULTS_COUNT','zh','共 {total} 个术语，匹配 {count} 个')
-- on conflict (key, locale) do nothing;
