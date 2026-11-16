-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The liquidation feed and the whale trades feed end in an honest line when no socket has connected after 8 s (instead of skeletons for ever). New keys LIQ_FEED_CONNECT_FAILED and WHALE_TRADES_FEED_CONNECT_FAILED.
-- English ships in lib/labelDefaults.en.json (new keys, nothing stored to override) and needs no row. ko/zh/ru are AI-drafted and not native-reviewed.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('LIQ_FEED_CONNECT_FAILED','ko','실시간 청산 피드에 연결할 수 없습니다. 다시 시도하는 중…'),
('WHALE_TRADES_FEED_CONNECT_FAILED','ko','실시간 체결 피드에 연결할 수 없습니다. 다시 시도하는 중…'),
('LIQ_FEED_CONNECT_FAILED','zh','无法连接实时爆仓数据流,正在重试…'),
('WHALE_TRADES_FEED_CONNECT_FAILED','zh','无法连接实时成交数据流,正在重试…'),
('LIQ_FEED_CONNECT_FAILED','ru','Не удалось подключиться к ленте ликвидаций. Повторяем попытку…'),
('WHALE_TRADES_FEED_CONNECT_FAILED','ru','Не удалось подключиться к ленте сделок. Повторяем попытку…')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('LIQ_FEED_CONNECT_FAILED','ko','실시간 청산 피드에 연결할 수 없습니다. 다시 시도하는 중…'),
('WHALE_TRADES_FEED_CONNECT_FAILED','ko','실시간 체결 피드에 연결할 수 없습니다. 다시 시도하는 중…'),
('LIQ_FEED_CONNECT_FAILED','zh','无法连接实时爆仓数据流,正在重试…'),
('WHALE_TRADES_FEED_CONNECT_FAILED','zh','无法连接实时成交数据流,正在重试…'),
('LIQ_FEED_CONNECT_FAILED','ru','Не удалось подключиться к ленте ликвидаций. Повторяем попытку…'),
('WHALE_TRADES_FEED_CONNECT_FAILED','ru','Не удалось подключиться к ленте сделок. Повторяем попытку…')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
