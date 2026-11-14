-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso by PM/DevOps with the release; DEV on wdtjhrilakoitfcezxpx.
--
-- EMA stack strategy, pullback trigger (owner: trade with the stack, enter on the pullback to the 20 or 50). Applies AFTER 20261114h: it REPLACES the description and wait sentence
-- from that file and adds the two pullback reasons. English ships in lib/labelDefaults.en.json. ko/zh/ru AI-drafted (owner ruling 2026-11-13). Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('STRAT_EMASTACK_DESC','ko','네 이동평균선이 순서대로 정렬되어 있을 때(상승은 20이 50 위, 50이 100 위, 100이 200 위, 하락은 그 반대) 추세 방향으로 거래합니다. 주된 신호는 눌림목입니다: 가격이 20선 또는 50선까지 내려갔다가 캔들이 20선의 추세 쪽에서 다시 마감합니다. 네 선이 막 정렬된 직후의 첫 캔들도 해당하며, 근거에 어느 쪽인지 표시됩니다. 마감된 캔들만 사용합니다.'),
('STRAT_EMASTACK_DESC','zh','当四条均线按顺序排列时顺势交易（上涨为20在50之上、50在100之上、100在200之上，下跌则相反）。主要信号是回调：价格回落到20或50均线，随后K线收盘回到20均线的趋势一侧。四条均线刚排列好后的最初几根K线也算，理由中会说明触发的是哪一种。仅使用已收盘K线。'),
('STRAT_EMASTACK_DESC','ru','Торгует по тренду, когда четыре скользящие средние выстроены по порядку (20 выше 50, выше 100, выше 200 для роста, наоборот для падения). Основной сигнал — откат: цена опускается к 20-й или 50-й, и свеча закрывается обратно на стороне тренда относительно 20-й. Свежее выстраивание, первые свечи после него, тоже считается, и в причине указано, что сработало. Только закрытые свечи.'),
('STRAT_EMASTACK_WAIT','ko','지금은 진입 신호가 없습니다. 네 이동평균선이 섞여 있거나, 정렬되어 있지만 가격이 20선 또는 50선까지 눌린 뒤 추세 쪽으로 다시 마감하지 않았습니다.'),
('STRAT_EMASTACK_WAIT','zh','目前没有入场信号。四条均线交错，或已排列但价格尚未回调到20或50均线并收盘回到趋势一侧。'),
('STRAT_EMASTACK_WAIT','ru','Сейчас входа нет. Четыре средние перемешаны, либо выстроены, но цена не откатывалась к 20-й или 50-й с закрытием обратно на стороне тренда.'),
('STRAT_EMASTACK_BUY_PULLBACK','ko','상승 정렬에서의 눌림목: 가격이 {tag}선까지 내려갔다가 20선({ema20}) 위에서 다시 마감했습니다. 평균선: 50 {ema50}, 100 {ema100}, 200 {ema200}.'),
('STRAT_EMASTACK_BUY_PULLBACK','zh','上涨排列中的回调：价格回落到{tag}均线后收盘回到20均线（{ema20}）之上。均线：50为{ema50}，100为{ema100}，200为{ema200}。'),
('STRAT_EMASTACK_BUY_PULLBACK','ru','Откат в растущем стеке: цена опустилась к {tag}-й и закрылась обратно выше 20-й ({ema20}). Средние: 50 — {ema50}, 100 — {ema100}, 200 — {ema200}.'),
('STRAT_EMASTACK_SELL_PULLBACK','ko','하락 정렬에서의 눌림목: 가격이 {tag}선까지 올랐다가 20선({ema20}) 아래에서 다시 마감했습니다. 평균선: 50 {ema50}, 100 {ema100}, 200 {ema200}.'),
('STRAT_EMASTACK_SELL_PULLBACK','zh','下跌排列中的回调：价格反弹到{tag}均线后收盘回到20均线（{ema20}）之下。均线：50为{ema50}，100为{ema100}，200为{ema200}。'),
('STRAT_EMASTACK_SELL_PULLBACK','ru','Откат в падающем стеке: цена поднялась к {tag}-й и закрылась обратно ниже 20-й ({ema20}). Средние: 50 — {ema50}, 100 — {ema100}, 200 — {ema200}.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('STRAT_EMASTACK_DESC','ko','네 이동평균선이 순서대로 정렬되어 있을 때(상승은 20이 50 위, 50이 100 위, 100이 200 위, 하락은 그 반대) 추세 방향으로 거래합니다. 주된 신호는 눌림목입니다: 가격이 20선 또는 50선까지 내려갔다가 캔들이 20선의 추세 쪽에서 다시 마감합니다. 네 선이 막 정렬된 직후의 첫 캔들도 해당하며, 근거에 어느 쪽인지 표시됩니다. 마감된 캔들만 사용합니다.'),
('STRAT_EMASTACK_DESC','zh','当四条均线按顺序排列时顺势交易（上涨为20在50之上、50在100之上、100在200之上，下跌则相反）。主要信号是回调：价格回落到20或50均线，随后K线收盘回到20均线的趋势一侧。四条均线刚排列好后的最初几根K线也算，理由中会说明触发的是哪一种。仅使用已收盘K线。'),
('STRAT_EMASTACK_DESC','ru','Торгует по тренду, когда четыре скользящие средние выстроены по порядку (20 выше 50, выше 100, выше 200 для роста, наоборот для падения). Основной сигнал — откат: цена опускается к 20-й или 50-й, и свеча закрывается обратно на стороне тренда относительно 20-й. Свежее выстраивание, первые свечи после него, тоже считается, и в причине указано, что сработало. Только закрытые свечи.'),
('STRAT_EMASTACK_WAIT','ko','지금은 진입 신호가 없습니다. 네 이동평균선이 섞여 있거나, 정렬되어 있지만 가격이 20선 또는 50선까지 눌린 뒤 추세 쪽으로 다시 마감하지 않았습니다.'),
('STRAT_EMASTACK_WAIT','zh','目前没有入场信号。四条均线交错，或已排列但价格尚未回调到20或50均线并收盘回到趋势一侧。'),
('STRAT_EMASTACK_WAIT','ru','Сейчас входа нет. Четыре средние перемешаны, либо выстроены, но цена не откатывалась к 20-й или 50-й с закрытием обратно на стороне тренда.'),
('STRAT_EMASTACK_BUY_PULLBACK','ko','상승 정렬에서의 눌림목: 가격이 {tag}선까지 내려갔다가 20선({ema20}) 위에서 다시 마감했습니다. 평균선: 50 {ema50}, 100 {ema100}, 200 {ema200}.'),
('STRAT_EMASTACK_BUY_PULLBACK','zh','上涨排列中的回调：价格回落到{tag}均线后收盘回到20均线（{ema20}）之上。均线：50为{ema50}，100为{ema100}，200为{ema200}。'),
('STRAT_EMASTACK_BUY_PULLBACK','ru','Откат в растущем стеке: цена опустилась к {tag}-й и закрылась обратно выше 20-й ({ema20}). Средние: 50 — {ema50}, 100 — {ema100}, 200 — {ema200}.'),
('STRAT_EMASTACK_SELL_PULLBACK','ko','하락 정렬에서의 눌림목: 가격이 {tag}선까지 올랐다가 20선({ema20}) 아래에서 다시 마감했습니다. 평균선: 50 {ema50}, 100 {ema100}, 200 {ema200}.'),
('STRAT_EMASTACK_SELL_PULLBACK','zh','下跌排列中的回调：价格反弹到{tag}均线后收盘回到20均线（{ema20}）之下。均线：50为{ema50}，100为{ema100}，200为{ema200}。'),
('STRAT_EMASTACK_SELL_PULLBACK','ru','Откат в падающем стеке: цена поднялась к {tag}-й и закрылась обратно ниже 20-й ({ema20}). Средние: 50 — {ema50}, 100 — {ema100}, 200 — {ema200}.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
