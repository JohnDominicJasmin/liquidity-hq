-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- Tokenized stocks: session strategies read the US cash session only (PM 2026-11-19). 2 keys x 5 locales; en equals the shipped defaults. ko/zh/ru/ar AI-drafted, not native-reviewed.
--   STRAT_MKT_CLOSED       new: the reason of a session strategy outside the US cash session.
--   STRAT_MKT_CLOSED_NOTE  new: the call box's one-line note on a stock outside the US cash session ({price} = the last close).
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('STRAT_MKT_CLOSED','en','US market closed: this strategy reads the cash session (09:30-16:00 New York).'),
('STRAT_MKT_CLOSED','ko','미국 시장 휴장: 이 전략은 정규장(뉴욕 09:30-16:00)만 봅니다.'),
('STRAT_MKT_CLOSED','zh','美国市场休市：该策略只读取常规交易时段（纽约 09:30-16:00）。'),
('STRAT_MKT_CLOSED','ru','Рынок США закрыт: стратегия читает только основную сессию (09:30-16:00 Нью-Йорк).'),
('STRAT_MKT_CLOSED','ar','سوق الولايات المتحدة مغلق: تقرأ هذه الاستراتيجية الجلسة النقدية فقط (09:30-16:00 نيويورك).'),
('STRAT_MKT_CLOSED_NOTE','en','US market closed; last close {price}.'),
('STRAT_MKT_CLOSED_NOTE','ko','미국 시장 휴장. 마지막 종가 {price}.'),
('STRAT_MKT_CLOSED_NOTE','zh','美国市场休市；最后收盘价 {price}。'),
('STRAT_MKT_CLOSED_NOTE','ru','Рынок США закрыт; последнее закрытие {price}.'),
('STRAT_MKT_CLOSED_NOTE','ar','سوق الولايات المتحدة مغلق؛ آخر إغلاق {price}.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('STRAT_MKT_CLOSED','en','US market closed: this strategy reads the cash session (09:30-16:00 New York).'),
('STRAT_MKT_CLOSED','ko','미국 시장 휴장: 이 전략은 정규장(뉴욕 09:30-16:00)만 봅니다.'),
('STRAT_MKT_CLOSED','zh','美国市场休市：该策略只读取常规交易时段（纽约 09:30-16:00）。'),
('STRAT_MKT_CLOSED','ru','Рынок США закрыт: стратегия читает только основную сессию (09:30-16:00 Нью-Йорк).'),
('STRAT_MKT_CLOSED','ar','سوق الولايات المتحدة مغلق: تقرأ هذه الاستراتيجية الجلسة النقدية فقط (09:30-16:00 نيويورك).'),
('STRAT_MKT_CLOSED_NOTE','en','US market closed; last close {price}.'),
('STRAT_MKT_CLOSED_NOTE','ko','미국 시장 휴장. 마지막 종가 {price}.'),
('STRAT_MKT_CLOSED_NOTE','zh','美国市场休市；最后收盘价 {price}。'),
('STRAT_MKT_CLOSED_NOTE','ru','Рынок США закрыт; последнее закрытие {price}.'),
('STRAT_MKT_CLOSED_NOTE','ar','سوق الولايات المتحدة مغلق؛ آخر إغلاق {price}.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
