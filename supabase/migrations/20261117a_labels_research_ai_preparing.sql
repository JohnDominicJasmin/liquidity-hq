-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The macro-context panel on /research says Preparing the AI read instead of showing only a skeleton while the server builds the read. English ships in lib/labelDefaults.en.json and needs no row. ko/zh/ru are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling. Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('GLOBAL_MACRO_CONTEXT_PREPARING','ko','AI 분석을 준비하는 중…'),
('GLOBAL_MACRO_CONTEXT_PREPARING','zh','正在准备 AI 解读…'),
('GLOBAL_MACRO_CONTEXT_PREPARING','ru','Готовим AI-обзор…')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('GLOBAL_MACRO_CONTEXT_PREPARING','ko','AI 분석을 준비하는 중…'),
('GLOBAL_MACRO_CONTEXT_PREPARING','zh','正在准备 AI 解读…'),
('GLOBAL_MACRO_CONTEXT_PREPARING','ru','Готовим AI-обзор…')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
