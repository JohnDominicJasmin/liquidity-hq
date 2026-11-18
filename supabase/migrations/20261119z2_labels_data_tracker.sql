-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- #1651 data tracker, owner sweep 2026-11-18. Two keys x 5 locales; en equals the shipped defaults. ko/zh/ru/ar AI-drafted, not native-reviewed.
--   ALERTS_FIRED_LIST       "Check Alerts Now" lists what is active and sends nothing, so it no longer says "Fired:".
--   ALERTS_MACRO_NEWS_DESC  the "Macro headlines" switch now also covers the reminder before each macro release (app/api/macro-alert).
-- Sorts after 20261119k (which also writes ALERTS_MACRO_NEWS_DESC), so applying in file order leaves this value.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('ALERTS_FIRED_LIST','en','Active now (not sent): {list}'),
('ALERTS_FIRED_LIST','ko','지금 활성 (전송 안 됨): {list}'),
('ALERTS_FIRED_LIST','zh','当前生效（未发送）：{list}'),
('ALERTS_FIRED_LIST','ru','Активно сейчас (не отправлено): {list}'),
('ALERTS_FIRED_LIST','ar','نشط الآن (لم يُرسل): {list}'),
('ALERTS_MACRO_NEWS_DESC','en','Fed, inflation and jobs headlines, and a reminder about an hour before each release.'),
('ALERTS_MACRO_NEWS_DESC','ko','연준, 물가, 고용 관련 헤드라인과 각 발표 약 1시간 전 알림.'),
('ALERTS_MACRO_NEWS_DESC','zh','美联储、通胀和就业相关新闻，以及每次数据公布前约一小时的提醒。'),
('ALERTS_MACRO_NEWS_DESC','ru','Новости о ФРС, инфляции и занятости и напоминание примерно за час до каждой публикации.'),
('ALERTS_MACRO_NEWS_DESC','ar','عناوين عن الفيدرالي والتضخم والوظائف، وتذكير قبل كل إصدار بنحو ساعة.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('ALERTS_FIRED_LIST','en','Active now (not sent): {list}'),
('ALERTS_FIRED_LIST','ko','지금 활성 (전송 안 됨): {list}'),
('ALERTS_FIRED_LIST','zh','当前生效（未发送）：{list}'),
('ALERTS_FIRED_LIST','ru','Активно сейчас (не отправлено): {list}'),
('ALERTS_FIRED_LIST','ar','نشط الآن (لم يُرسل): {list}'),
('ALERTS_MACRO_NEWS_DESC','en','Fed, inflation and jobs headlines, and a reminder about an hour before each release.'),
('ALERTS_MACRO_NEWS_DESC','ko','연준, 물가, 고용 관련 헤드라인과 각 발표 약 1시간 전 알림.'),
('ALERTS_MACRO_NEWS_DESC','zh','美联储、通胀和就业相关新闻，以及每次数据公布前约一小时的提醒。'),
('ALERTS_MACRO_NEWS_DESC','ru','Новости о ФРС, инфляции и занятости и напоминание примерно за час до каждой публикации.'),
('ALERTS_MACRO_NEWS_DESC','ar','عناوين عن الفيدرالي والتضخم والوظائف، وتذكير قبل كل إصدار بنحو ساعة.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
