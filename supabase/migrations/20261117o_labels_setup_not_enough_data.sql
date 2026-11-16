-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- A coin with fewer than two of the three squeeze inputs reads "Not enough data" instead of "Balanced" (PM, 2026-11-16). New keys DASH_EDGE_SETUP_NOT_ENOUGH_DATA and SETUP_WORD_NOT_ENOUGH_DATA. English ships in lib/labelDefaults.en.json
-- (new keys, nothing stored to override) and needs no row. ko/zh/ru are AI-drafted and not native-reviewed.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('DASH_EDGE_SETUP_NOT_ENOUGH_DATA','ko','데이터가 충분하지 않습니다'),
('SETUP_WORD_NOT_ENOUGH_DATA','ko','데이터가 충분하지 않습니다'),
('DASH_EDGE_SETUP_NOT_ENOUGH_DATA','zh','数据不足'),
('SETUP_WORD_NOT_ENOUGH_DATA','zh','数据不足'),
('DASH_EDGE_SETUP_NOT_ENOUGH_DATA','ru','Недостаточно данных'),
('SETUP_WORD_NOT_ENOUGH_DATA','ru','Недостаточно данных')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('DASH_EDGE_SETUP_NOT_ENOUGH_DATA','ko','데이터가 충분하지 않습니다'),
('SETUP_WORD_NOT_ENOUGH_DATA','ko','데이터가 충분하지 않습니다'),
('DASH_EDGE_SETUP_NOT_ENOUGH_DATA','zh','数据不足'),
('SETUP_WORD_NOT_ENOUGH_DATA','zh','数据不足'),
('DASH_EDGE_SETUP_NOT_ENOUGH_DATA','ru','Недостаточно данных'),
('SETUP_WORD_NOT_ENOUGH_DATA','ru','Недостаточно данных')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
