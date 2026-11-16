-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- /research Stablecoin card: the figures show first and the AI summary fills in after, with an honest 'unavailable' when it times out. New keys DRY_POWDER_ANALYSIS_LOADING_SR and DRY_POWDER_ANALYSIS_UNAVAILABLE. English ships in
-- lib/labelDefaults.en.json (new keys, no stored en row to override) and needs no row. ko/zh/ru are AI-drafted and not native-reviewed.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('DRY_POWDER_ANALYSIS_LOADING_SR','ko','요약을 작성하는 중…'),
('DRY_POWDER_ANALYSIS_UNAVAILABLE','ko','지금은 요약을 불러올 수 없습니다. 위의 수치는 최신입니다.'),
('DRY_POWDER_ANALYSIS_LOADING_SR','zh','正在生成摘要…'),
('DRY_POWDER_ANALYSIS_UNAVAILABLE','zh','摘要暂时无法提供。上方数字为最新数据。'),
('DRY_POWDER_ANALYSIS_LOADING_SR','ru','Готовим сводку…'),
('DRY_POWDER_ANALYSIS_UNAVAILABLE','ru','Сводка сейчас недоступна. Цифры выше актуальны.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('DRY_POWDER_ANALYSIS_LOADING_SR','ko','요약을 작성하는 중…'),
('DRY_POWDER_ANALYSIS_UNAVAILABLE','ko','지금은 요약을 불러올 수 없습니다. 위의 수치는 최신입니다.'),
('DRY_POWDER_ANALYSIS_LOADING_SR','zh','正在生成摘要…'),
('DRY_POWDER_ANALYSIS_UNAVAILABLE','zh','摘要暂时无法提供。上方数字为最新数据。'),
('DRY_POWDER_ANALYSIS_LOADING_SR','ru','Готовим сводку…'),
('DRY_POWDER_ANALYSIS_UNAVAILABLE','ru','Сводка сейчас недоступна. Цифры выше актуальны.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
