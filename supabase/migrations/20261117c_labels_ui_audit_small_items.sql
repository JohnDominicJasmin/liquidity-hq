-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- Names for assistive technology: the excluded rows on the Free plan card and the Journal thesis form's ticker, direction and date fields. English ships in lib/labelDefaults.en.json and needs no row. ko/zh/ru are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling. Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('UPGRADE_FREE_NOT_INCLUDED_SR','ko','포함되지 않음:'),
('UPGRADE_FREE_NOT_INCLUDED_SR','zh','不包含：'),
('UPGRADE_FREE_NOT_INCLUDED_SR','ru','Не включено:'),
('TRADE_JOURNAL_THESIS_TICKER_ARIA','ko','티커'),
('TRADE_JOURNAL_THESIS_TICKER_ARIA','zh','代码'),
('TRADE_JOURNAL_THESIS_TICKER_ARIA','ru','Тикер'),
('TRADE_JOURNAL_THESIS_DIRECTION_ARIA','ko','방향'),
('TRADE_JOURNAL_THESIS_DIRECTION_ARIA','zh','方向'),
('TRADE_JOURNAL_THESIS_DIRECTION_ARIA','ru','Направление'),
('TRADE_JOURNAL_THESIS_DATE_ARIA','ko','논지 날짜'),
('TRADE_JOURNAL_THESIS_DATE_ARIA','zh','观点日期'),
('TRADE_JOURNAL_THESIS_DATE_ARIA','ru','Дата тезиса')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('UPGRADE_FREE_NOT_INCLUDED_SR','ko','포함되지 않음:'),
('UPGRADE_FREE_NOT_INCLUDED_SR','zh','不包含：'),
('UPGRADE_FREE_NOT_INCLUDED_SR','ru','Не включено:'),
('TRADE_JOURNAL_THESIS_TICKER_ARIA','ko','티커'),
('TRADE_JOURNAL_THESIS_TICKER_ARIA','zh','代码'),
('TRADE_JOURNAL_THESIS_TICKER_ARIA','ru','Тикер'),
('TRADE_JOURNAL_THESIS_DIRECTION_ARIA','ko','방향'),
('TRADE_JOURNAL_THESIS_DIRECTION_ARIA','zh','方向'),
('TRADE_JOURNAL_THESIS_DIRECTION_ARIA','ru','Направление'),
('TRADE_JOURNAL_THESIS_DATE_ARIA','ko','논지 날짜'),
('TRADE_JOURNAL_THESIS_DATE_ARIA','zh','观点日期'),
('TRADE_JOURNAL_THESIS_DATE_ARIA','ru','Дата тезиса')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
