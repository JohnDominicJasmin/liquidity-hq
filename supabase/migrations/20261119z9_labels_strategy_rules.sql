-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- Strategies follow their written rules (PM 2026-11-19). 5 keys x 5 locales; en equals the shipped defaults. ko/zh/ru/ar AI-drafted, not native-reviewed.
--   STRAT_FLIP_DESC / STRAT_FVG_DESC / STRAT_BOS_FVG_DESC / STRAT_CHANNEL_DESC / STRAT_RANGE_DESC  changed: each one-line description now states the tightened rule.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('STRAT_FLIP_DESC','en','A chart level broken by 0.1 ATR, retested 4+ candles later from the other side.'),
('STRAT_FLIP_DESC','ko','차트 수준을 0.1 ATR 이상 돌파한 뒤, 4캔들 이상 지나 반대편에서 재테스트.'),
('STRAT_FLIP_DESC','zh','图表价位被突破 0.1 ATR 以上，4 根 K 线之后从另一侧回测。'),
('STRAT_FLIP_DESC','ru','Уровень на графике пробит на 0,1 ATR, ретест с другой стороны не раньше чем через 4 свечи.'),
('STRAT_FLIP_DESC','ar','مستوى على الرسم اخترق بمقدار 0.1 ATR ثم أعيد اختباره من الجانب الآخر بعد 4 شموع أو أكثر.'),
('STRAT_FVG_DESC','en','First return into an unfilled gap of at least 0.5 ATR.'),
('STRAT_FVG_DESC','ko','0.5 ATR 이상의 채워지지 않은 갭으로 처음 되돌아옴.'),
('STRAT_FVG_DESC','zh','首次回到至少 0.5 ATR 的未回补缺口。'),
('STRAT_FVG_DESC','ru','Первый возврат в незаполненный гэп не менее 0,5 ATR.'),
('STRAT_FVG_DESC','ar','أول عودة إلى فجوة غير مملوءة لا تقل عن 0.5 ATR.'),
('STRAT_BOS_FVG_DESC','en','First return into a gap nothing touched before the break. Built for 5m–15m.'),
('STRAT_BOS_FVG_DESC','ko','돌파 전에 아무도 건드리지 않은 갭으로 처음 되돌아옴. 5분–15분용.'),
('STRAT_BOS_FVG_DESC','zh','首次回到突破前未被触及的缺口。适用于 5 分钟–15 分钟。'),
('STRAT_BOS_FVG_DESC','ru','Первый возврат в гэп, которого ничто не касалось до пробоя. Для 5м–15м.'),
('STRAT_BOS_FVG_DESC','ar','أول عودة إلى فجوة لم يلمسها شيء قبل الاختراق. مخصصة لـ 5د–15د.'),
('STRAT_CHANNEL_DESC','en','First close outside a channel whose broken rail has 3+ pivots.'),
('STRAT_CHANNEL_DESC','ko','돌파된 선에 피벗이 3개 이상인 채널을 처음 벗어나 마감.'),
('STRAT_CHANNEL_DESC','zh','首次收盘于通道之外，被突破的轨道至少有 3 个枢轴点。'),
('STRAT_CHANNEL_DESC','ru','Первое закрытие вне канала, у пробитой границы 3+ опорных точки.'),
('STRAT_CHANNEL_DESC','ar','أول إغلاق خارج قناة يحتوي حدّها المخترق على 3 نقاط ارتكاز أو أكثر.'),
('STRAT_RANGE_DESC','en','A touch of a range edge that closes back inside. Range: 30 candles within 4 ATR.'),
('STRAT_RANGE_DESC','ko','박스권 가장자리를 터치하고 다시 안쪽으로 마감. 박스권: 4 ATR 이내의 30캔들.'),
('STRAT_RANGE_DESC','zh','触及区间边缘后收回区间内。区间：4 ATR 以内的 30 根 K 线。'),
('STRAT_RANGE_DESC','ru','Касание границы диапазона с закрытием внутри. Диапазон: 30 свечей в пределах 4 ATR.'),
('STRAT_RANGE_DESC','ar','لمس حافة نطاق ثم إغلاق داخله. النطاق: 30 شمعة ضمن 4 ATR.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('STRAT_FLIP_DESC','en','A chart level broken by 0.1 ATR, retested 4+ candles later from the other side.'),
('STRAT_FLIP_DESC','ko','차트 수준을 0.1 ATR 이상 돌파한 뒤, 4캔들 이상 지나 반대편에서 재테스트.'),
('STRAT_FLIP_DESC','zh','图表价位被突破 0.1 ATR 以上，4 根 K 线之后从另一侧回测。'),
('STRAT_FLIP_DESC','ru','Уровень на графике пробит на 0,1 ATR, ретест с другой стороны не раньше чем через 4 свечи.'),
('STRAT_FLIP_DESC','ar','مستوى على الرسم اخترق بمقدار 0.1 ATR ثم أعيد اختباره من الجانب الآخر بعد 4 شموع أو أكثر.'),
('STRAT_FVG_DESC','en','First return into an unfilled gap of at least 0.5 ATR.'),
('STRAT_FVG_DESC','ko','0.5 ATR 이상의 채워지지 않은 갭으로 처음 되돌아옴.'),
('STRAT_FVG_DESC','zh','首次回到至少 0.5 ATR 的未回补缺口。'),
('STRAT_FVG_DESC','ru','Первый возврат в незаполненный гэп не менее 0,5 ATR.'),
('STRAT_FVG_DESC','ar','أول عودة إلى فجوة غير مملوءة لا تقل عن 0.5 ATR.'),
('STRAT_BOS_FVG_DESC','en','First return into a gap nothing touched before the break. Built for 5m–15m.'),
('STRAT_BOS_FVG_DESC','ko','돌파 전에 아무도 건드리지 않은 갭으로 처음 되돌아옴. 5분–15분용.'),
('STRAT_BOS_FVG_DESC','zh','首次回到突破前未被触及的缺口。适用于 5 分钟–15 分钟。'),
('STRAT_BOS_FVG_DESC','ru','Первый возврат в гэп, которого ничто не касалось до пробоя. Для 5м–15м.'),
('STRAT_BOS_FVG_DESC','ar','أول عودة إلى فجوة لم يلمسها شيء قبل الاختراق. مخصصة لـ 5د–15د.'),
('STRAT_CHANNEL_DESC','en','First close outside a channel whose broken rail has 3+ pivots.'),
('STRAT_CHANNEL_DESC','ko','돌파된 선에 피벗이 3개 이상인 채널을 처음 벗어나 마감.'),
('STRAT_CHANNEL_DESC','zh','首次收盘于通道之外，被突破的轨道至少有 3 个枢轴点。'),
('STRAT_CHANNEL_DESC','ru','Первое закрытие вне канала, у пробитой границы 3+ опорных точки.'),
('STRAT_CHANNEL_DESC','ar','أول إغلاق خارج قناة يحتوي حدّها المخترق على 3 نقاط ارتكاز أو أكثر.'),
('STRAT_RANGE_DESC','en','A touch of a range edge that closes back inside. Range: 30 candles within 4 ATR.'),
('STRAT_RANGE_DESC','ko','박스권 가장자리를 터치하고 다시 안쪽으로 마감. 박스권: 4 ATR 이내의 30캔들.'),
('STRAT_RANGE_DESC','zh','触及区间边缘后收回区间内。区间：4 ATR 以内的 30 根 K 线。'),
('STRAT_RANGE_DESC','ru','Касание границы диапазона с закрытием внутри. Диапазон: 30 свечей в пределах 4 ATR.'),
('STRAT_RANGE_DESC','ar','لمس حافة نطاق ثم إغلاق داخله. النطاق: 30 شمعة ضمن 4 ATR.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
