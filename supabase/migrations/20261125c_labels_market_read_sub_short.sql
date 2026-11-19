-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The Market Read sub-line is one short factual sentence (PM, 2026-11-19, #1185: no advice, 12 words or fewer). The three sub-lines lose their second sentence ("A description of the market, not advice."), 15-17 words down to 6-8.
-- The headlines (MARKET_READ_TXT_GOOD_TIME / DECENT / WEAK) already read "Most signals agree" / "Signals are mixed" / "Few signals agree" and are unchanged. en equals lib/labelDefaults.en.json.
-- ko/zh/ru/ar are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling. Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('MARKET_READ_TXT_SUB_GOOD','en','Several signals line up right now.'),
('MARKET_READ_TXT_SUB_GOOD','ko','지금 여러 신호가 같은 방향을 가리킵니다.'),
('MARKET_READ_TXT_SUB_GOOD','zh','目前有多个信号一致。'),
('MARKET_READ_TXT_SUB_GOOD','ru','Сейчас несколько сигналов совпадают.'),
('MARKET_READ_TXT_SUB_GOOD','ar','تتوافق عدة إشارات الآن.'),
('MARKET_READ_TXT_SUB_MID','en','Signals point different ways right now.'),
('MARKET_READ_TXT_SUB_MID','ko','지금 신호의 방향이 엇갈립니다.'),
('MARKET_READ_TXT_SUB_MID','zh','目前各信号指向不同方向。'),
('MARKET_READ_TXT_SUB_MID','ru','Сейчас сигналы указывают в разные стороны.'),
('MARKET_READ_TXT_SUB_MID','ar','تشير الإشارات إلى اتجاهات مختلفة الآن.'),
('MARKET_READ_TXT_SUB_WEAK','en','Few signals line up and momentum is unclear.'),
('MARKET_READ_TXT_SUB_WEAK','ko','일치하는 신호가 적고 모멘텀이 불분명합니다.'),
('MARKET_READ_TXT_SUB_WEAK','zh','一致的信号较少，动能不明。'),
('MARKET_READ_TXT_SUB_WEAK','ru','Совпадает мало сигналов, импульс неясен.'),
('MARKET_READ_TXT_SUB_WEAK','ar','قلة من الإشارات متفقة والزخم غير واضح.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('MARKET_READ_TXT_SUB_GOOD','en','Several signals line up right now.'),
('MARKET_READ_TXT_SUB_GOOD','ko','지금 여러 신호가 같은 방향을 가리킵니다.'),
('MARKET_READ_TXT_SUB_GOOD','zh','目前有多个信号一致。'),
('MARKET_READ_TXT_SUB_GOOD','ru','Сейчас несколько сигналов совпадают.'),
('MARKET_READ_TXT_SUB_GOOD','ar','تتوافق عدة إشارات الآن.'),
('MARKET_READ_TXT_SUB_MID','en','Signals point different ways right now.'),
('MARKET_READ_TXT_SUB_MID','ko','지금 신호의 방향이 엇갈립니다.'),
('MARKET_READ_TXT_SUB_MID','zh','目前各信号指向不同方向。'),
('MARKET_READ_TXT_SUB_MID','ru','Сейчас сигналы указывают в разные стороны.'),
('MARKET_READ_TXT_SUB_MID','ar','تشير الإشارات إلى اتجاهات مختلفة الآن.'),
('MARKET_READ_TXT_SUB_WEAK','en','Few signals line up and momentum is unclear.'),
('MARKET_READ_TXT_SUB_WEAK','ko','일치하는 신호가 적고 모멘텀이 불분명합니다.'),
('MARKET_READ_TXT_SUB_WEAK','zh','一致的信号较少，动能不明。'),
('MARKET_READ_TXT_SUB_WEAK','ru','Совпадает мало сигналов, импульс неясен.'),
('MARKET_READ_TXT_SUB_WEAK','ar','قلة من الإشارات متفقة والزخم غير واضح.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
