-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- A Deep read that replaces a Quick read on the same coin says so, with both times (PM 2026-11-19, #1651: two reads minutes apart set different confirm and cancel levels and the card did not say which was newer). 1 key x 5 locales; en equals the shipped default. ko/zh/ru/ar AI-drafted, not native-reviewed.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('ARENA_DEEP_REPLACED_QUICK','en','Deep read ({deep}) replaced the Quick read from {quick}. Levels can differ between them.'),
('ARENA_DEEP_REPLACED_QUICK','ko','심층 분석({deep})이 {quick}의 빠른 분석을 대체했습니다. 두 분석의 레벨은 다를 수 있습니다.'),
('ARENA_DEEP_REPLACED_QUICK','zh','深度解读（{deep}）取代了 {quick} 的快速解读。两者的价位可能不同。'),
('ARENA_DEEP_REPLACED_QUICK','ru','Глубокий разбор ({deep}) заменил быстрый от {quick}. Уровни в них могут различаться.'),
('ARENA_DEEP_REPLACED_QUICK','ar','حلّت القراءة المعمّقة ({deep}) محل القراءة السريعة من {quick}. قد تختلف المستويات بينهما.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('ARENA_DEEP_REPLACED_QUICK','en','Deep read ({deep}) replaced the Quick read from {quick}. Levels can differ between them.'),
('ARENA_DEEP_REPLACED_QUICK','ko','심층 분석({deep})이 {quick}의 빠른 분석을 대체했습니다. 두 분석의 레벨은 다를 수 있습니다.'),
('ARENA_DEEP_REPLACED_QUICK','zh','深度解读（{deep}）取代了 {quick} 的快速解读。两者的价位可能不同。'),
('ARENA_DEEP_REPLACED_QUICK','ru','Глубокий разбор ({deep}) заменил быстрый от {quick}. Уровни в них могут различаться.'),
('ARENA_DEEP_REPLACED_QUICK','ar','حلّت القراءة المعمّقة ({deep}) محل القراءة السريعة من {quick}. قد تختلف المستويات بينهما.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
