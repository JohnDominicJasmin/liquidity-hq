-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release, after QA's width check covers the new strings in all locales; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- Arena's coin picker now carries its category chips inside the list (#1263, owner request 2026-11-13). The English wording ships in
-- `lib/labelDefaults.en.json` and needs no database row: LabelsProvider merges the fetched rows OVER those defaults, so every locale shows the English
-- text until a row for that locale exists. Four keys are new:
--
--   ARENA_SCANNER_CAT_GROUP_ARIA   "Filter by category"                         (screen-reader name of the chip row)
--   ARENA_SCANNER_CAT_COUNT_ARIA   "{category}, {n} instruments"                (screen-reader name of one chip with its live count)
--   ARENA_SCANNER_EMPTY_IN_CAT     "No match in {category}. {n} in {other}."    (empty state: the matches are in another category)
--   ARENA_SCANNER_EMPTY_SWITCH     "Show {other}"                               (the one-tap button beside it)
--
-- THE FOUR NON-ENGLISH ROWS BELOW ARE MACHINE-DRAFTED AND NOT NATIVE-REVIEWED, AND THAT IS THE OWNER'S DECISION FOR THESE KEYS. On 2026-11-13 the owner ruled first-hand, via PM,
-- to ship the AI-drafted ko/zh/ru/ar rows for the picker labels, the same choice as SPOTLIGHT_TOUR_STEP5_BODY (20261113a). That overrides the 2026-10-22 hold (20261022d, 20261028a)
-- for these four keys only. Each was re-read against the English: same meaning, and the placeholders {category}, {n} and {other} are unchanged. Treat them as drafts until a native
-- reader has been through them.
--
-- Upserts by (key, locale): re-running is safe, and no row for any other key is touched.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('ARENA_SCANNER_CAT_GROUP_ARIA','ko','카테고리별 필터'),
('ARENA_SCANNER_CAT_GROUP_ARIA','zh','按类别筛选'),
('ARENA_SCANNER_CAT_GROUP_ARIA','ru','Фильтр по категории'),
('ARENA_SCANNER_CAT_GROUP_ARIA','ar','تصفية حسب الفئة'),
('ARENA_SCANNER_CAT_COUNT_ARIA','ko','{category}, {n}개 종목'),
('ARENA_SCANNER_CAT_COUNT_ARIA','zh','{category}，{n} 个品种'),
('ARENA_SCANNER_CAT_COUNT_ARIA','ru','{category}, инструментов: {n}'),
('ARENA_SCANNER_CAT_COUNT_ARIA','ar','{category}، {n} أداة'),
('ARENA_SCANNER_EMPTY_IN_CAT','ko','{category}에 일치하는 항목이 없습니다. {other}에는 {n}개 있습니다.'),
('ARENA_SCANNER_EMPTY_IN_CAT','zh','{category} 中没有匹配项。{other} 中有 {n} 个。'),
('ARENA_SCANNER_EMPTY_IN_CAT','ru','В категории «{category}» совпадений нет. В «{other}»: {n}.'),
('ARENA_SCANNER_EMPTY_IN_CAT','ar','لا توجد نتائج في {category}. يوجد {n} في {other}.'),
('ARENA_SCANNER_EMPTY_SWITCH','ko','{other} 보기'),
('ARENA_SCANNER_EMPTY_SWITCH','zh','显示 {other}'),
('ARENA_SCANNER_EMPTY_SWITCH','ru','Показать: {other}'),
('ARENA_SCANNER_EMPTY_SWITCH','ar','عرض {other}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
--
-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============

insert into lhq_dev_labels (key, locale, value) values
('ARENA_SCANNER_CAT_GROUP_ARIA','ko','카테고리별 필터'),
('ARENA_SCANNER_CAT_GROUP_ARIA','zh','按类别筛选'),
('ARENA_SCANNER_CAT_GROUP_ARIA','ru','Фильтр по категории'),
('ARENA_SCANNER_CAT_GROUP_ARIA','ar','تصفية حسب الفئة'),
('ARENA_SCANNER_CAT_COUNT_ARIA','ko','{category}, {n}개 종목'),
('ARENA_SCANNER_CAT_COUNT_ARIA','zh','{category}，{n} 个品种'),
('ARENA_SCANNER_CAT_COUNT_ARIA','ru','{category}, инструментов: {n}'),
('ARENA_SCANNER_CAT_COUNT_ARIA','ar','{category}، {n} أداة'),
('ARENA_SCANNER_EMPTY_IN_CAT','ko','{category}에 일치하는 항목이 없습니다. {other}에는 {n}개 있습니다.'),
('ARENA_SCANNER_EMPTY_IN_CAT','zh','{category} 中没有匹配项。{other} 中有 {n} 个。'),
('ARENA_SCANNER_EMPTY_IN_CAT','ru','В категории «{category}» совпадений нет. В «{other}»: {n}.'),
('ARENA_SCANNER_EMPTY_IN_CAT','ar','لا توجد نتائج في {category}. يوجد {n} في {other}.'),
('ARENA_SCANNER_EMPTY_SWITCH','ko','{other} 보기'),
('ARENA_SCANNER_EMPTY_SWITCH','zh','显示 {other}'),
('ARENA_SCANNER_EMPTY_SWITCH','ru','Показать: {other}'),
('ARENA_SCANNER_EMPTY_SWITCH','ar','عرض {other}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
