-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) BEFORE the release deploy; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The Multi-timeframe card says "No data" / "RSI readings unavailable right now" when fewer than two timeframes carry a reading, instead of "Mixed signals" (PM audit 2026-11-17, #1185). New keys; the en rows equal the shipped defaults.
-- ko/zh/ru/ar are AI-drafted and not native-reviewed (owner's 2026-11-13 ruling).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('MULTI_TF_ALIGNMENT_VERDICT_NO_DATA','en','No data'),
('MULTI_TF_ALIGNMENT_VERDICT_NO_DATA','ko','데이터 없음'),
('MULTI_TF_ALIGNMENT_VERDICT_NO_DATA','zh','暂无数据'),
('MULTI_TF_ALIGNMENT_VERDICT_NO_DATA','ru','Нет данных'),
('MULTI_TF_ALIGNMENT_VERDICT_NO_DATA','ar','لا بيانات'),
('MULTI_TF_ALIGNMENT_FOOTER_NO_DATA','en','RSI readings unavailable right now'),
('MULTI_TF_ALIGNMENT_FOOTER_NO_DATA','ko','RSI 값을 지금 사용할 수 없습니다'),
('MULTI_TF_ALIGNMENT_FOOTER_NO_DATA','zh','目前无法获取 RSI 读数'),
('MULTI_TF_ALIGNMENT_FOOTER_NO_DATA','ru','Показания RSI сейчас недоступны'),
('MULTI_TF_ALIGNMENT_FOOTER_NO_DATA','ar','قراءات RSI غير متاحة حاليًا')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('MULTI_TF_ALIGNMENT_VERDICT_NO_DATA','en','No data'),
('MULTI_TF_ALIGNMENT_VERDICT_NO_DATA','ko','데이터 없음'),
('MULTI_TF_ALIGNMENT_VERDICT_NO_DATA','zh','暂无数据'),
('MULTI_TF_ALIGNMENT_VERDICT_NO_DATA','ru','Нет данных'),
('MULTI_TF_ALIGNMENT_VERDICT_NO_DATA','ar','لا بيانات'),
('MULTI_TF_ALIGNMENT_FOOTER_NO_DATA','en','RSI readings unavailable right now'),
('MULTI_TF_ALIGNMENT_FOOTER_NO_DATA','ko','RSI 값을 지금 사용할 수 없습니다'),
('MULTI_TF_ALIGNMENT_FOOTER_NO_DATA','zh','目前无法获取 RSI 读数'),
('MULTI_TF_ALIGNMENT_FOOTER_NO_DATA','ru','Показания RSI сейчас недоступны'),
('MULTI_TF_ALIGNMENT_FOOTER_NO_DATA','ar','قراءات RSI غير متاحة حاليًا')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
