-- #1309 item 22 (tracked on #1309). The four annual-plan labels on /upgrade
--
--   UPGRADE_MONTHLY_CHECKOUT_BUTTON_CTA   UPGRADE_ANNUAL_CHECKOUT_BUTTON_CTA
--   UPGRADE_PRICE_SUFFIX_ANNUAL           UPGRADE_ANNUAL_SAVE_BADGE
--
-- had NO English default in lib/labelDefaults.en.json (they are declared in lib/labelKeys.ts), so once
-- annual checkout is switched on (paused today, #372) the page would paint raw key names until
-- /api/labels answered. This PR adds the four defaults. The only RECORDED values for them (QA's
-- production snapshot, qa/fixtures/proxy/labels.json) contain EM DASHES:
--
--   UPGRADE_MONTHLY_CHECKOUT_BUTTON_CTA   "Get Pro — Monthly"
--   UPGRADE_ANNUAL_CHECKOUT_BUTTON_CTA    "Get Pro — Annual"
--
-- Database rows shadow the shipped default, so the defaults alone would not remove the em dashes anyone
-- sees once the DB answers. This UPDATES those two rows to the hyphen the sibling label already uses
-- ("Get Pro - $25/mo →") and restates the other two so the four live together. English only: no other
-- locale is touched. Nothing is deleted.
--
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev,
-- wdtjhrilakoitfcezxpx). The dev section below is commented out per 20260912b's convention - apply
-- one section at a time. Shared-database write: owner-gated; PM/DevOps applies it.

insert into lhq_labels (key, locale, value) values

('UPGRADE_MONTHLY_CHECKOUT_BUTTON_CTA','en','Get Pro - Monthly'),
('UPGRADE_ANNUAL_CHECKOUT_BUTTON_CTA','en','Get Pro - Annual'),
('UPGRADE_PRICE_SUFFIX_ANNUAL','en','/yr'),
('UPGRADE_ANNUAL_SAVE_BADGE','en','2 months free')

on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately, per 20260912b.
--
-- insert into lhq_dev_labels (key, locale, value) values
--
-- ('UPGRADE_MONTHLY_CHECKOUT_BUTTON_CTA','en','Get Pro - Monthly'),
-- ('UPGRADE_ANNUAL_CHECKOUT_BUTTON_CTA','en','Get Pro - Annual'),
-- ('UPGRADE_PRICE_SUFFIX_ANNUAL','en','/yr'),
-- ('UPGRADE_ANNUAL_SAVE_BADGE','en','2 months free')
--
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
