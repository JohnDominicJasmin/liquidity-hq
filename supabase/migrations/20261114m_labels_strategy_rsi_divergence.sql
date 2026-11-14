-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso by PM/DevOps with the release; DEV on wdtjhrilakoitfcezxpx.
--
-- Labels for Arena strategy 7, RSI divergence. English ships in lib/labelDefaults.en.json and needs no row. ko/zh/ru AI-drafted (owner ruling 2026-11-13). Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('STRAT_RSIDIV_NAME','ko','RSI 다이버전스'),
('STRAT_RSIDIV_NAME','zh','RSI 背离'),
('STRAT_RSIDIV_NAME','ru','Дивергенция RSI'),
('STRAT_RSIDIV_DESC','ko','가격과 RSI가 엇갈리는 모습을 찾습니다. 가격은 저점을 낮추는데 RSI는 저점을 높이거나(매도세 약화), 가격은 고점을 높이는데 RSI는 고점을 낮추는 경우(매수세 약화)입니다. 이것만으로는 신호가 아니므로, 스윙 캔들을 되돌파해 마감하는 첫 캔들(매수는 고점 위, 매도는 저점 아래)을 기다립니다. 그 전에 가격이 새 극값을 만들면 다이버전스는 무효입니다. 마감된 캔들만 사용합니다.'),
('STRAT_RSIDIV_DESC','zh','寻找价格与RSI背离：价格创出更低的低点而RSI创出更高的低点（卖压减弱），或价格创出更高的高点而RSI创出更低的高点（买压减弱）。仅此并非信号，因此要等待第一根收盘回穿该波段K线的K线（买入为收盘在其最高价之上，卖出为收盘在其最低价之下）。若价格先创出新极值，背离即告失效。仅使用已收盘K线。'),
('STRAT_RSIDIV_DESC','ru','Ищет расхождение цены и RSI: цена делает более низкий минимум, а RSI — более высокий (продавцы слабеют), или цена делает более высокий максимум, а RSI — более низкий (покупатели слабеют). Одного этого мало, поэтому ждёт первую свечу, закрывшуюся обратно через свинговую свечу (выше её максимума для покупки, ниже минимума для продажи). Если цена раньше обновит экстремум, дивергенция отменяется. Только закрытые свечи.'),
('STRAT_RSIDIV_BUY','ko','강세 다이버전스: 가격은 {swing}에서 저점을 낮췄지만 RSI는 저점을 높였고, 이제 캔들이 {trigger} 위에서 마감했습니다.'),
('STRAT_RSIDIV_BUY','zh','看涨背离：价格在 {swing} 创出更低的低点而RSI创出更高的低点，现在有K线收盘在 {trigger} 之上。'),
('STRAT_RSIDIV_BUY','ru','Бычья дивергенция: цена сделала более низкий минимум на {swing}, а RSI — более высокий, и теперь свеча закрылась выше {trigger}.'),
('STRAT_RSIDIV_SELL','ko','약세 다이버전스: 가격은 {swing}에서 고점을 높였지만 RSI는 고점을 낮췄고, 이제 캔들이 {trigger} 아래에서 마감했습니다.'),
('STRAT_RSIDIV_SELL','zh','看跌背离：价格在 {swing} 创出更高的高点而RSI创出更低的高点，现在有K线收盘在 {trigger} 之下。'),
('STRAT_RSIDIV_SELL','ru','Медвежья дивергенция: цена сделала более высокий максимум на {swing}, а RSI — более низкий, и теперь свеча закрылась ниже {trigger}.'),
('STRAT_RSIDIV_WAIT','ko','최근 마감 캔들에서 새로운 트리거 캔들이 있는 RSI 다이버전스가 없습니다.'),
('STRAT_RSIDIV_WAIT','zh','最近的已收盘K线上没有带新触发K线的RSI背离。'),
('STRAT_RSIDIV_WAIT','ru','На последних закрытых свечах нет дивергенции RSI со свежей триггерной свечой.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('STRAT_RSIDIV_NAME','ko','RSI 다이버전스'),
('STRAT_RSIDIV_NAME','zh','RSI 背离'),
('STRAT_RSIDIV_NAME','ru','Дивергенция RSI'),
('STRAT_RSIDIV_DESC','ko','가격과 RSI가 엇갈리는 모습을 찾습니다. 가격은 저점을 낮추는데 RSI는 저점을 높이거나(매도세 약화), 가격은 고점을 높이는데 RSI는 고점을 낮추는 경우(매수세 약화)입니다. 이것만으로는 신호가 아니므로, 스윙 캔들을 되돌파해 마감하는 첫 캔들(매수는 고점 위, 매도는 저점 아래)을 기다립니다. 그 전에 가격이 새 극값을 만들면 다이버전스는 무효입니다. 마감된 캔들만 사용합니다.'),
('STRAT_RSIDIV_DESC','zh','寻找价格与RSI背离：价格创出更低的低点而RSI创出更高的低点（卖压减弱），或价格创出更高的高点而RSI创出更低的高点（买压减弱）。仅此并非信号，因此要等待第一根收盘回穿该波段K线的K线（买入为收盘在其最高价之上，卖出为收盘在其最低价之下）。若价格先创出新极值，背离即告失效。仅使用已收盘K线。'),
('STRAT_RSIDIV_DESC','ru','Ищет расхождение цены и RSI: цена делает более низкий минимум, а RSI — более высокий (продавцы слабеют), или цена делает более высокий максимум, а RSI — более низкий (покупатели слабеют). Одного этого мало, поэтому ждёт первую свечу, закрывшуюся обратно через свинговую свечу (выше её максимума для покупки, ниже минимума для продажи). Если цена раньше обновит экстремум, дивергенция отменяется. Только закрытые свечи.'),
('STRAT_RSIDIV_BUY','ko','강세 다이버전스: 가격은 {swing}에서 저점을 낮췄지만 RSI는 저점을 높였고, 이제 캔들이 {trigger} 위에서 마감했습니다.'),
('STRAT_RSIDIV_BUY','zh','看涨背离：价格在 {swing} 创出更低的低点而RSI创出更高的低点，现在有K线收盘在 {trigger} 之上。'),
('STRAT_RSIDIV_BUY','ru','Бычья дивергенция: цена сделала более низкий минимум на {swing}, а RSI — более высокий, и теперь свеча закрылась выше {trigger}.'),
('STRAT_RSIDIV_SELL','ko','약세 다이버전스: 가격은 {swing}에서 고점을 높였지만 RSI는 고점을 낮췄고, 이제 캔들이 {trigger} 아래에서 마감했습니다.'),
('STRAT_RSIDIV_SELL','zh','看跌背离：价格在 {swing} 创出更高的高点而RSI创出更低的高点，现在有K线收盘在 {trigger} 之下。'),
('STRAT_RSIDIV_SELL','ru','Медвежья дивергенция: цена сделала более высокий максимум на {swing}, а RSI — более низкий, и теперь свеча закрылась ниже {trigger}.'),
('STRAT_RSIDIV_WAIT','ko','최근 마감 캔들에서 새로운 트리거 캔들이 있는 RSI 다이버전스가 없습니다.'),
('STRAT_RSIDIV_WAIT','zh','最近的已收盘K线上没有带新触发K线的RSI背离。'),
('STRAT_RSIDIV_WAIT','ru','На последних закрытых свечах нет дивергенции RSI со свежей триггерной свечой.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
