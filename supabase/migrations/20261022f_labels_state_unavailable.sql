-- #1651: STATE_UNAVAILABLE = "Unavailable" - the shared state string for a reading that cannot be had. First used by the dashboard's
-- Market Conditions widget, where a missing or unusable BTC long/short row used to render as a confident 50.0% / 50.0%.
--
-- The STRING is owner-approved first-hand, 2026-10-22 ~11:1x UTC, together with STATE_LOAD_FAILED and STATE_MARKET_DATA_UNAVAILABLE.
-- Only this one is added here: the other two go in with the code that uses them, not ahead of it.
--
-- ENGLISH ONLY, translations held - the owner's instruction for this batch. Until the other locales are approved, every locale falls
-- back to the English default in lib/labelDefaults.en.json, which is the same word.
--
-- A new key, so `do nothing`: it fills a gap and can never overwrite a row someone has since approved.
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out (apply to dev only when QA says no test pass
-- is running). Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).

insert into lhq_labels (key, locale, value) values
('STATE_UNAVAILABLE','en','Unavailable')
on conflict (key, locale) do nothing;

-- DEV: the same row against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('STATE_UNAVAILABLE','en','Unavailable')
-- on conflict (key, locale) do nothing;
