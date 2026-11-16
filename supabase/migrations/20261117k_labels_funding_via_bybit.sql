-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- /funding says when a coin's funding history is Bybit's because Binance was unavailable. New key FUNDING_VIA_BYBIT_NOTE. English ships in lib/labelDefaults.en.json (new key, nothing stored to override) and needs no row.
-- ko/zh/ru are AI-drafted and not native-reviewed.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('FUNDING_VIA_BYBIT_NOTE','ko','{coins}은(는) 바이낸스 데이터를 불러올 수 없었습니다. 이 코인에 표시된 펀딩 기록은 바이빗의 데이터입니다.'),
('FUNDING_VIA_BYBIT_NOTE','zh','{coins} 的币安数据暂不可用,这些币种显示的资金费率历史来自 Bybit。'),
('FUNDING_VIA_BYBIT_NOTE','ru','Данные Binance по {coins} недоступны. История фандинга для них показана по Bybit.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('FUNDING_VIA_BYBIT_NOTE','ko','{coins}은(는) 바이낸스 데이터를 불러올 수 없었습니다. 이 코인에 표시된 펀딩 기록은 바이빗의 데이터입니다.'),
('FUNDING_VIA_BYBIT_NOTE','zh','{coins} 的币安数据暂不可用,这些币种显示的资金费率历史来自 Bybit。'),
('FUNDING_VIA_BYBIT_NOTE','ru','Данные Binance по {coins} недоступны. История фандинга для них показана по Bybit.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
