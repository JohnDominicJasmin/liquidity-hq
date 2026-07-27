-- New USAGE_MODAL_TITLE label - the dedicated "AI Usage" dialog opened from
-- the nav account menu's "view usage" item (previously opened the full
-- Settings modal; now its own small dialog).
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('USAGE_MODAL_TITLE', 'en', 'AI Usage'),
('USAGE_MODAL_TITLE', 'ko', 'AI 사용량'),
('USAGE_MODAL_TITLE', 'zh', 'AI 使用量'),
('USAGE_MODAL_TITLE', 'ar', 'استخدام الذكاء الاصطناعي'),
('USAGE_MODAL_TITLE', 'ru', 'Использование ИИ')
on conflict (key, locale) do update set value = excluded.value;
