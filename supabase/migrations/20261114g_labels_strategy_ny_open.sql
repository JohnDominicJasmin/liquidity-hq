-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso by PM/DevOps with the release; DEV on wdtjhrilakoitfcezxpx (shared by dev/qa/staging).
--
-- Labels for Arena strategy 2, New York open breakout. English ships in lib/labelDefaults.en.json and needs no row. ko/zh/ru are AI-drafted and not native-reviewed (owner ruling 2026-11-13). Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('STRAT_NYOPEN_NAME','ko','뉴욕 장 시작 돌파'),
('STRAT_NYOPEN_NAME','zh','纽约开盘突破'),
('STRAT_NYOPEN_NAME','ru','Пробой открытия Нью-Йорка'),
('STRAT_NYOPEN_DESC','ko','뉴욕 장 시작(뉴욕 시간 09:30, 서머타임에 따라 UTC 13:30 또는 14:30) 후 처음 30분의 고점과 저점을 표시하고, 그 범위 밖에서 처음 마감하는 캔들을 찾습니다. 5분, 15분, 30분 차트에서 작동합니다.'),
('STRAT_NYOPEN_DESC','zh','标记纽约开盘（纽约时间09:30，按夏令时为UTC 13:30或14:30）后前30分钟的高点和低点，然后寻找第一根收盘在该区间之外的K线。适用于5分钟、15分钟和30分钟周期。'),
('STRAT_NYOPEN_DESC','ru','Отмечает максимум и минимум первых 30 минут после открытия Нью-Йорка (09:30 по нью-йоркскому времени, то есть 13:30 или 14:30 UTC в зависимости от перехода на летнее время) и ищет первую свечу, закрывшуюся за пределами диапазона. Работает на 5м, 15м и 30м.'),
('STRAT_NYOPEN_BUY','ko','뉴욕 시초 범위 고점 {hi}(저점 {lo}) 위로 처음 마감했습니다.'),
('STRAT_NYOPEN_BUY','zh','首次收盘于纽约开盘区间高点 {hi}（低点 {lo}）之上。'),
('STRAT_NYOPEN_BUY','ru','Первое закрытие выше максимума диапазона открытия Нью-Йорка {hi} (минимум {lo}).'),
('STRAT_NYOPEN_SELL','ko','뉴욕 시초 범위 저점 {lo}(고점 {hi}) 아래로 처음 마감했습니다.'),
('STRAT_NYOPEN_SELL','zh','首次收盘于纽约开盘区间低点 {lo}（高点 {hi}）之下。'),
('STRAT_NYOPEN_SELL','ru','Первое закрытие ниже минимума диапазона открытия Нью-Йорка {lo} (максимум {hi}).'),
('STRAT_NYOPEN_WAIT','ko','지금은 뉴욕 시초 범위의 새로운 첫 돌파가 없습니다. 5분, 15분 또는 30분 차트와, 장 시작 후 첫 30분이 마감되어야 합니다.'),
('STRAT_NYOPEN_WAIT','zh','目前没有纽约开盘区间的新首次突破。需要5分钟、15分钟或30分钟图表，且开盘后前30分钟已收盘。'),
('STRAT_NYOPEN_WAIT','ru','Сейчас нет свежего первого пробоя диапазона открытия Нью-Йорка. Нужен график 5м, 15м или 30м и закрытые первые 30 минут после открытия.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('STRAT_NYOPEN_NAME','ko','뉴욕 장 시작 돌파'),
('STRAT_NYOPEN_NAME','zh','纽约开盘突破'),
('STRAT_NYOPEN_NAME','ru','Пробой открытия Нью-Йорка'),
('STRAT_NYOPEN_DESC','ko','뉴욕 장 시작(뉴욕 시간 09:30, 서머타임에 따라 UTC 13:30 또는 14:30) 후 처음 30분의 고점과 저점을 표시하고, 그 범위 밖에서 처음 마감하는 캔들을 찾습니다. 5분, 15분, 30분 차트에서 작동합니다.'),
('STRAT_NYOPEN_DESC','zh','标记纽约开盘（纽约时间09:30，按夏令时为UTC 13:30或14:30）后前30分钟的高点和低点，然后寻找第一根收盘在该区间之外的K线。适用于5分钟、15分钟和30分钟周期。'),
('STRAT_NYOPEN_DESC','ru','Отмечает максимум и минимум первых 30 минут после открытия Нью-Йорка (09:30 по нью-йоркскому времени, то есть 13:30 или 14:30 UTC в зависимости от перехода на летнее время) и ищет первую свечу, закрывшуюся за пределами диапазона. Работает на 5м, 15м и 30м.'),
('STRAT_NYOPEN_BUY','ko','뉴욕 시초 범위 고점 {hi}(저점 {lo}) 위로 처음 마감했습니다.'),
('STRAT_NYOPEN_BUY','zh','首次收盘于纽约开盘区间高点 {hi}（低点 {lo}）之上。'),
('STRAT_NYOPEN_BUY','ru','Первое закрытие выше максимума диапазона открытия Нью-Йорка {hi} (минимум {lo}).'),
('STRAT_NYOPEN_SELL','ko','뉴욕 시초 범위 저점 {lo}(고점 {hi}) 아래로 처음 마감했습니다.'),
('STRAT_NYOPEN_SELL','zh','首次收盘于纽约开盘区间低点 {lo}（高点 {hi}）之下。'),
('STRAT_NYOPEN_SELL','ru','Первое закрытие ниже минимума диапазона открытия Нью-Йорка {lo} (максимум {hi}).'),
('STRAT_NYOPEN_WAIT','ko','지금은 뉴욕 시초 범위의 새로운 첫 돌파가 없습니다. 5분, 15분 또는 30분 차트와, 장 시작 후 첫 30분이 마감되어야 합니다.'),
('STRAT_NYOPEN_WAIT','zh','目前没有纽约开盘区间的新首次突破。需要5分钟、15分钟或30分钟图表，且开盘后前30分钟已收盘。'),
('STRAT_NYOPEN_WAIT','ru','Сейчас нет свежего первого пробоя диапазона открытия Нью-Йорка. Нужен график 5м, 15м или 30м и закрытые первые 30 минут после открытия.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
