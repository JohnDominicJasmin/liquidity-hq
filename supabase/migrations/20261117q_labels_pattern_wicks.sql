-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- A long-wick candle is named Hammer / Hanging man / Shooting star / Inverted hammer only when the prior trend supports the name; otherwise it reads "Long lower wick" / "Long upper wick" (PM, 2026-11-16). New keys
-- PATTERN_LONG_LOWER_WICK and PATTERN_LONG_UPPER_WICK. English ships in lib/labelDefaults.en.json (new keys, nothing stored to override) and needs no row. ko/zh/ru are AI-drafted and not native-reviewed.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('PATTERN_LONG_LOWER_WICK','ko','긴 아래꼬리'),
('PATTERN_LONG_UPPER_WICK','ko','긴 윗꼬리'),
('PATTERN_LONG_LOWER_WICK','zh','长下影线'),
('PATTERN_LONG_UPPER_WICK','zh','长上影线'),
('PATTERN_LONG_LOWER_WICK','ru','Длинная нижняя тень'),
('PATTERN_LONG_UPPER_WICK','ru','Длинная верхняя тень')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('PATTERN_LONG_LOWER_WICK','ko','긴 아래꼬리'),
('PATTERN_LONG_UPPER_WICK','ko','긴 윗꼬리'),
('PATTERN_LONG_LOWER_WICK','zh','长下影线'),
('PATTERN_LONG_UPPER_WICK','zh','长上影线'),
('PATTERN_LONG_LOWER_WICK','ru','Длинная нижняя тень'),
('PATTERN_LONG_UPPER_WICK','ru','Длинная верхняя тень')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
