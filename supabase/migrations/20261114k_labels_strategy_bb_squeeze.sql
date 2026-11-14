-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso by PM/DevOps with the release; DEV on wdtjhrilakoitfcezxpx.
--
-- Labels for Arena strategy 5, Bollinger squeeze breakout. English ships in lib/labelDefaults.en.json and needs no row. ko/zh/ru AI-drafted (owner ruling 2026-11-13). Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('STRAT_BBSQ_NAME','ko','볼린저 스퀴즈 돌파'),
('STRAT_BBSQ_NAME','zh','布林带挤压突破'),
('STRAT_BBSQ_NAME','ru','Пробой сжатия Боллинджера'),
('STRAT_BBSQ_DESC','ko','볼린저 밴드가 평소보다 크게 좁아진 상태(최근 100개 캔들 중 가장 조용한 5분의 1) 뒤에, 밴드 밖에서 처음 마감하는 캔들을 찾습니다. 상단 밴드 위 마감은 매수, 하단 밴드 아래 마감은 매도입니다. 스퀴즈는 가격이 조용했다는 뜻일 뿐 어느 쪽으로 벗어날지는 알려주지 않습니다. 마감된 캔들만 사용합니다.'),
('STRAT_BBSQ_DESC','zh','寻找布林带异常收窄（最近100根K线中最安静的五分之一）之后，第一根收盘在带外的K线。收盘在上轨之上为买入，在下轨之下为卖出。挤压只说明价格此前很安静，并不说明会向哪边突破。仅使用已收盘K线。'),
('STRAT_BBSQ_DESC','ru','Ищет необычно узкие полосы Боллинджера (самая тихая пятая часть из последних 100 свечей), а затем первую свечу, закрывшуюся за полосой. Закрытие выше верхней полосы — покупка, ниже нижней — продажа. Сжатие говорит лишь о тишине, а не о направлении выхода. Только закрытые свечи.'),
('STRAT_BBSQ_BUY','ko','밴드가 좁았던 캔들 {countSqueeze}개 뒤에 가격이 상단 밴드({band}) 위에서 마감했습니다.'),
('STRAT_BBSQ_BUY','zh','在 {countSqueeze} 根窄带K线之后，价格收盘在上轨（{band}）之上。'),
('STRAT_BBSQ_BUY','ru','После {countSqueeze} свечей с узкими полосами цена закрылась выше верхней полосы ({band}).'),
('STRAT_BBSQ_SELL','ko','밴드가 좁았던 캔들 {countSqueeze}개 뒤에 가격이 하단 밴드({band}) 아래에서 마감했습니다.'),
('STRAT_BBSQ_SELL','zh','在 {countSqueeze} 根窄带K线之后，价格收盘在下轨（{band}）之下。'),
('STRAT_BBSQ_SELL','ru','После {countSqueeze} свечей с узкими полосами цена закрылась ниже нижней полосы ({band}).'),
('STRAT_BBSQ_WAIT','ko','최근 마감 캔들에서 스퀴즈 뒤 볼린저 밴드 밖으로 새로 마감한 캔들이 없습니다.'),
('STRAT_BBSQ_WAIT','zh','最近的已收盘K线上，挤压之后没有新的收盘在布林带之外。'),
('STRAT_BBSQ_WAIT','ru','На последних закрытых свечах нет свежего закрытия за полосами Боллинджера после сжатия.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('STRAT_BBSQ_NAME','ko','볼린저 스퀴즈 돌파'),
('STRAT_BBSQ_NAME','zh','布林带挤压突破'),
('STRAT_BBSQ_NAME','ru','Пробой сжатия Боллинджера'),
('STRAT_BBSQ_DESC','ko','볼린저 밴드가 평소보다 크게 좁아진 상태(최근 100개 캔들 중 가장 조용한 5분의 1) 뒤에, 밴드 밖에서 처음 마감하는 캔들을 찾습니다. 상단 밴드 위 마감은 매수, 하단 밴드 아래 마감은 매도입니다. 스퀴즈는 가격이 조용했다는 뜻일 뿐 어느 쪽으로 벗어날지는 알려주지 않습니다. 마감된 캔들만 사용합니다.'),
('STRAT_BBSQ_DESC','zh','寻找布林带异常收窄（最近100根K线中最安静的五分之一）之后，第一根收盘在带外的K线。收盘在上轨之上为买入，在下轨之下为卖出。挤压只说明价格此前很安静，并不说明会向哪边突破。仅使用已收盘K线。'),
('STRAT_BBSQ_DESC','ru','Ищет необычно узкие полосы Боллинджера (самая тихая пятая часть из последних 100 свечей), а затем первую свечу, закрывшуюся за полосой. Закрытие выше верхней полосы — покупка, ниже нижней — продажа. Сжатие говорит лишь о тишине, а не о направлении выхода. Только закрытые свечи.'),
('STRAT_BBSQ_BUY','ko','밴드가 좁았던 캔들 {countSqueeze}개 뒤에 가격이 상단 밴드({band}) 위에서 마감했습니다.'),
('STRAT_BBSQ_BUY','zh','在 {countSqueeze} 根窄带K线之后，价格收盘在上轨（{band}）之上。'),
('STRAT_BBSQ_BUY','ru','После {countSqueeze} свечей с узкими полосами цена закрылась выше верхней полосы ({band}).'),
('STRAT_BBSQ_SELL','ko','밴드가 좁았던 캔들 {countSqueeze}개 뒤에 가격이 하단 밴드({band}) 아래에서 마감했습니다.'),
('STRAT_BBSQ_SELL','zh','在 {countSqueeze} 根窄带K线之后，价格收盘在下轨（{band}）之下。'),
('STRAT_BBSQ_SELL','ru','После {countSqueeze} свечей с узкими полосами цена закрылась ниже нижней полосы ({band}).'),
('STRAT_BBSQ_WAIT','ko','최근 마감 캔들에서 스퀴즈 뒤 볼린저 밴드 밖으로 새로 마감한 캔들이 없습니다.'),
('STRAT_BBSQ_WAIT','zh','最近的已收盘K线上，挤压之后没有新的收盘在布林带之外。'),
('STRAT_BBSQ_WAIT','ru','На последних закрытых свечах нет свежего закрытия за полосами Боллинджера после сжатия.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
