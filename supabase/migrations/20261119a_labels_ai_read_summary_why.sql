-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- The AI read at a glance (owner rule 22, PM 2026-11-18): the "Settings changed since this read. Run again." notice (replaces the two longer stale-selection lines) and the "More details" toggle. ko/zh/ru/ar AI-drafted, not native-reviewed.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('ARENA_STALE_SETTINGS_NOTICE','en','Settings changed since this read. Run again.'),
('ARENA_STALE_SETTINGS_NOTICE','ko','이 분석 이후 설정이 바뀌었습니다. 다시 실행하세요.'),
('ARENA_STALE_SETTINGS_NOTICE','zh','自本次分析后设置已更改。请重新运行。'),
('ARENA_STALE_SETTINGS_NOTICE','ru','Настройки изменились после этого разбора. Запустите снова.'),
('ARENA_STALE_SETTINGS_NOTICE','ar','تغيّرت الإعدادات منذ هذه القراءة. شغّل التحليل مجددًا.'),
('ARENA_MORE_DETAILS','en','More details'),
('ARENA_MORE_DETAILS','ko','자세히 보기'),
('ARENA_MORE_DETAILS','zh','更多详情'),
('ARENA_MORE_DETAILS','ru','Подробнее'),
('ARENA_MORE_DETAILS','ar','مزيد من التفاصيل')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('ARENA_STALE_SETTINGS_NOTICE','en','Settings changed since this read. Run again.'),
('ARENA_STALE_SETTINGS_NOTICE','ko','이 분석 이후 설정이 바뀌었습니다. 다시 실행하세요.'),
('ARENA_STALE_SETTINGS_NOTICE','zh','自本次分析后设置已更改。请重新运行。'),
('ARENA_STALE_SETTINGS_NOTICE','ru','Настройки изменились после этого разбора. Запустите снова.'),
('ARENA_STALE_SETTINGS_NOTICE','ar','تغيّرت الإعدادات منذ هذه القراءة. شغّل التحليل مجددًا.'),
('ARENA_MORE_DETAILS','en','More details'),
('ARENA_MORE_DETAILS','ko','자세히 보기'),
('ARENA_MORE_DETAILS','zh','更多详情'),
('ARENA_MORE_DETAILS','ru','Подробнее'),
('ARENA_MORE_DETAILS','ar','مزيد من التفاصيل')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
