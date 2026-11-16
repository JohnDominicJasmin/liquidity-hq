-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The journal stats say which trades they cover once the 200-trade cap is reached. New key TRADE_JOURNAL_STATS_NEWEST_NOTE. English ships in lib/labelDefaults.en.json (new key, nothing stored to override) and needs no row.
-- ko/zh/ru are AI-drafted and not native-reviewed.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('TRADE_JOURNAL_STATS_NEWEST_NOTE','ko','이 통계는 최근 거래 {n}건을 기준으로 합니다.'),
('TRADE_JOURNAL_STATS_NEWEST_NOTE','zh','这些统计基于您最近的 {n} 笔交易。'),
('TRADE_JOURNAL_STATS_NEWEST_NOTE','ru','Эта статистика основана на ваших последних {n} сделках.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('TRADE_JOURNAL_STATS_NEWEST_NOTE','ko','이 통계는 최근 거래 {n}건을 기준으로 합니다.'),
('TRADE_JOURNAL_STATS_NEWEST_NOTE','zh','这些统计基于您最近的 {n} 笔交易。'),
('TRADE_JOURNAL_STATS_NEWEST_NOTE','ru','Эта статистика основана на ваших последних {n} сделках.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
