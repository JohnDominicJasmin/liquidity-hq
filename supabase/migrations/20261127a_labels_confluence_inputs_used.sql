-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- The Arena Confluence Score says what WAS used when perps vs spot could not be read for a coin (PM 2026-11-20: keep the #340 disclosure, no failure wording): "Score uses {n} inputs for this coin, without perps vs spot."
-- It replaces the English-only sentence "Perps vs spot could not be measured for this coin - the score does not account for ...". {n} intact; en equals lib/labelDefaults.en.json; ko/zh/ru/ar are AI-drafted and not native-reviewed.

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('CONFLUENCE_PERP_SPOT_NOT_USED','en','Score uses {n} inputs for this coin, without perps vs spot.'),
('CONFLUENCE_PERP_SPOT_NOT_USED','ko','이 코인의 점수는 선물 대 현물 없이 {n}개 입력을 사용합니다.'),
('CONFLUENCE_PERP_SPOT_NOT_USED','zh','该币种的评分使用 {n} 项输入，不含永续与现货对比。'),
('CONFLUENCE_PERP_SPOT_NOT_USED','ru','Оценка для этой монеты использует {n} входов, без сравнения фьючерсов и спота.'),
('CONFLUENCE_PERP_SPOT_NOT_USED','ar','تستخدم النتيجة لهذه العملة {n} مدخلات، دون مقارنة العقود الدائمة بالفوري.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('CONFLUENCE_PERP_SPOT_NOT_USED','en','Score uses {n} inputs for this coin, without perps vs spot.'),
('CONFLUENCE_PERP_SPOT_NOT_USED','ko','이 코인의 점수는 선물 대 현물 없이 {n}개 입력을 사용합니다.'),
('CONFLUENCE_PERP_SPOT_NOT_USED','zh','该币种的评分使用 {n} 项输入，不含永续与现货对比。'),
('CONFLUENCE_PERP_SPOT_NOT_USED','ru','Оценка для этой монеты использует {n} входов, без сравнения фьючерсов и спота.'),
('CONFLUENCE_PERP_SPOT_NOT_USED','ar','تستخدم النتيجة لهذه العملة {n} مدخلات، دون مقارنة العقود الدائمة بالفوري.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
