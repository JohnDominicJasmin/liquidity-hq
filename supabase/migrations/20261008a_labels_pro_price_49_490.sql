-- Owner decision, 2026-10-08 (relayed by PM): FINAL prices are monthly $49, annual $490, every 2 weeks $20 (unchanged). Was $35 / $350 / $20.
-- Replaces the rows 20260923a wrote. The live prod rows were READ (select only) on 2026-10-08 and these 19 are exactly the rows that
-- carry a stale price: FAQ_Q_PRO_PRICE_A x5, UPGRADE_CHECKOUT_BUTTON_CTA x4 (no ar row exists, ar falls back to the en default),
-- UPGRADE_PRICE_MONTHLY x5, UPGRADE_PRICE_ANNUAL x5. No other label in prod carries 35 or 350.
-- UNCHANGED and still true: UPGRADE_ANNUAL_SAVE_BADGE "2 months free" (490 = 10 x 49), UPGRADE_PRICE_FORTNIGHTLY $20, the $10 weekly crypto note.
-- ar/ko/ru/zh were machine-translated in 20260923a and not native-reviewed; only the digits change here.
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out (apply one section at a time, to dev only when
-- QA says no test pass is running). The BoomFi $35 checkout link must be recreated at $49 before checkout goes live (not a label, not Dev's).
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).

insert into lhq_labels (key, locale, value) values
('FAQ_Q_PRO_PRICE_A','en','$20 every 2 weeks, $49 a month, or $490 a year.'),
('FAQ_Q_PRO_PRICE_A','ar','20$ كل أسبوعين، أو 49$ شهرياً، أو 490$ سنوياً.'),
('FAQ_Q_PRO_PRICE_A','ko','2주마다 $20, 매월 $49, 또는 매년 $490입니다.'),
('FAQ_Q_PRO_PRICE_A','ru','$20 раз в две недели, $49 в месяц или $490 в год.'),
('FAQ_Q_PRO_PRICE_A','zh','每两周 $20、每月 $49，或每年 $490。'),
('UPGRADE_CHECKOUT_BUTTON_CTA','en','Get Pro - $49/mo →'),
('UPGRADE_CHECKOUT_BUTTON_CTA','ko','프로 시작하기 - $49/월 →'),
('UPGRADE_CHECKOUT_BUTTON_CTA','ru','Получить Pro - $49/мес →'),
('UPGRADE_CHECKOUT_BUTTON_CTA','zh','开通 PRO - $49/月 →'),
('UPGRADE_PRICE_MONTHLY','en','$49'),
('UPGRADE_PRICE_MONTHLY','ar','49$'),
('UPGRADE_PRICE_MONTHLY','ko','$49'),
('UPGRADE_PRICE_MONTHLY','ru','$49'),
('UPGRADE_PRICE_MONTHLY','zh','$49'),
('UPGRADE_PRICE_ANNUAL','en','$490'),
('UPGRADE_PRICE_ANNUAL','ar','490$'),
('UPGRADE_PRICE_ANNUAL','ko','$490'),
('UPGRADE_PRICE_ANNUAL','ru','$490'),
('UPGRADE_PRICE_ANNUAL','zh','$490')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: the same rows against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('FAQ_Q_PRO_PRICE_A','en','$20 every 2 weeks, $49 a month, or $490 a year.'),
-- ('FAQ_Q_PRO_PRICE_A','ar','20$ كل أسبوعين، أو 49$ شهرياً، أو 490$ سنوياً.'),
-- ('FAQ_Q_PRO_PRICE_A','ko','2주마다 $20, 매월 $49, 또는 매년 $490입니다.'),
-- ('FAQ_Q_PRO_PRICE_A','ru','$20 раз в две недели, $49 в месяц или $490 в год.'),
-- ('FAQ_Q_PRO_PRICE_A','zh','每两周 $20、每月 $49，或每年 $490。'),
-- ('UPGRADE_CHECKOUT_BUTTON_CTA','en','Get Pro - $49/mo →'),
-- ('UPGRADE_CHECKOUT_BUTTON_CTA','ko','프로 시작하기 - $49/월 →'),
-- ('UPGRADE_CHECKOUT_BUTTON_CTA','ru','Получить Pro - $49/мес →'),
-- ('UPGRADE_CHECKOUT_BUTTON_CTA','zh','开通 PRO - $49/月 →'),
-- ('UPGRADE_PRICE_MONTHLY','en','$49'),
-- ('UPGRADE_PRICE_MONTHLY','ar','49$'),
-- ('UPGRADE_PRICE_MONTHLY','ko','$49'),
-- ('UPGRADE_PRICE_MONTHLY','ru','$49'),
-- ('UPGRADE_PRICE_MONTHLY','zh','$49'),
-- ('UPGRADE_PRICE_ANNUAL','en','$490'),
-- ('UPGRADE_PRICE_ANNUAL','ar','490$'),
-- ('UPGRADE_PRICE_ANNUAL','ko','$490'),
-- ('UPGRADE_PRICE_ANNUAL','ru','$490'),
-- ('UPGRADE_PRICE_ANNUAL','zh','$490')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
