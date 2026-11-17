-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) BEFORE the release deploy; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- PM audit 2026-11-17 (#1185), batch 1c: the Arena badge says what LIVE covers ("LIVE · web + X"), the Briefing ETF date reads "Latest: Nov 13" (new key BRIEFING_ETF_LATEST), and the Accumulation Tracker says
-- when coins tie on a score (new key ACCUMULATION_TRACKER_TIES). en/ko/zh/ru/ar; rows in the DB win over the shipped default. ko/zh/ru/ar are AI-drafted and not native-reviewed (owner's 2026-11-13 ruling).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('ARENA_LIVE_BADGE','en','LiquidityAI · LIVE · web + X'),
('ARENA_LIVE_BADGE','ko','LiquidityAI · 실시간 · 웹 + X'),
('ARENA_LIVE_BADGE','zh','LiquidityAI · 实时 · 网页 + X'),
('ARENA_LIVE_BADGE','ru','LiquidityAI · LIVE · веб + X'),
('ARENA_LIVE_BADGE','ar','LiquidityAI · مباشر · الويب + X'),
('BRIEFING_ETF_LATEST','en','Latest: {date}'),
('BRIEFING_ETF_LATEST','ko','최신: {date}'),
('BRIEFING_ETF_LATEST','zh','最新：{date}'),
('BRIEFING_ETF_LATEST','ru','Последние: {date}'),
('BRIEFING_ETF_LATEST','ar','الأحدث: {date}'),
('ACCUMULATION_TRACKER_TIES','en','{n} coins tie at {score}'),
('ACCUMULATION_TRACKER_TIES','ko','{n}개 코인이 {score}점으로 동점'),
('ACCUMULATION_TRACKER_TIES','zh','{n} 个币种同为 {score} 分'),
('ACCUMULATION_TRACKER_TIES','ru','{n} монет с одинаковым счётом {score}'),
('ACCUMULATION_TRACKER_TIES','ar','{n} عملات متعادلة عند {score}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('ARENA_LIVE_BADGE','en','LiquidityAI · LIVE · web + X'),
('ARENA_LIVE_BADGE','ko','LiquidityAI · 실시간 · 웹 + X'),
('ARENA_LIVE_BADGE','zh','LiquidityAI · 实时 · 网页 + X'),
('ARENA_LIVE_BADGE','ru','LiquidityAI · LIVE · веб + X'),
('ARENA_LIVE_BADGE','ar','LiquidityAI · مباشر · الويب + X'),
('BRIEFING_ETF_LATEST','en','Latest: {date}'),
('BRIEFING_ETF_LATEST','ko','최신: {date}'),
('BRIEFING_ETF_LATEST','zh','最新：{date}'),
('BRIEFING_ETF_LATEST','ru','Последние: {date}'),
('BRIEFING_ETF_LATEST','ar','الأحدث: {date}'),
('ACCUMULATION_TRACKER_TIES','en','{n} coins tie at {score}'),
('ACCUMULATION_TRACKER_TIES','ko','{n}개 코인이 {score}점으로 동점'),
('ACCUMULATION_TRACKER_TIES','zh','{n} 个币种同为 {score} 分'),
('ACCUMULATION_TRACKER_TIES','ru','{n} монет с одинаковым счётом {score}'),
('ACCUMULATION_TRACKER_TIES','ar','{n} عملات متعادلة عند {score}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
