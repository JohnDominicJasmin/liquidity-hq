-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- Strategy panel run-row buttons (Quick / Deep / Ask AI) were hardcoded English (PM visual sign-off, 2026-11-18). The CSS uppercases them. ko/zh/ar use the stems of ARENA_QUICK/DEEP_RESEARCH_BUTTON; ru matches the usage line. ko/zh/ru/ar AI-drafted, not native-reviewed.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('STRATEGY_PANEL_RUN_QUICK','en','Quick'),
('STRATEGY_PANEL_RUN_QUICK','ko','빠른'),
('STRATEGY_PANEL_RUN_QUICK','zh','快速'),
('STRATEGY_PANEL_RUN_QUICK','ru','Быстрый'),
('STRATEGY_PANEL_RUN_QUICK','ar','سريع'),
('STRATEGY_PANEL_RUN_DEEP','en','Deep'),
('STRATEGY_PANEL_RUN_DEEP','ko','심층'),
('STRATEGY_PANEL_RUN_DEEP','zh','深度'),
('STRATEGY_PANEL_RUN_DEEP','ru','Глубокий'),
('STRATEGY_PANEL_RUN_DEEP','ar','معمّق'),
('STRATEGY_PANEL_RUN_ASK','en','Ask AI'),
('STRATEGY_PANEL_RUN_ASK','ko','AI에 묻기'),
('STRATEGY_PANEL_RUN_ASK','zh','问 AI'),
('STRATEGY_PANEL_RUN_ASK','ru','Спросить ИИ'),
('STRATEGY_PANEL_RUN_ASK','ar','اسأل الذكاء الاصطناعي')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('STRATEGY_PANEL_RUN_QUICK','en','Quick'),
('STRATEGY_PANEL_RUN_QUICK','ko','빠른'),
('STRATEGY_PANEL_RUN_QUICK','zh','快速'),
('STRATEGY_PANEL_RUN_QUICK','ru','Быстрый'),
('STRATEGY_PANEL_RUN_QUICK','ar','سريع'),
('STRATEGY_PANEL_RUN_DEEP','en','Deep'),
('STRATEGY_PANEL_RUN_DEEP','ko','심층'),
('STRATEGY_PANEL_RUN_DEEP','zh','深度'),
('STRATEGY_PANEL_RUN_DEEP','ru','Глубокий'),
('STRATEGY_PANEL_RUN_DEEP','ar','معمّق'),
('STRATEGY_PANEL_RUN_ASK','en','Ask AI'),
('STRATEGY_PANEL_RUN_ASK','ko','AI에 묻기'),
('STRATEGY_PANEL_RUN_ASK','zh','问 AI'),
('STRATEGY_PANEL_RUN_ASK','ru','Спросить ИИ'),
('STRATEGY_PANEL_RUN_ASK','ar','اسأل الذكاء الاصطناعي')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
