-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The Arena chart's Liq button and tooltip when the stored liquidation history comes from one venue only (#2394's one-venue note), now translated. English ships in lib/labelDefaults.en.json and needs no row. ko/zh/ru are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling. Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('CHART_LIQ_HIST_FROM','ko','저장된 기록은 {venue}에서만 가져옵니다.'),
('CHART_LIQ_HIST_FROM','zh','存储的历史记录仅来自{venue}。'),
('CHART_LIQ_HIST_FROM','ru','Сохранённая история взята только с {venue}.'),
('CHART_LIQ_VENUE_ONLY','ko','{venue}만'),
('CHART_LIQ_VENUE_ONLY','zh','仅{venue}'),
('CHART_LIQ_VENUE_ONLY','ru','только {venue}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('CHART_LIQ_HIST_FROM','ko','저장된 기록은 {venue}에서만 가져옵니다.'),
('CHART_LIQ_HIST_FROM','zh','存储的历史记录仅来自{venue}。'),
('CHART_LIQ_HIST_FROM','ru','Сохранённая история взята только с {venue}.'),
('CHART_LIQ_VENUE_ONLY','ko','{venue}만'),
('CHART_LIQ_VENUE_ONLY','zh','仅{venue}'),
('CHART_LIQ_VENUE_ONLY','ru','только {venue}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
