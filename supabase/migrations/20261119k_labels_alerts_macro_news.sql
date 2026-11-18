-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- The "Macro headlines" switch on /alerts (owner sweep 2026-11-18): macro news alerts get their own on/off, separate from breaking news. Two keys x 5 locales; en equals the shipped defaults. ko/zh/ru/ar AI-drafted, not native-reviewed.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('ALERTS_MACRO_NEWS_TITLE','en','Macro headlines'),
('ALERTS_MACRO_NEWS_TITLE','ko','매크로 헤드라인'),
('ALERTS_MACRO_NEWS_TITLE','zh','宏观新闻'),
('ALERTS_MACRO_NEWS_TITLE','ru','Макро-новости'),
('ALERTS_MACRO_NEWS_TITLE','ar','عناوين الاقتصاد الكلي'),
('ALERTS_MACRO_NEWS_DESC','en','Fed, inflation and jobs headlines.'),
('ALERTS_MACRO_NEWS_DESC','ko','연준, 물가, 고용 관련 헤드라인.'),
('ALERTS_MACRO_NEWS_DESC','zh','美联储、通胀和就业相关新闻。'),
('ALERTS_MACRO_NEWS_DESC','ru','Новости о ФРС, инфляции и занятости.'),
('ALERTS_MACRO_NEWS_DESC','ar','عناوين عن الفيدرالي والتضخم والوظائف.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('ALERTS_MACRO_NEWS_TITLE','en','Macro headlines'),
('ALERTS_MACRO_NEWS_TITLE','ko','매크로 헤드라인'),
('ALERTS_MACRO_NEWS_TITLE','zh','宏观新闻'),
('ALERTS_MACRO_NEWS_TITLE','ru','Макро-новости'),
('ALERTS_MACRO_NEWS_TITLE','ar','عناوين الاقتصاد الكلي'),
('ALERTS_MACRO_NEWS_DESC','en','Fed, inflation and jobs headlines.'),
('ALERTS_MACRO_NEWS_DESC','ko','연준, 물가, 고용 관련 헤드라인.'),
('ALERTS_MACRO_NEWS_DESC','zh','美联储、通胀和就业相关新闻。'),
('ALERTS_MACRO_NEWS_DESC','ru','Новости о ФРС, инфляции и занятости.'),
('ALERTS_MACRO_NEWS_DESC','ar','عناوين عن الفيدرالي والتضخم والوظائف.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
