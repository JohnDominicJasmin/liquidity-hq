-- #1347 item 14. The alerts page describes the EMA Buy/Sell Signal alert as
-- "The same confirmed buy or sell call your Arena chart draws". That stopped
-- being true when the chart's own signal began to reflect a trader's Strategy
-- panel selection (#985 gap 1): the chart's verdict is now selection-gated, the
-- Telegram/push alert deliberately is not (checkEMASignal fires on the
-- standard EMA ribbon rule whatever the trader has selected, owner's ruling).
-- The alert MESSAGE itself is already honest about it and says so
-- (app/api/telegram/alert/route.ts: "Standard EMA ribbon signal - not your
-- chart's indicator selection."). This is the one surface that still promises
-- parity, and it is the sentence a trader reads before turning the alert on.
--
-- PROPOSED WORDING, NOT APPROVED. The owner approves the wording; nothing here
-- is applied until they do. English reuses the alert message's own phrase
-- ("not your chart's indicator selection") on purpose, so the page and the
-- message a trader later receives do not describe the same rule two ways
-- (#1347 item 16 is about exactly that drift).
--
--   was: The same confirmed buy or sell call your Arena chart draws, with entry,
--        stop loss, and target included. Choose which timeframes to receive it
--        on below.
--   now: The standard EMA ribbon buy or sell call, with entry, stop loss, and
--        target included. It does not follow your chart's indicator selection,
--        so it can differ from what your chart shows. Choose which timeframes to
--        receive it on below.
--
-- The existing `en` row for this key was seeded by 20260805g_labels_seed_ema_signal.sql
-- and shadows labelDefaults.en.json (#675's class), so this MUST update the
-- existing row, not only insert - the `on conflict ... do update` below does.
-- The other four locales may or may not have a row today; the same statement
-- inserts or updates as needed.
--
-- ar/ko/ru/zh are MACHINE-TRANSLATED and not reviewed by a native speaker, the
-- same standard as 20260918a and the rest of this audit's translation waves.
-- "buy or sell call" follows the term already used for the same idea in
-- STRATEGY_PANEL_PARAMS_VERDICT_NOTE (20260918a) in each language.
--
-- lib/labelDefaults.en.json carries the same English as the fallback snapshot.
-- Apply these rows before any `labels:regen`.
--
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels
-- (dev, wdtjhrilakoitfcezxpx). The dev section below is commented out per
-- 20260912b's convention - apply one section at a time. Shared-database write:
-- owner-gated.

insert into lhq_labels (key, locale, value) values

('ALERTS_EMA_SIGNAL_DESC','en','The standard EMA ribbon buy or sell call, with entry, stop loss, and target included. It does not follow your chart''s indicator selection, so it can differ from what your chart shows. Choose which timeframes to receive it on below.'),
('ALERTS_EMA_SIGNAL_DESC','ar','إشارة الشراء أو البيع القياسية لشريط EMA، مع الدخول ووقف الخسارة والهدف. لا تتبع هذه الإشارة اختيار المؤشرات في الرسم البياني الخاص بك، لذا قد تختلف عمّا يعرضه الرسم البياني. اختر أدناه الأطر الزمنية التي تريد استلامها عليها.'),
('ALERTS_EMA_SIGNAL_DESC','ko','표준 EMA 리본 매수/매도 판단이며 진입가, 손절가, 목표가가 포함됩니다. 차트에서 선택한 지표를 따르지 않으므로 차트에 표시되는 내용과 다를 수 있습니다. 아래에서 알림을 받을 시간대를 선택하세요.'),
('ALERTS_EMA_SIGNAL_DESC','ru','Стандартный сигнал на покупку или продажу по ленте EMA с точкой входа, стоп-лоссом и целью. Он не учитывает выбранные вами на графике индикаторы, поэтому может отличаться от того, что показывает график. Ниже выберите таймфреймы, на которых его получать.'),
('ALERTS_EMA_SIGNAL_DESC','zh','标准EMA均线带的买入/卖出判断，包含入场价、止损和目标价。它不跟随您在图表上选择的指标，因此可能与图表显示的内容不同。请在下方选择接收该信号的时间周期。')

on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately, per 20260912b.
--
-- insert into lhq_dev_labels (key, locale, value) values
--
-- ('ALERTS_EMA_SIGNAL_DESC','en','The standard EMA ribbon buy or sell call, with entry, stop loss, and target included. It does not follow your chart''s indicator selection, so it can differ from what your chart shows. Choose which timeframes to receive it on below.'),
-- ('ALERTS_EMA_SIGNAL_DESC','ar','إشارة الشراء أو البيع القياسية لشريط EMA، مع الدخول ووقف الخسارة والهدف. لا تتبع هذه الإشارة اختيار المؤشرات في الرسم البياني الخاص بك، لذا قد تختلف عمّا يعرضه الرسم البياني. اختر أدناه الأطر الزمنية التي تريد استلامها عليها.'),
-- ('ALERTS_EMA_SIGNAL_DESC','ko','표준 EMA 리본 매수/매도 판단이며 진입가, 손절가, 목표가가 포함됩니다. 차트에서 선택한 지표를 따르지 않으므로 차트에 표시되는 내용과 다를 수 있습니다. 아래에서 알림을 받을 시간대를 선택하세요.'),
-- ('ALERTS_EMA_SIGNAL_DESC','ru','Стандартный сигнал на покупку или продажу по ленте EMA с точкой входа, стоп-лоссом и целью. Он не учитывает выбранные вами на графике индикаторы, поэтому может отличаться от того, что показывает график. Ниже выберите таймфреймы, на которых его получать.'),
-- ('ALERTS_EMA_SIGNAL_DESC','zh','标准EMA均线带的买入/卖出判断，包含入场价、止损和目标价。它不跟随您在图表上选择的指标，因此可能与图表显示的内容不同。请在下方选择接收该信号的时间周期。')
--
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
