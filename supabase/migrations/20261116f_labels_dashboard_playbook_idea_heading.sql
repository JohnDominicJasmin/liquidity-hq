-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The dashboard card heading "Best Setup Today" becomes "Playbook idea of the day" (PM, 2026-11-16, persona walkthrough #1113): the card is the Playbook's daily entry (reference content, not a computed setup), so the old heading promised a live setup it does not give. English ships in lib/labelDefaults.en.json and needs no row.
-- Overwrites the existing ko/zh/ar rows; a row beats the shipped default. ar is not offered but a stored 'ar' preference still serves its rows (lib/locales.ts). ko/zh/ru/ar are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling. Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('DASH_BEST_SETUP_TODAY_HEADER','ko','오늘의 플레이북 아이디어'),
('DASH_BEST_SETUP_TODAY_HEADER','zh','今日操作手册创意'),
('DASH_BEST_SETUP_TODAY_HEADER','ru','Идея дня из плейбука'),
('DASH_BEST_SETUP_TODAY_HEADER','ar','فكرة اليوم من دليل الاستراتيجيات')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
-- The English row exists on prod from the original seed and WINS over the new default, so it is updated too:
update lhq_labels set value = 'Playbook idea of the day', updated_at = now() where key = 'DASH_BEST_SETUP_TODAY_HEADER' and locale = 'en';

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('DASH_BEST_SETUP_TODAY_HEADER','ko','오늘의 플레이북 아이디어'),
('DASH_BEST_SETUP_TODAY_HEADER','zh','今日操作手册创意'),
('DASH_BEST_SETUP_TODAY_HEADER','ru','Идея дня из плейбука'),
('DASH_BEST_SETUP_TODAY_HEADER','ar','فكرة اليوم من دليل الاستراتيجيات')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
update lhq_dev_labels set value = 'Playbook idea of the day', updated_at = now() where key = 'DASH_BEST_SETUP_TODAY_HEADER' and locale = 'en';
