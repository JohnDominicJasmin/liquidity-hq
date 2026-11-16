-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- New keys BRIEFING_CALENDAR_UNAVAILABLE and BRIEFING_ETF_FLAT. English also ships in lib/labelDefaults.en.json (new keys, nothing stored to override); the en rows are included
-- so a stored-label environment has them. ko/zh/ru/ar are AI-drafted and not native-reviewed.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('BRIEFING_CALENDAR_UNAVAILABLE','ko','경제 캘린더를 지금 사용할 수 없습니다. 예정된 이벤트가 표시되지 않습니다.'),
('BRIEFING_ETF_FLAT','ko','보합'),
('BRIEFING_CALENDAR_UNAVAILABLE','zh','经济日历暂不可用,未显示已安排的事件。'),
('BRIEFING_ETF_FLAT','zh','持平'),
('BRIEFING_CALENDAR_UNAVAILABLE','ru','Экономический календарь сейчас недоступен. Запланированные события не показаны.'),
('BRIEFING_ETF_FLAT','ru','Без изменений'),
('BRIEFING_CALENDAR_UNAVAILABLE','ar','التقويم الاقتصادي غير متاح الآن. لا تُعرض الأحداث المجدولة.'),
('BRIEFING_ETF_FLAT','ar','مستقر'),
('BRIEFING_CALENDAR_UNAVAILABLE','en','Economic calendar unavailable right now. Scheduled events are not shown.'),
('BRIEFING_ETF_FLAT','en','Flat')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('BRIEFING_CALENDAR_UNAVAILABLE','ko','경제 캘린더를 지금 사용할 수 없습니다. 예정된 이벤트가 표시되지 않습니다.'),
('BRIEFING_ETF_FLAT','ko','보합'),
('BRIEFING_CALENDAR_UNAVAILABLE','zh','经济日历暂不可用,未显示已安排的事件。'),
('BRIEFING_ETF_FLAT','zh','持平'),
('BRIEFING_CALENDAR_UNAVAILABLE','ru','Экономический календарь сейчас недоступен. Запланированные события не показаны.'),
('BRIEFING_ETF_FLAT','ru','Без изменений'),
('BRIEFING_CALENDAR_UNAVAILABLE','ar','التقويم الاقتصادي غير متاح الآن. لا تُعرض الأحداث المجدولة.'),
('BRIEFING_ETF_FLAT','ar','مستقر'),
('BRIEFING_CALENDAR_UNAVAILABLE','en','Economic calendar unavailable right now. Scheduled events are not shown.'),
('BRIEFING_ETF_FLAT','en','Flat')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
