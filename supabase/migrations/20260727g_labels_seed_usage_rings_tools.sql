-- USAGE_RINGS_TOOLS - label for the 6th usage ring, added alongside the
-- shared one-shot-tool budget in 20260727e_ai_tool_pool.sql.
--
-- Why the ring exists: the pool made the effective tool ceiling much tighter
-- (11 independent 18/day caps = 198/day, now one shared 25/day). A user
-- spreading ~6 runs across ~5 tools was nowhere near a limit before and is
-- blocked now - and until this ring, the first thing they'd see was a hard
-- 429. Every other cap in the app is visible before you hit it; this one
-- wasn't.
--
-- Ring is Pro-only (free is capped per tool, so there's no single number to
-- show) - UsageRings filters out any ring whose limit is 0.
-- Matches the other USAGE_RINGS_* labels: one short noun, no abbreviations.
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('USAGE_RINGS_TOOLS', 'en', 'Tools'),
('USAGE_RINGS_TOOLS', 'ko', '도구'),
('USAGE_RINGS_TOOLS', 'zh', '工具'),
('USAGE_RINGS_TOOLS', 'ar', 'الأدوات'),
('USAGE_RINGS_TOOLS', 'ru', 'Инструменты')
on conflict (key, locale) do update set value = excluded.value;
