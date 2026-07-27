-- UPGRADE_PRO_FEATURE_TOOL_POOL - the /upgrade Pro column's line for the
-- shared one-shot-tool budget introduced in 20260727e_ai_tool_pool.sql.
-- Without it the two pricing surfaces disagreed: the landing page
-- (lib/i18n/dictionaries.ts, hand-typed) advertised the pool while /upgrade,
-- the page people actually buy from, said nothing about it.
-- {tools} is interpolated from lib/limits.ts AI_LIMITS.pro.toolPool, same as
-- the neighbouring {quick}/{deep}/{chat}/{search} lines - the number can't
-- drift from what the API enforces.
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('UPGRADE_PRO_FEATURE_TOOL_POOL', 'en', '{tools} AI tool runs / day, shared across every analysis tool'),
('UPGRADE_PRO_FEATURE_TOOL_POOL', 'ko', '일일 AI 도구 실행 {tools}회 (모든 분석 도구 공용)'),
('UPGRADE_PRO_FEATURE_TOOL_POOL', 'zh', '每日 {tools} 次 AI 工具调用(所有分析工具共享额度)'),
('UPGRADE_PRO_FEATURE_TOOL_POOL', 'ar', '{tools} تشغيلًا لأدوات الذكاء الاصطناعي يوميًا (رصيد مشترك بين جميع الأدوات)'),
('UPGRADE_PRO_FEATURE_TOOL_POOL', 'ru', '{tools} запусков AI-инструментов в день (общий лимит на все инструменты)')
on conflict (key, locale) do update set value = excluded.value;
