-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso by PM/DevOps with the release; DEV on wdtjhrilakoitfcezxpx.
--
-- Labels for Arena strategy 6, VWAP reclaim. English ships in lib/labelDefaults.en.json and needs no row. ko/zh/ru AI-drafted (owner ruling 2026-11-13). Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('STRAT_VWAP_NAME','ko','VWAP 회복'),
('STRAT_VWAP_NAME','zh','VWAP 收复'),
('STRAT_VWAP_NAME','ru','Возврат к VWAP'),
('STRAT_VWAP_DESC','ko','00:00 UTC부터의 거래량 가중 평균가인 당일 VWAP을 사용합니다. 가격이 여러 캔들 동안 한쪽에서 마감하다가 반대쪽에서 마감하는 캔들이 나오면, 위로 회복(매수) 또는 아래로 이탈(매도) 신호입니다. 1시간봉 이하에서 작동합니다. 마감된 캔들만 사용합니다.'),
('STRAT_VWAP_DESC','zh','使用当日VWAP，即自UTC 00:00起的成交量加权平均价。价格连续数根K线收盘在一侧后，出现收盘在另一侧的K线，即为收复（回到上方，买入）或失守（回到下方，卖出）。适用于1小时及以下周期。仅使用已收盘K线。'),
('STRAT_VWAP_DESC','ru','Использует дневной VWAP — средневзвешенную по объёму цену с 00:00 UTC. Когда цена несколько свечей закрывалась по одну сторону, а затем свеча закрылась по другую, это возврат (выше — покупка) или потеря (ниже — продажа). Работает на таймфреймах до 1ч. Только закрытые свечи.'),
('STRAT_VWAP_BUY','ko','가격이 VWAP({vwap}) 아래에서 {countBars}번 마감한 뒤 그 위로 다시 마감했습니다.'),
('STRAT_VWAP_BUY','zh','价格在 VWAP（{vwap}）之下连续收盘 {countBars} 次后，收盘回到其上方。'),
('STRAT_VWAP_BUY','ru','Цена закрылась обратно выше дневного VWAP ({vwap}) после {countBars} закрытий ниже него.'),
('STRAT_VWAP_SELL','ko','가격이 VWAP({vwap}) 위에서 {countBars}번 마감한 뒤 그 아래로 다시 마감했습니다.'),
('STRAT_VWAP_SELL','zh','价格在 VWAP（{vwap}）之上连续收盘 {countBars} 次后，收盘回到其下方。'),
('STRAT_VWAP_SELL','ru','Цена закрылась обратно ниже дневного VWAP ({vwap}) после {countBars} закрытий выше него.'),
('STRAT_VWAP_WAIT','ko','최근 마감 캔들에서 당일 VWAP을 새로 교차하지 않았습니다. 1시간봉 이하 시간대와, UTC 하루가 시작된 뒤 최소 6개의 캔들이 필요합니다.'),
('STRAT_VWAP_WAIT','zh','最近的已收盘K线上没有新的穿越当日VWAP。需要1小时或更细的周期，且UTC当日已有至少6根K线。'),
('STRAT_VWAP_WAIT','ru','На последних закрытых свечах нет свежего пересечения дневного VWAP. Нужен таймфрейм 1ч или мельче и не менее 6 свечей с начала дня по UTC.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('STRAT_VWAP_NAME','ko','VWAP 회복'),
('STRAT_VWAP_NAME','zh','VWAP 收复'),
('STRAT_VWAP_NAME','ru','Возврат к VWAP'),
('STRAT_VWAP_DESC','ko','00:00 UTC부터의 거래량 가중 평균가인 당일 VWAP을 사용합니다. 가격이 여러 캔들 동안 한쪽에서 마감하다가 반대쪽에서 마감하는 캔들이 나오면, 위로 회복(매수) 또는 아래로 이탈(매도) 신호입니다. 1시간봉 이하에서 작동합니다. 마감된 캔들만 사용합니다.'),
('STRAT_VWAP_DESC','zh','使用当日VWAP，即自UTC 00:00起的成交量加权平均价。价格连续数根K线收盘在一侧后，出现收盘在另一侧的K线，即为收复（回到上方，买入）或失守（回到下方，卖出）。适用于1小时及以下周期。仅使用已收盘K线。'),
('STRAT_VWAP_DESC','ru','Использует дневной VWAP — средневзвешенную по объёму цену с 00:00 UTC. Когда цена несколько свечей закрывалась по одну сторону, а затем свеча закрылась по другую, это возврат (выше — покупка) или потеря (ниже — продажа). Работает на таймфреймах до 1ч. Только закрытые свечи.'),
('STRAT_VWAP_BUY','ko','가격이 VWAP({vwap}) 아래에서 {countBars}번 마감한 뒤 그 위로 다시 마감했습니다.'),
('STRAT_VWAP_BUY','zh','价格在 VWAP（{vwap}）之下连续收盘 {countBars} 次后，收盘回到其上方。'),
('STRAT_VWAP_BUY','ru','Цена закрылась обратно выше дневного VWAP ({vwap}) после {countBars} закрытий ниже него.'),
('STRAT_VWAP_SELL','ko','가격이 VWAP({vwap}) 위에서 {countBars}번 마감한 뒤 그 아래로 다시 마감했습니다.'),
('STRAT_VWAP_SELL','zh','价格在 VWAP（{vwap}）之上连续收盘 {countBars} 次后，收盘回到其下方。'),
('STRAT_VWAP_SELL','ru','Цена закрылась обратно ниже дневного VWAP ({vwap}) после {countBars} закрытий выше него.'),
('STRAT_VWAP_WAIT','ko','최근 마감 캔들에서 당일 VWAP을 새로 교차하지 않았습니다. 1시간봉 이하 시간대와, UTC 하루가 시작된 뒤 최소 6개의 캔들이 필요합니다.'),
('STRAT_VWAP_WAIT','zh','最近的已收盘K线上没有新的穿越当日VWAP。需要1小时或更细的周期，且UTC当日已有至少6根K线。'),
('STRAT_VWAP_WAIT','ru','На последних закрытых свечах нет свежего пересечения дневного VWAP. Нужен таймфрейм 1ч или мельче и не менее 6 свечей с начала дня по UTC.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
