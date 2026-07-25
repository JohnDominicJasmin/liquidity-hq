-- New ARENA_DISMISS_RESULT_ARIA label - close button on the Arena AI Read
-- card. Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('ARENA_DISMISS_RESULT_ARIA', 'en', 'Dismiss result'),
('ARENA_DISMISS_RESULT_ARIA', 'ko', '결과 닫기'),
('ARENA_DISMISS_RESULT_ARIA', 'zh', '关闭结果'),
('ARENA_DISMISS_RESULT_ARIA', 'ar', 'إغلاق النتيجة'),
('ARENA_DISMISS_RESULT_ARIA', 'ru', 'Скрыть результат')
on conflict (key, locale) do update set value = excluded.value;
