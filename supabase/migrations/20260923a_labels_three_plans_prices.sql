-- #1400: three plans - $20 every two weeks, $35 a month, $350 a year - replacing
-- the single $25/mo. Every label row that carries a price, in five locales, plus
-- the five new keys the /upgrade page now reads. Owner's prices (2026-09-23);
-- the wording is a placeholder for the owner to sign off (copy is theirs).
--
-- "BEFORE" IS WHAT PRODUCTION SERVES, measured by PM/DevOps from /api/labels on
-- 2026-09-23 - NOT what supabase/migrations says. The files are a partial
-- history: the ru CTA row exists on production though no committed migration
-- inserted it, and FAQ_Q_PRO_PRICE_A exists in all five locales as untranslated
-- English. Do not trace the files for the current state; ask for a measurement.
--
--   key                          locale  before (live)                      after
--   UPGRADE_CHECKOUT_BUTTON_CTA  en      Get Pro - $25/mo →                 Get Pro - $35/mo →
--   UPGRADE_CHECKOUT_BUTTON_CTA  ko      프로 시작하기 - $25/월 →             프로 시작하기 - $35/월 →
--   UPGRADE_CHECKOUT_BUTTON_CTA  zh      开通 PRO - $25/月 →                 开通 PRO - $35/月 →
--   UPGRADE_CHECKOUT_BUTTON_CTA  ru      ... $25/мес (verbatim from PM)      ... $35/мес
--   UPGRADE_CHECKOUT_BUTTON_CTA  ar      (no row; Arabic not offered, #138)  unchanged - no row added
--   FAQ_Q_PRO_PRICE_A            en      $25 per month, cancel anytime.     $20 every 2 weeks, $35 a month, or $350 a year.
--   FAQ_Q_PRO_PRICE_A            ko/zh/ru/ar   (the English sentence)        translated (machine) - see rows
--   + 5 new keys x 5 locales (UPGRADE_FORTNIGHTLY_CHECKOUT_BUTTON_CTA,
--     UPGRADE_PRICE_SUFFIX_FORTNIGHTLY, UPGRADE_PRICE_FORTNIGHTLY,
--     UPGRADE_PRICE_MONTHLY, UPGRADE_PRICE_ANNUAL)
--   + UPGRADE_TRUST_BILLED_ANNUALLY x 5: declared since the annual plan shipped but
--     with NO English default and no known rows - it rendered as its raw key name
--     on /upgrade the moment all three links were set (found by rendering the
--     build, 2026-09-23). Same class as the four keys item 22 fixed.
--
-- "CANCEL ANYTIME" IS DELIBERATELY GONE from the FAQ answer: it is not true until
-- #1396 (the cancellation path) ships, and that PR puts it back. Do not restore
-- it here.
--
-- SHIPS WITH THE CODE, NOT BEFORE: app/upgrade/page.tsx, the landing page and
-- lib/i18n/dictionaries.ts carry the new prices as literals/defaults in the same
-- PR. Apply these rows just before that deploy - not earlier, or the page and
-- the FAQ disagree for a day.
--
-- ar/ko/ru/zh are MACHINE-TRANSLATED and not reviewed by a native speaker, the
-- same standard as the other translation waves. The ru CTA row below uses the
-- English wording pattern with the ru suffix PM quoted ("$35/мес"); replace
-- with the verbatim live string if PM supplies it before applying.
--
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels
-- (dev, wdtjhrilakoitfcezxpx). Dev section commented per 20260912b - apply one
-- section at a time. Shared-database write: owner-gated; PM/DevOps applies.

insert into lhq_labels (key, locale, value) values

('UPGRADE_CHECKOUT_BUTTON_CTA','en','Get Pro - $35/mo →'),
('UPGRADE_CHECKOUT_BUTTON_CTA','ko','프로 시작하기 - $35/월 →'),
('UPGRADE_CHECKOUT_BUTTON_CTA','zh','开通 PRO - $35/月 →'),
('UPGRADE_CHECKOUT_BUTTON_CTA','ru','Получить Pro - $35/мес →'),

('FAQ_Q_PRO_PRICE_A','en','$20 every 2 weeks, $35 a month, or $350 a year.'),
('FAQ_Q_PRO_PRICE_A','ar','20$ كل أسبوعين، أو 35$ شهرياً، أو 350$ سنوياً.'),
('FAQ_Q_PRO_PRICE_A','ko','2주마다 $20, 매월 $35, 또는 매년 $350입니다.'),
('FAQ_Q_PRO_PRICE_A','ru','$20 раз в две недели, $35 в месяц или $350 в год.'),
('FAQ_Q_PRO_PRICE_A','zh','每两周 $20、每月 $35，或每年 $350。'),

('UPGRADE_FORTNIGHTLY_CHECKOUT_BUTTON_CTA','en','Get Pro - Every 2 weeks'),
('UPGRADE_FORTNIGHTLY_CHECKOUT_BUTTON_CTA','ar','اشترك في Pro - كل أسبوعين'),
('UPGRADE_FORTNIGHTLY_CHECKOUT_BUTTON_CTA','ko','프로 시작하기 - 2주마다'),
('UPGRADE_FORTNIGHTLY_CHECKOUT_BUTTON_CTA','ru','Получить Pro - Раз в две недели'),
('UPGRADE_FORTNIGHTLY_CHECKOUT_BUTTON_CTA','zh','开通 PRO - 每两周'),

('UPGRADE_PRICE_SUFFIX_FORTNIGHTLY','en','/2 weeks'),
('UPGRADE_PRICE_SUFFIX_FORTNIGHTLY','ar','/أسبوعين'),
('UPGRADE_PRICE_SUFFIX_FORTNIGHTLY','ko','/2주'),
('UPGRADE_PRICE_SUFFIX_FORTNIGHTLY','ru','/2 недели'),
('UPGRADE_PRICE_SUFFIX_FORTNIGHTLY','zh','/两周'),

('UPGRADE_PRICE_FORTNIGHTLY','en','$20'),
('UPGRADE_PRICE_FORTNIGHTLY','ar','20$'),
('UPGRADE_PRICE_FORTNIGHTLY','ko','$20'),
('UPGRADE_PRICE_FORTNIGHTLY','ru','$20'),
('UPGRADE_PRICE_FORTNIGHTLY','zh','$20'),

('UPGRADE_PRICE_MONTHLY','en','$35'),
('UPGRADE_PRICE_MONTHLY','ar','35$'),
('UPGRADE_PRICE_MONTHLY','ko','$35'),
('UPGRADE_PRICE_MONTHLY','ru','$35'),
('UPGRADE_PRICE_MONTHLY','zh','$35'),

('UPGRADE_PRICE_ANNUAL','en','$350'),
('UPGRADE_PRICE_ANNUAL','ar','350$'),
('UPGRADE_PRICE_ANNUAL','ko','$350'),
('UPGRADE_PRICE_ANNUAL','ru','$350'),
('UPGRADE_PRICE_ANNUAL','zh','$350'),

('UPGRADE_TRUST_BILLED_ANNUALLY','en','Billed annually'),
('UPGRADE_TRUST_BILLED_ANNUALLY','ar','تُدفع سنوياً'),
('UPGRADE_TRUST_BILLED_ANNUALLY','ko','연간 결제'),
('UPGRADE_TRUST_BILLED_ANNUALLY','ru','Оплата раз в год'),
('UPGRADE_TRUST_BILLED_ANNUALLY','zh','按年计费')

on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately, per 20260912b.
--
-- insert into lhq_dev_labels (key, locale, value) values
--
-- ('UPGRADE_CHECKOUT_BUTTON_CTA','en','Get Pro - $35/mo →'),
-- ('UPGRADE_CHECKOUT_BUTTON_CTA','ko','프로 시작하기 - $35/월 →'),
-- ('UPGRADE_CHECKOUT_BUTTON_CTA','zh','开通 PRO - $35/月 →'),
-- ('UPGRADE_CHECKOUT_BUTTON_CTA','ru','Получить Pro - $35/мес →'),
--
-- ('FAQ_Q_PRO_PRICE_A','en','$20 every 2 weeks, $35 a month, or $350 a year.'),
-- ('FAQ_Q_PRO_PRICE_A','ar','20$ كل أسبوعين، أو 35$ شهرياً، أو 350$ سنوياً.'),
-- ('FAQ_Q_PRO_PRICE_A','ko','2주마다 $20, 매월 $35, 또는 매년 $350입니다.'),
-- ('FAQ_Q_PRO_PRICE_A','ru','$20 раз в две недели, $35 в месяц или $350 в год.'),
-- ('FAQ_Q_PRO_PRICE_A','zh','每两周 $20、每月 $35，或每年 $350。'),
--
-- ('UPGRADE_FORTNIGHTLY_CHECKOUT_BUTTON_CTA','en','Get Pro - Every 2 weeks'),
-- ('UPGRADE_FORTNIGHTLY_CHECKOUT_BUTTON_CTA','ar','اشترك في Pro - كل أسبوعين'),
-- ('UPGRADE_FORTNIGHTLY_CHECKOUT_BUTTON_CTA','ko','프로 시작하기 - 2주마다'),
-- ('UPGRADE_FORTNIGHTLY_CHECKOUT_BUTTON_CTA','ru','Получить Pro - Раз в две недели'),
-- ('UPGRADE_FORTNIGHTLY_CHECKOUT_BUTTON_CTA','zh','开通 PRO - 每两周'),
--
-- ('UPGRADE_PRICE_SUFFIX_FORTNIGHTLY','en','/2 weeks'),
-- ('UPGRADE_PRICE_SUFFIX_FORTNIGHTLY','ar','/أسبوعين'),
-- ('UPGRADE_PRICE_SUFFIX_FORTNIGHTLY','ko','/2주'),
-- ('UPGRADE_PRICE_SUFFIX_FORTNIGHTLY','ru','/2 недели'),
-- ('UPGRADE_PRICE_SUFFIX_FORTNIGHTLY','zh','/两周'),
--
-- ('UPGRADE_PRICE_FORTNIGHTLY','en','$20'),
-- ('UPGRADE_PRICE_FORTNIGHTLY','ar','20$'),
-- ('UPGRADE_PRICE_FORTNIGHTLY','ko','$20'),
-- ('UPGRADE_PRICE_FORTNIGHTLY','ru','$20'),
-- ('UPGRADE_PRICE_FORTNIGHTLY','zh','$20'),
--
-- ('UPGRADE_PRICE_MONTHLY','en','$35'),
-- ('UPGRADE_PRICE_MONTHLY','ar','35$'),
-- ('UPGRADE_PRICE_MONTHLY','ko','$35'),
-- ('UPGRADE_PRICE_MONTHLY','ru','$35'),
-- ('UPGRADE_PRICE_MONTHLY','zh','$35'),
--
-- ('UPGRADE_PRICE_ANNUAL','en','$350'),
-- ('UPGRADE_PRICE_ANNUAL','ar','350$'),
-- ('UPGRADE_PRICE_ANNUAL','ko','$350'),
-- ('UPGRADE_PRICE_ANNUAL','ru','$350'),
-- ('UPGRADE_PRICE_ANNUAL','zh','$350'),
-- 
-- ('UPGRADE_TRUST_BILLED_ANNUALLY','en','Billed annually'),
-- ('UPGRADE_TRUST_BILLED_ANNUALLY','ar','تُدفع سنوياً'),
-- ('UPGRADE_TRUST_BILLED_ANNUALLY','ko','연간 결제'),
-- ('UPGRADE_TRUST_BILLED_ANNUALLY','ru','Оплата раз в год'),
-- ('UPGRADE_TRUST_BILLED_ANNUALLY','zh','按年计费')
--
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
