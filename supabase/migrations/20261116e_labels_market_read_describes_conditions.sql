-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The dashboard Market Read headline and sub-line describe conditions instead of giving a verdict (PM, 2026-11-16, persona walkthrough #1113): "Good time to trade" read as an instruction to a beginner.
-- Overwrites the rows from 20261113f. English ships in lib/labelDefaults.en.json and needs no row. ar rows are overwritten too: ar is not offered, but a stored 'ar' preference still serves its rows (lib/locales.ts).
-- ko/zh/ru/ar are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling. Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('MARKET_READ_TXT_GOOD_TIME','ko','대부분의 신호가 일치합니다'),
('MARKET_READ_TXT_GOOD_TIME','zh','多数信号一致'),
('MARKET_READ_TXT_GOOD_TIME','ru','Большинство сигналов совпадают'),
('MARKET_READ_TXT_GOOD_TIME','ar','معظم الإشارات متفقة'),
('MARKET_READ_TXT_SUB_GOOD','ko','지금 여러 신호가 같은 방향을 가리킵니다. 시장 상황에 대한 설명이며, 예측이나 조언이 아닙니다.'),
('MARKET_READ_TXT_SUB_GOOD','zh','目前有多个信号一致。这是对市场现状的描述，不是预测或建议。'),
('MARKET_READ_TXT_SUB_GOOD','ru','Сейчас несколько сигналов совпадают. Это описание рынка, а не прогноз и не совет.'),
('MARKET_READ_TXT_SUB_GOOD','ar','تتوافق عدة إشارات الآن. هذا وصف للسوق وليس توقعًا أو نصيحة.'),
('MARKET_READ_TXT_DECENT','ko','신호가 엇갈립니다'),
('MARKET_READ_TXT_DECENT','zh','信号不一'),
('MARKET_READ_TXT_DECENT','ru','Сигналы расходятся'),
('MARKET_READ_TXT_DECENT','ar','الإشارات متباينة'),
('MARKET_READ_TXT_SUB_MID','ko','지금 신호의 방향이 엇갈립니다. 시장 상황에 대한 설명이며, 조언이 아닙니다.'),
('MARKET_READ_TXT_SUB_MID','zh','目前各信号指向不同方向。这是对市场现状的描述，不是建议。'),
('MARKET_READ_TXT_SUB_MID','ru','Сейчас сигналы указывают в разные стороны. Это описание рынка, а не совет.'),
('MARKET_READ_TXT_SUB_MID','ar','تشير الإشارات إلى اتجاهات مختلفة الآن. هذا وصف للسوق وليس نصيحة.'),
('MARKET_READ_TXT_WEAK','ko','일치하는 신호가 적습니다'),
('MARKET_READ_TXT_WEAK','zh','一致的信号较少'),
('MARKET_READ_TXT_WEAK','ru','Совпадает мало сигналов'),
('MARKET_READ_TXT_WEAK','ar','قلة من الإشارات متفقة'),
('MARKET_READ_TXT_SUB_WEAK','ko','일치하는 신호가 적고 모멘텀이 불분명합니다. 시장 상황에 대한 설명이며, 조언이 아닙니다.'),
('MARKET_READ_TXT_SUB_WEAK','zh','一致的信号较少，动能不明。这是对市场现状的描述，不是建议。'),
('MARKET_READ_TXT_SUB_WEAK','ru','Совпадает мало сигналов, импульс неясен. Это описание рынка, а не совет.'),
('MARKET_READ_TXT_SUB_WEAK','ar','قلة من الإشارات متفقة والزخم غير واضح. هذا وصف للسوق وليس نصيحة.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('MARKET_READ_TXT_GOOD_TIME','ko','대부분의 신호가 일치합니다'),
('MARKET_READ_TXT_GOOD_TIME','zh','多数信号一致'),
('MARKET_READ_TXT_GOOD_TIME','ru','Большинство сигналов совпадают'),
('MARKET_READ_TXT_GOOD_TIME','ar','معظم الإشارات متفقة'),
('MARKET_READ_TXT_SUB_GOOD','ko','지금 여러 신호가 같은 방향을 가리킵니다. 시장 상황에 대한 설명이며, 예측이나 조언이 아닙니다.'),
('MARKET_READ_TXT_SUB_GOOD','zh','目前有多个信号一致。这是对市场现状的描述，不是预测或建议。'),
('MARKET_READ_TXT_SUB_GOOD','ru','Сейчас несколько сигналов совпадают. Это описание рынка, а не прогноз и не совет.'),
('MARKET_READ_TXT_SUB_GOOD','ar','تتوافق عدة إشارات الآن. هذا وصف للسوق وليس توقعًا أو نصيحة.'),
('MARKET_READ_TXT_DECENT','ko','신호가 엇갈립니다'),
('MARKET_READ_TXT_DECENT','zh','信号不一'),
('MARKET_READ_TXT_DECENT','ru','Сигналы расходятся'),
('MARKET_READ_TXT_DECENT','ar','الإشارات متباينة'),
('MARKET_READ_TXT_SUB_MID','ko','지금 신호의 방향이 엇갈립니다. 시장 상황에 대한 설명이며, 조언이 아닙니다.'),
('MARKET_READ_TXT_SUB_MID','zh','目前各信号指向不同方向。这是对市场现状的描述，不是建议。'),
('MARKET_READ_TXT_SUB_MID','ru','Сейчас сигналы указывают в разные стороны. Это описание рынка, а не совет.'),
('MARKET_READ_TXT_SUB_MID','ar','تشير الإشارات إلى اتجاهات مختلفة الآن. هذا وصف للسوق وليس نصيحة.'),
('MARKET_READ_TXT_WEAK','ko','일치하는 신호가 적습니다'),
('MARKET_READ_TXT_WEAK','zh','一致的信号较少'),
('MARKET_READ_TXT_WEAK','ru','Совпадает мало сигналов'),
('MARKET_READ_TXT_WEAK','ar','قلة من الإشارات متفقة'),
('MARKET_READ_TXT_SUB_WEAK','ko','일치하는 신호가 적고 모멘텀이 불분명합니다. 시장 상황에 대한 설명이며, 조언이 아닙니다.'),
('MARKET_READ_TXT_SUB_WEAK','zh','一致的信号较少，动能不明。这是对市场现状的描述，不是建议。'),
('MARKET_READ_TXT_SUB_WEAK','ru','Совпадает мало сигналов, импульс неясен. Это описание рынка, а не совет.'),
('MARKET_READ_TXT_SUB_WEAK','ar','قلة من الإشارات متفقة والزخم غير واضح. هذا وصف للسوق وليس نصيحة.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
