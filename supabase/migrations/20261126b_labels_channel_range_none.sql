-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- Channel breakout and range bounce SAY so when they find no channel / no range (QA drawings audit, #1263, 2026-11-20: a bare "No close outside a channel yet." / "No bounce from a range edge." with nothing drawn).
-- en equals lib/labelDefaults.en.json; ko/zh/ru/ar are AI-drafted and not native-reviewed. Upserts by (key, locale).

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('STRAT_CHANNEL_WAIT_NONE','en','No channel found on the last candles.'),
('STRAT_CHANNEL_WAIT_NONE','ko','최근 캔들에서 채널이 발견되지 않았습니다.'),
('STRAT_CHANNEL_WAIT_NONE','zh','最近的K线中未发现通道。'),
('STRAT_CHANNEL_WAIT_NONE','ru','На последних свечах канал не найден.'),
('STRAT_CHANNEL_WAIT_NONE','ar','لم يتم العثور على قناة في الشموع الأخيرة.'),
('STRAT_RANGE_WAIT_NONE','en','No range found: price is not moving inside a narrow band.'),
('STRAT_RANGE_WAIT_NONE','ko','박스권이 없습니다: 가격이 좁은 구간 안에서 움직이지 않습니다.'),
('STRAT_RANGE_WAIT_NONE','zh','未发现区间：价格没有在窄幅区间内运行。'),
('STRAT_RANGE_WAIT_NONE','ru','Диапазон не найден: цена не движется в узкой полосе.'),
('STRAT_RANGE_WAIT_NONE','ar','لم يتم العثور على نطاق: السعر لا يتحرك داخل نطاق ضيق.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('STRAT_CHANNEL_WAIT_NONE','en','No channel found on the last candles.'),
('STRAT_CHANNEL_WAIT_NONE','ko','최근 캔들에서 채널이 발견되지 않았습니다.'),
('STRAT_CHANNEL_WAIT_NONE','zh','最近的K线中未发现通道。'),
('STRAT_CHANNEL_WAIT_NONE','ru','На последних свечах канал не найден.'),
('STRAT_CHANNEL_WAIT_NONE','ar','لم يتم العثور على قناة في الشموع الأخيرة.'),
('STRAT_RANGE_WAIT_NONE','en','No range found: price is not moving inside a narrow band.'),
('STRAT_RANGE_WAIT_NONE','ko','박스권이 없습니다: 가격이 좁은 구간 안에서 움직이지 않습니다.'),
('STRAT_RANGE_WAIT_NONE','zh','未发现区间：价格没有在窄幅区间内运行。'),
('STRAT_RANGE_WAIT_NONE','ru','Диапазон не найден: цена не движется в узкой полосе.'),
('STRAT_RANGE_WAIT_NONE','ar','لم يتم العثور على نطاق: السعر لا يتحرك داخل نطاق ضيق.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
