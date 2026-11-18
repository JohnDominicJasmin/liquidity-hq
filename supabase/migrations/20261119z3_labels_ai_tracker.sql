-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- AI tool honesty notes (#1631, audit 2026-11-16): Strategy Research has no sample behind its parameters or edge rating, the Shadow Account "shadow strategy" is picked with hindsight from the same trades, and Thesis Check has no live price. Three keys x 5 locales; en equals the shipped defaults. ko/zh/ru/ar AI-drafted, not native-reviewed.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('BACKTEST_SR_NO_SAMPLE_NOTE','en','Not tested on any data. The parameters and edge rating come from general knowledge.'),
('BACKTEST_SR_NO_SAMPLE_NOTE','ko','어떤 데이터로도 테스트되지 않았습니다. 파라미터와 우위 등급은 일반 지식에 근거합니다.'),
('BACKTEST_SR_NO_SAMPLE_NOTE','zh','未用任何数据测试。参数和优势评级来自一般知识。'),
('BACKTEST_SR_NO_SAMPLE_NOTE','ru','Не проверено ни на каких данных. Параметры и оценка преимущества основаны на общих знаниях.'),
('BACKTEST_SR_NO_SAMPLE_NOTE','ar','لم يُختبر على أي بيانات. المعايير وتقييم الأفضلية مبنية على معرفة عامة.'),
('TRADE_JOURNAL_SHADOW_HINDSIGHT_NOTE','en','Picked from these same trades with hindsight. It describes the past, not a forecast.'),
('TRADE_JOURNAL_SHADOW_HINDSIGHT_NOTE','ko','같은 거래에서 사후에 고른 결과입니다. 과거를 설명할 뿐 예측이 아닙니다.'),
('TRADE_JOURNAL_SHADOW_HINDSIGHT_NOTE','zh','这是事后从同一批交易中挑选的结果。它描述的是过去，不是预测。'),
('TRADE_JOURNAL_SHADOW_HINDSIGHT_NOTE','ru','Выбрано задним числом из этих же сделок. Это описание прошлого, а не прогноз.'),
('TRADE_JOURNAL_SHADOW_HINDSIGHT_NOTE','ar','اختيرت من الصفقات نفسها بعد وقوعها. إنها تصف الماضي وليست توقعًا.'),
('TRADE_JOURNAL_THESIS_NO_LIVE_PRICE_NOTE','en','From general knowledge, without a live price.'),
('TRADE_JOURNAL_THESIS_NO_LIVE_PRICE_NOTE','ko','실시간 가격 없이 일반 지식으로 확인했습니다.'),
('TRADE_JOURNAL_THESIS_NO_LIVE_PRICE_NOTE','zh','基于一般知识，没有实时价格。'),
('TRADE_JOURNAL_THESIS_NO_LIVE_PRICE_NOTE','ru','На основе общих знаний, без текущей цены.'),
('TRADE_JOURNAL_THESIS_NO_LIVE_PRICE_NOTE','ar','من معرفة عامة، دون سعر مباشر.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('BACKTEST_SR_NO_SAMPLE_NOTE','en','Not tested on any data. The parameters and edge rating come from general knowledge.'),
('BACKTEST_SR_NO_SAMPLE_NOTE','ko','어떤 데이터로도 테스트되지 않았습니다. 파라미터와 우위 등급은 일반 지식에 근거합니다.'),
('BACKTEST_SR_NO_SAMPLE_NOTE','zh','未用任何数据测试。参数和优势评级来自一般知识。'),
('BACKTEST_SR_NO_SAMPLE_NOTE','ru','Не проверено ни на каких данных. Параметры и оценка преимущества основаны на общих знаниях.'),
('BACKTEST_SR_NO_SAMPLE_NOTE','ar','لم يُختبر على أي بيانات. المعايير وتقييم الأفضلية مبنية على معرفة عامة.'),
('TRADE_JOURNAL_SHADOW_HINDSIGHT_NOTE','en','Picked from these same trades with hindsight. It describes the past, not a forecast.'),
('TRADE_JOURNAL_SHADOW_HINDSIGHT_NOTE','ko','같은 거래에서 사후에 고른 결과입니다. 과거를 설명할 뿐 예측이 아닙니다.'),
('TRADE_JOURNAL_SHADOW_HINDSIGHT_NOTE','zh','这是事后从同一批交易中挑选的结果。它描述的是过去，不是预测。'),
('TRADE_JOURNAL_SHADOW_HINDSIGHT_NOTE','ru','Выбрано задним числом из этих же сделок. Это описание прошлого, а не прогноз.'),
('TRADE_JOURNAL_SHADOW_HINDSIGHT_NOTE','ar','اختيرت من الصفقات نفسها بعد وقوعها. إنها تصف الماضي وليست توقعًا.'),
('TRADE_JOURNAL_THESIS_NO_LIVE_PRICE_NOTE','en','From general knowledge, without a live price.'),
('TRADE_JOURNAL_THESIS_NO_LIVE_PRICE_NOTE','ko','실시간 가격 없이 일반 지식으로 확인했습니다.'),
('TRADE_JOURNAL_THESIS_NO_LIVE_PRICE_NOTE','zh','基于一般知识，没有实时价格。'),
('TRADE_JOURNAL_THESIS_NO_LIVE_PRICE_NOTE','ru','На основе общих знаний, без текущей цены.'),
('TRADE_JOURNAL_THESIS_NO_LIVE_PRICE_NOTE','ar','من معرفة عامة، دون سعر مباشر.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
