-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso by PM/DevOps with the release; DEV on wdtjhrilakoitfcezxpx.
--
-- Labels for Arena strategy 4, supply / demand zone retest with a BTC check. English ships in lib/labelDefaults.en.json and needs no row. ko/zh/ru AI-drafted (owner ruling 2026-11-13). Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('STRAT_SD_NAME','ko','공급 / 수요 구간 재테스트'),
('STRAT_SD_NAME','zh','供给 / 需求区重测'),
('STRAT_SD_NAME','ru','Ретест зоны спроса / предложения'),
('STRAT_SD_DESC','ko','작은 기준 캔들에서 강하고 빠르게 벗어나는 움직임을 찾아, 상승 뒤에는 수요 구간, 하락 뒤에는 공급 구간을 만듭니다. 가격이 처음 그 구간으로 돌아왔다가 캔들이 다시 구간 밖에서 마감하면 신호입니다. BTC가 아닌 코인은 같은 시간대에서 BTC가 50 평균선의 같은 쪽에 있어야 하며, 아니면 대기합니다. 마감된 캔들만 사용합니다.'),
('STRAT_SD_DESC','zh','寻找从一根小的基准K线快速强劲离开的走势，上涨后留下需求区，下跌后留下供给区。价格第一次回到该区域、且一根K线收盘回到区域之外时即为信号。对于BTC以外的币种，BTC在同一周期上必须位于其50均线的同一侧，否则等待。仅使用已收盘K线。'),
('STRAT_SD_DESC','ru','Находит сильное быстрое движение от небольшой базовой свечи: после роста остаётся зона спроса, после падения — зона предложения. Первый возврат цены в зону с закрытием свечи обратно за её пределами — сигнал. Для монет, кроме BTC, BTC на том же таймфрейме должен быть по ту же сторону от своей 50-й средней, иначе — ждать. Только закрытые свечи.'),
('STRAT_SD_BUY','ko','가격이 수요 구간 {zoneLo}~{zoneHi}로 처음 돌아왔다가 그 위에서 다시 마감했습니다.'),
('STRAT_SD_BUY','zh','价格首次回到需求区 {zoneLo} 至 {zoneHi}，并收盘回到其上方。'),
('STRAT_SD_BUY','ru','Цена впервые вернулась в зону спроса {zoneLo}–{zoneHi} и закрылась обратно выше неё.'),
('STRAT_SD_SELL','ko','가격이 공급 구간 {zoneLo}~{zoneHi}로 처음 돌아왔다가 그 아래에서 다시 마감했습니다.'),
('STRAT_SD_SELL','zh','价格首次回到供给区 {zoneLo} 至 {zoneHi}，并收盘回到其下方。'),
('STRAT_SD_SELL','ru','Цена впервые вернулась в зону предложения {zoneLo}–{zoneHi} и закрылась обратно ниже неё.'),
('STRAT_SD_BUY_BTC','ko','가격이 수요 구간 {zoneLo}~{zoneHi}로 처음 돌아왔다가 그 위에서 다시 마감했습니다. BTC가 50 평균선 위에 있어 방향이 일치합니다.'),
('STRAT_SD_BUY_BTC','zh','价格首次回到需求区 {zoneLo} 至 {zoneHi}，并收盘回到其上方。BTC位于其50均线之上，方向一致。'),
('STRAT_SD_BUY_BTC','ru','Цена впервые вернулась в зону спроса {zoneLo}–{zoneHi} и закрылась обратно выше неё. BTC выше своей 50-й средней, так что он согласен.'),
('STRAT_SD_SELL_BTC','ko','가격이 공급 구간 {zoneLo}~{zoneHi}로 처음 돌아왔다가 그 아래에서 다시 마감했습니다. BTC가 50 평균선 아래에 있어 방향이 일치합니다.'),
('STRAT_SD_SELL_BTC','zh','价格首次回到供给区 {zoneLo} 至 {zoneHi}，并收盘回到其下方。BTC位于其50均线之下，方向一致。'),
('STRAT_SD_SELL_BTC','ru','Цена впервые вернулась в зону предложения {zoneLo}–{zoneHi} и закрылась обратно ниже неё. BTC ниже своей 50-й средней, так что он согласен.'),
('STRAT_SD_WAIT_BTC','ko','가격이 구간({zoneLo}~{zoneHi})을 재테스트했지만 BTC가 50 평균선의 반대쪽에 있어 진입 신호가 없습니다.'),
('STRAT_SD_WAIT_BTC','zh','价格重测了一个区域（{zoneLo} 至 {zoneHi}），但BTC位于其50均线的另一侧，因此没有入场信号。'),
('STRAT_SD_WAIT_BTC','ru','Цена ретестировала зону ({zoneLo}–{zoneHi}), но BTC по другую сторону от своей 50-й средней, поэтому входа нет.'),
('STRAT_SD_WAIT','ko','최근 마감 캔들에서 새로운 공급 또는 수요 구간의 첫 재테스트가 없습니다.'),
('STRAT_SD_WAIT','zh','最近的已收盘K线上没有新的供给或需求区的首次重测。'),
('STRAT_SD_WAIT','ru','На последних закрытых свечах нет первого ретеста свежей зоны предложения или спроса.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('STRAT_SD_NAME','ko','공급 / 수요 구간 재테스트'),
('STRAT_SD_NAME','zh','供给 / 需求区重测'),
('STRAT_SD_NAME','ru','Ретест зоны спроса / предложения'),
('STRAT_SD_DESC','ko','작은 기준 캔들에서 강하고 빠르게 벗어나는 움직임을 찾아, 상승 뒤에는 수요 구간, 하락 뒤에는 공급 구간을 만듭니다. 가격이 처음 그 구간으로 돌아왔다가 캔들이 다시 구간 밖에서 마감하면 신호입니다. BTC가 아닌 코인은 같은 시간대에서 BTC가 50 평균선의 같은 쪽에 있어야 하며, 아니면 대기합니다. 마감된 캔들만 사용합니다.'),
('STRAT_SD_DESC','zh','寻找从一根小的基准K线快速强劲离开的走势，上涨后留下需求区，下跌后留下供给区。价格第一次回到该区域、且一根K线收盘回到区域之外时即为信号。对于BTC以外的币种，BTC在同一周期上必须位于其50均线的同一侧，否则等待。仅使用已收盘K线。'),
('STRAT_SD_DESC','ru','Находит сильное быстрое движение от небольшой базовой свечи: после роста остаётся зона спроса, после падения — зона предложения. Первый возврат цены в зону с закрытием свечи обратно за её пределами — сигнал. Для монет, кроме BTC, BTC на том же таймфрейме должен быть по ту же сторону от своей 50-й средней, иначе — ждать. Только закрытые свечи.'),
('STRAT_SD_BUY','ko','가격이 수요 구간 {zoneLo}~{zoneHi}로 처음 돌아왔다가 그 위에서 다시 마감했습니다.'),
('STRAT_SD_BUY','zh','价格首次回到需求区 {zoneLo} 至 {zoneHi}，并收盘回到其上方。'),
('STRAT_SD_BUY','ru','Цена впервые вернулась в зону спроса {zoneLo}–{zoneHi} и закрылась обратно выше неё.'),
('STRAT_SD_SELL','ko','가격이 공급 구간 {zoneLo}~{zoneHi}로 처음 돌아왔다가 그 아래에서 다시 마감했습니다.'),
('STRAT_SD_SELL','zh','价格首次回到供给区 {zoneLo} 至 {zoneHi}，并收盘回到其下方。'),
('STRAT_SD_SELL','ru','Цена впервые вернулась в зону предложения {zoneLo}–{zoneHi} и закрылась обратно ниже неё.'),
('STRAT_SD_BUY_BTC','ko','가격이 수요 구간 {zoneLo}~{zoneHi}로 처음 돌아왔다가 그 위에서 다시 마감했습니다. BTC가 50 평균선 위에 있어 방향이 일치합니다.'),
('STRAT_SD_BUY_BTC','zh','价格首次回到需求区 {zoneLo} 至 {zoneHi}，并收盘回到其上方。BTC位于其50均线之上，方向一致。'),
('STRAT_SD_BUY_BTC','ru','Цена впервые вернулась в зону спроса {zoneLo}–{zoneHi} и закрылась обратно выше неё. BTC выше своей 50-й средней, так что он согласен.'),
('STRAT_SD_SELL_BTC','ko','가격이 공급 구간 {zoneLo}~{zoneHi}로 처음 돌아왔다가 그 아래에서 다시 마감했습니다. BTC가 50 평균선 아래에 있어 방향이 일치합니다.'),
('STRAT_SD_SELL_BTC','zh','价格首次回到供给区 {zoneLo} 至 {zoneHi}，并收盘回到其下方。BTC位于其50均线之下，方向一致。'),
('STRAT_SD_SELL_BTC','ru','Цена впервые вернулась в зону предложения {zoneLo}–{zoneHi} и закрылась обратно ниже неё. BTC ниже своей 50-й средней, так что он согласен.'),
('STRAT_SD_WAIT_BTC','ko','가격이 구간({zoneLo}~{zoneHi})을 재테스트했지만 BTC가 50 평균선의 반대쪽에 있어 진입 신호가 없습니다.'),
('STRAT_SD_WAIT_BTC','zh','价格重测了一个区域（{zoneLo} 至 {zoneHi}），但BTC位于其50均线的另一侧，因此没有入场信号。'),
('STRAT_SD_WAIT_BTC','ru','Цена ретестировала зону ({zoneLo}–{zoneHi}), но BTC по другую сторону от своей 50-й средней, поэтому входа нет.'),
('STRAT_SD_WAIT','ko','최근 마감 캔들에서 새로운 공급 또는 수요 구간의 첫 재테스트가 없습니다.'),
('STRAT_SD_WAIT','zh','最近的已收盘K线上没有新的供给或需求区的首次重测。'),
('STRAT_SD_WAIT','ru','На последних закрытых свечах нет первого ретеста свежей зоны предложения или спроса.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
