-- #1598 (owner, 2026-10-20): the Pro trial banner gets a small close button. ONE NEW key, five locales: TRIAL_BANNER_DISMISS (the button's accessible name and tooltip).
-- New key, so no live label row is overwritten.
--
-- ALSO IN #1598 (copy decided by PM, 2026-10-20): the banner no longer renders TRIAL_BANNER_FULL_ACCESS ("Full access -"), which stopped being true when a trial
-- became BTC/ETH/SOL only (#1604). The key is removed from lib/labelKeys.ts and labelDefaults.en.json. Its five existing rows (20260803g, 20260807g) are now
-- unused and harmless; this file deliberately does NOT delete them (a delete is a production write that gains nothing). Clean them up later if the owner wants.
--
-- The English text is the default in lib/labelDefaults.en.json; ar/ko/ru/zh are machine-translated by Dev and NOT native-reviewed. Until these rows exist the
-- button's name is the English default in every locale (the build-time fallback), which is correct, just not translated.
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out (apply one section at a time, to dev only when QA says no test pass is
-- running). Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).

insert into lhq_labels (key, locale, value) values
('TRIAL_BANNER_DISMISS','en','Dismiss'),
('TRIAL_BANNER_DISMISS','ar','إخفاء'),
('TRIAL_BANNER_DISMISS','ko','닫기'),
('TRIAL_BANNER_DISMISS','ru','Скрыть'),
('TRIAL_BANNER_DISMISS','zh','关闭')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: the same rows against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('TRIAL_BANNER_DISMISS','en','Dismiss'),
-- ('TRIAL_BANNER_DISMISS','ar','إخفاء'),
-- ('TRIAL_BANNER_DISMISS','ko','닫기'),
-- ('TRIAL_BANNER_DISMISS','ru','Скрыть'),
-- ('TRIAL_BANNER_DISMISS','zh','关闭')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
