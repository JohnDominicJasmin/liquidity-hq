-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- The fair value gap strategy SAYS so when no open gap exists (QA drawings audit, #1263, 2026-11-20: fvg 1h drew only past arrows and no gap box).
-- en equals lib/labelDefaults.en.json; ko/zh/ru/ar are AI-drafted and not native-reviewed. Upserts by (key, locale).

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('STRAT_FVG_WAIT_NONE','en','No open gap: every recent gap has been returned to or filled.'),
('STRAT_FVG_WAIT_NONE','ko','열린 갭이 없습니다: 최근 갭이 모두 재진입되었거나 메워졌습니다.'),
('STRAT_FVG_WAIT_NONE','zh','没有未回补的缺口：近期缺口均已被回测或回补。'),
('STRAT_FVG_WAIT_NONE','ru','Открытых разрывов нет: каждый недавний разрыв уже протестирован или закрыт.'),
('STRAT_FVG_WAIT_NONE','ar','لا توجد فجوة مفتوحة: كل فجوة حديثة أُعيد اختبارها أو أُغلقت.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('STRAT_FVG_WAIT_NONE','en','No open gap: every recent gap has been returned to or filled.'),
('STRAT_FVG_WAIT_NONE','ko','열린 갭이 없습니다: 최근 갭이 모두 재진입되었거나 메워졌습니다.'),
('STRAT_FVG_WAIT_NONE','zh','没有未回补的缺口：近期缺口均已被回测或回补。'),
('STRAT_FVG_WAIT_NONE','ru','Открытых разрывов нет: каждый недавний разрыв уже протестирован или закрыт.'),
('STRAT_FVG_WAIT_NONE','ar','لا توجد فجوة مفتوحة: كل فجوة حديثة أُعيد اختبارها أو أُغلقت.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
