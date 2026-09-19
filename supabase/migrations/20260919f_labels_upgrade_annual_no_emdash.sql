-- #1309 item 22 (tracked on #1309). The four annual-plan labels on /upgrade
--
--   UPGRADE_MONTHLY_CHECKOUT_BUTTON_CTA   UPGRADE_ANNUAL_CHECKOUT_BUTTON_CTA
--   UPGRADE_PRICE_SUFFIX_ANNUAL           UPGRADE_ANNUAL_SAVE_BADGE
--
-- had NO English default in lib/labelDefaults.en.json (they are declared in lib/labelKeys.ts), so once
-- annual checkout is switched on (paused today, #372) the page would paint raw key names until
-- /api/labels answered. This PR adds the four English defaults. The English wording is NOT new: it is
-- the recorded value (QA's snapshot, qa/fixtures/proxy/labels.json; introduced with the annual plan,
-- de4e979e), except that the two button labels carried EM DASHES:
--
--   UPGRADE_MONTHLY_CHECKOUT_BUTTON_CTA   "Get Pro — Monthly"   ->  "Get Pro - Monthly"
--   UPGRADE_ANNUAL_CHECKOUT_BUTTON_CTA    "Get Pro — Annual"    ->  "Get Pro - Annual"
--
-- (the hyphen is what the sibling label already uses: "Get Pro - $25/mo →"). A database row shadows the
-- shipped default, so the defaults alone would not remove the em dashes anyone sees once the DB answers:
-- this UPDATES the en rows.
--
-- FIVE LOCALES, because production's /api/labels serves database rows ONLY and the English fallback is
-- client-side: with en rows alone every ko / zh / ru / ar reader would see English on these four keys.
-- ar/ko/ru/zh are MACHINE-TRANSLATED and not reviewed by a native speaker, the same standard as the rest
-- of this audit's translation waves. They follow the wording the sibling keys already use in each locale
-- (ko "프로 시작하기", zh "开通 PRO", ar "اشترك في Pro", and the monthly suffixes /월, /月, /شهرياً);
-- ru has no sibling rows, so "Получить Pro" is new wording. Nothing is deleted.
--
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev,
-- wdtjhrilakoitfcezxpx). The dev section below is commented out per 20260912b's convention - apply
-- one section at a time. Shared-database write: owner-gated; PM/DevOps applies it.

insert into lhq_labels (key, locale, value) values

('UPGRADE_MONTHLY_CHECKOUT_BUTTON_CTA','en','Get Pro - Monthly'),
('UPGRADE_MONTHLY_CHECKOUT_BUTTON_CTA','ar','اشترك في Pro - شهرياً'),
('UPGRADE_MONTHLY_CHECKOUT_BUTTON_CTA','ko','프로 시작하기 - 월간'),
('UPGRADE_MONTHLY_CHECKOUT_BUTTON_CTA','ru','Получить Pro - Ежемесячно'),
('UPGRADE_MONTHLY_CHECKOUT_BUTTON_CTA','zh','开通 PRO - 月付'),

('UPGRADE_ANNUAL_CHECKOUT_BUTTON_CTA','en','Get Pro - Annual'),
('UPGRADE_ANNUAL_CHECKOUT_BUTTON_CTA','ar','اشترك في Pro - سنوياً'),
('UPGRADE_ANNUAL_CHECKOUT_BUTTON_CTA','ko','프로 시작하기 - 연간'),
('UPGRADE_ANNUAL_CHECKOUT_BUTTON_CTA','ru','Получить Pro - Ежегодно'),
('UPGRADE_ANNUAL_CHECKOUT_BUTTON_CTA','zh','开通 PRO - 年付'),

('UPGRADE_PRICE_SUFFIX_ANNUAL','en','/yr'),
('UPGRADE_PRICE_SUFFIX_ANNUAL','ar','/سنوياً'),
('UPGRADE_PRICE_SUFFIX_ANNUAL','ko','/년'),
('UPGRADE_PRICE_SUFFIX_ANNUAL','ru','/год'),
('UPGRADE_PRICE_SUFFIX_ANNUAL','zh','/年'),

('UPGRADE_ANNUAL_SAVE_BADGE','en','2 months free'),
('UPGRADE_ANNUAL_SAVE_BADGE','ar','شهران مجاناً'),
('UPGRADE_ANNUAL_SAVE_BADGE','ko','2개월 무료'),
('UPGRADE_ANNUAL_SAVE_BADGE','ru','2 месяца бесплатно'),
('UPGRADE_ANNUAL_SAVE_BADGE','zh','免费 2 个月')

on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately, per 20260912b.
--
-- insert into lhq_dev_labels (key, locale, value) values
--
-- ('UPGRADE_MONTHLY_CHECKOUT_BUTTON_CTA','en','Get Pro - Monthly'),
-- ('UPGRADE_MONTHLY_CHECKOUT_BUTTON_CTA','ar','اشترك في Pro - شهرياً'),
-- ('UPGRADE_MONTHLY_CHECKOUT_BUTTON_CTA','ko','프로 시작하기 - 월간'),
-- ('UPGRADE_MONTHLY_CHECKOUT_BUTTON_CTA','ru','Получить Pro - Ежемесячно'),
-- ('UPGRADE_MONTHLY_CHECKOUT_BUTTON_CTA','zh','开通 PRO - 月付'),
--
-- ('UPGRADE_ANNUAL_CHECKOUT_BUTTON_CTA','en','Get Pro - Annual'),
-- ('UPGRADE_ANNUAL_CHECKOUT_BUTTON_CTA','ar','اشترك في Pro - سنوياً'),
-- ('UPGRADE_ANNUAL_CHECKOUT_BUTTON_CTA','ko','프로 시작하기 - 연간'),
-- ('UPGRADE_ANNUAL_CHECKOUT_BUTTON_CTA','ru','Получить Pro - Ежегодно'),
-- ('UPGRADE_ANNUAL_CHECKOUT_BUTTON_CTA','zh','开通 PRO - 年付'),
--
-- ('UPGRADE_PRICE_SUFFIX_ANNUAL','en','/yr'),
-- ('UPGRADE_PRICE_SUFFIX_ANNUAL','ar','/سنوياً'),
-- ('UPGRADE_PRICE_SUFFIX_ANNUAL','ko','/년'),
-- ('UPGRADE_PRICE_SUFFIX_ANNUAL','ru','/год'),
-- ('UPGRADE_PRICE_SUFFIX_ANNUAL','zh','/年'),
--
-- ('UPGRADE_ANNUAL_SAVE_BADGE','en','2 months free'),
-- ('UPGRADE_ANNUAL_SAVE_BADGE','ar','شهران مجاناً'),
-- ('UPGRADE_ANNUAL_SAVE_BADGE','ko','2개월 무료'),
-- ('UPGRADE_ANNUAL_SAVE_BADGE','ru','2 месяца бесплатно'),
-- ('UPGRADE_ANNUAL_SAVE_BADGE','zh','免费 2 个月')
--
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
