-- #1651 (owner-approved, 2026-10-27): /about named a provider we do not call, and a live processor was disclosed nowhere.
--
-- TWO KEYS.
--
--   ABOUT_DATA_SOURCE_ECON_CALENDAR_VALUE   "Finnhub Calendar API"  ->  the real sources
--   PRIVACY_SECTION_THIRD_PARTY_BODY        "Finnhub (news and economic calendar)"  ->  "Finnhub (news)" + FRED added
--
-- WHY. /api/econ-calendar NEVER CALLS FINNHUB. `git grep -in finnhub` over the route, lib/econSchedule.ts and the FRED path
-- returns nothing: the dates come from the agencies' own published schedules (BLS, BEA, Census, Fed) and the values from FRED.
-- Measured against the live production /api/labels payload on 2026-10-26, so this is the served value and not just the file.
--
-- That string is also the probable origin of a mis-specified tracker item ("the production Finnhub key returns nothing and is
-- dropped silently") - someone read /about, saw an empty table, and inferred a dead key. The label was the bug.
--
-- And FRED is used in 8 files (lib/fred.ts, both econ-calendar routes, /api/macro, lib/realYield.ts, lib/marketStore.ts,
-- lib/grok.ts, /arena) while appearing in NONE of /about, privacy, terms or the disclaimer. A processor disclosed nowhere is
-- the half of this the owner approved separately.
--
-- FINNHUB STAYS NAMED FOR NEWS in every locale, and that is not an oversight: app/api/news/ingest and app/api/telegram/alert
-- both call it. Only the "and economic calendar" half of the attribution is wrong.
--
-- SCOPE, stated because two neighbouring strings are still wrong and are NOT touched here - the owner approved these two keys:
-- TERMS_SECTION_THIRD_PARTY_DATA_BODY and DISCLAIMER_SECTION_DATA_PROVIDERS_BODY both enumerate providers and both omit FRED;
-- those two also omit CoinMarketCap, which /about does name. Reported on #1651, not fixed.
--
-- LOCALES. BOTH keys have FIVE rows: en, ar, ko, ru, zh.
--
-- The /about value was written here as FOUR, from the seed migrations - and a `ru` row exists in production that no
-- migration in this directory inserted. QA found it by running the check the next paragraph asks for, and it was
-- confirmed against the live /api/labels payload for all five locales. Left out, the RUSSIAN /about would have gone on
-- naming a provider the route never calls - the exact error this migration exists to correct.
--
-- `ko` AND `ru` BOTH HELD THE UNTRANSLATED ENGLISH STRING. That was right while the value was a proper noun
-- ("Finnhub Calendar API"); it is a description now, so both are translated here rather than left in English. THE DATABASE, NOT THIS DIRECTORY, IS THE RECORD: production rows exist that no migration inserted, so
-- whoever applies this should check for locale rows beyond these before assuming the set is complete. ar/ko/ru/zh here are
-- machine-translated and not native-reviewed, the same standing caveat as 20261017b.
--
-- The /about value changes from a product name to a description, so the ko row - which held the English "Finnhub Calendar API"
-- untranslated, correctly, since it was a proper noun - is translated here. The agency abbreviations stay in Latin script in
-- every locale, as the other provider names do.
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out (apply one section at a time, to dev
-- only when QA says no test pass is running).
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).

insert into lhq_labels (key, locale, value) values
('ABOUT_DATA_SOURCE_ECON_CALENDAR_VALUE','en','Official US agency schedules (BLS, BEA, Census, Fed) + FRED'),
('ABOUT_DATA_SOURCE_ECON_CALENDAR_VALUE','ar','الجداول الرسمية للوكالات الأمريكية (BLS، BEA، Census، Fed) + FRED'),
('ABOUT_DATA_SOURCE_ECON_CALENDAR_VALUE','ko','미국 정부기관 공식 일정 (BLS, BEA, Census, Fed) + FRED'),
('ABOUT_DATA_SOURCE_ECON_CALENDAR_VALUE','ru','Официальные графики агентств США (BLS, BEA, Census, Fed) + FRED'),
('ABOUT_DATA_SOURCE_ECON_CALENDAR_VALUE','zh','美国官方机构日程（BLS、BEA、Census、Fed）+ FRED'),
('PRIVACY_SECTION_THIRD_PARTY_BODY','en','LiquidityHQ integrates with third-party services including Supabase (database), PostHog (product analytics and session recording), xAI Grok (AI analysis), Brevo (email delivery), Whop (payments), Binance and Bybit (price, funding, and open interest data), Finnhub (news), FRED (St. Louis Federal Reserve economic data), and Alternative.me (Fear & Greed index). These providers have their own privacy policies and data practices. We are not responsible for their data handling.'),
('PRIVACY_SECTION_THIRD_PARTY_BODY','ar','تتكامل LiquidityHQ مع خدمات طرف ثالث تشمل Supabase (قاعدة البيانات)، وPostHog (تحليلات المنتج وتسجيل الجلسات)، وxAI Grok (تحليل بالذكاء الاصطناعي)، وBrevo (إرسال البريد الإلكتروني)، وWhop (المدفوعات)، وBinance وBybit (بيانات الأسعار والتمويل والفائدة المفتوحة)، وFinnhub (الأخبار)، وFRED (البيانات الاقتصادية لبنك الاحتياطي الفيدرالي في سانت لويس)، وAlternative.me (مؤشر الخوف والجشع). لهذه الجهات سياسات خصوصية وممارسات بيانات خاصة بها، ولسنا مسؤولين عن كيفية تعاملها مع البيانات.'),
('PRIVACY_SECTION_THIRD_PARTY_BODY','ko','LiquidityHQ는 Supabase(데이터베이스), PostHog(제품 분석 및 세션 기록), xAI Grok(AI 분석), Brevo(이메일 발송), Whop(결제), 바이낸스 및 바이빗(가격·펀딩비·미결제약정 데이터), Finnhub(뉴스), FRED(세인트루이스 연방준비은행 경제 데이터), Alternative.me(공포·탐욕 지수) 등 제3자 서비스와 연동됩니다. 이러한 제공업체는 자체 개인정보 처리방침과 데이터 관행을 따르며, 당사는 이들의 데이터 처리에 대해 책임지지 않습니다.'),
('PRIVACY_SECTION_THIRD_PARTY_BODY','ru','LiquidityHQ использует сторонние сервисы, включая Supabase (база данных), PostHog (аналитика продукта и запись сессий), xAI Grok (AI-анализ), Brevo (доставка почты), Whop (платежи), Binance и Bybit (данные о цене, фандинге и открытом интересе), Finnhub (новости), FRED (экономические данные ФРБ Сент-Луиса) и Alternative.me (индекс страха и жадности). Эти поставщики имеют собственные политики конфиденциальности и практики обработки данных - мы не несём ответственности за то, как они обрабатывают данные.'),
('PRIVACY_SECTION_THIRD_PARTY_BODY','zh','LiquidityHQ 集成了以下第三方服务：Supabase（数据库）、PostHog（产品分析与会话录制）、xAI Grok（AI 分析）、Brevo（邮件发送）、Whop（支付）、币安与 Bybit（价格、资金费率及未平仓合约数据）、Finnhub（新闻）、FRED（圣路易斯联邦储备银行经济数据）以及 Alternative.me（恐惧与贪婪指数）。这些服务提供商各自拥有独立的隐私政策与数据处理方式，我们不对其数据处理行为负责。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: the same rows against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('ABOUT_DATA_SOURCE_ECON_CALENDAR_VALUE','en','Official US agency schedules (BLS, BEA, Census, Fed) + FRED'),
-- ('ABOUT_DATA_SOURCE_ECON_CALENDAR_VALUE','ar','الجداول الرسمية للوكالات الأمريكية (BLS، BEA، Census، Fed) + FRED'),
-- ('ABOUT_DATA_SOURCE_ECON_CALENDAR_VALUE','ko','미국 정부기관 공식 일정 (BLS, BEA, Census, Fed) + FRED'),
-- ('ABOUT_DATA_SOURCE_ECON_CALENDAR_VALUE','ru','Официальные графики агентств США (BLS, BEA, Census, Fed) + FRED'),
-- ('ABOUT_DATA_SOURCE_ECON_CALENDAR_VALUE','zh','美国官方机构日程（BLS、BEA、Census、Fed）+ FRED'),
-- ('PRIVACY_SECTION_THIRD_PARTY_BODY','en','LiquidityHQ integrates with third-party services including Supabase (database), PostHog (product analytics and session recording), xAI Grok (AI analysis), Brevo (email delivery), Whop (payments), Binance and Bybit (price, funding, and open interest data), Finnhub (news), FRED (St. Louis Federal Reserve economic data), and Alternative.me (Fear & Greed index). These providers have their own privacy policies and data practices. We are not responsible for their data handling.'),
-- ('PRIVACY_SECTION_THIRD_PARTY_BODY','ar','تتكامل LiquidityHQ مع خدمات طرف ثالث تشمل Supabase (قاعدة البيانات)، وPostHog (تحليلات المنتج وتسجيل الجلسات)، وxAI Grok (تحليل بالذكاء الاصطناعي)، وBrevo (إرسال البريد الإلكتروني)، وWhop (المدفوعات)، وBinance وBybit (بيانات الأسعار والتمويل والفائدة المفتوحة)، وFinnhub (الأخبار)، وFRED (البيانات الاقتصادية لبنك الاحتياطي الفيدرالي في سانت لويس)، وAlternative.me (مؤشر الخوف والجشع). لهذه الجهات سياسات خصوصية وممارسات بيانات خاصة بها، ولسنا مسؤولين عن كيفية تعاملها مع البيانات.'),
-- ('PRIVACY_SECTION_THIRD_PARTY_BODY','ko','LiquidityHQ는 Supabase(데이터베이스), PostHog(제품 분석 및 세션 기록), xAI Grok(AI 분석), Brevo(이메일 발송), Whop(결제), 바이낸스 및 바이빗(가격·펀딩비·미결제약정 데이터), Finnhub(뉴스), FRED(세인트루이스 연방준비은행 경제 데이터), Alternative.me(공포·탐욕 지수) 등 제3자 서비스와 연동됩니다. 이러한 제공업체는 자체 개인정보 처리방침과 데이터 관행을 따르며, 당사는 이들의 데이터 처리에 대해 책임지지 않습니다.'),
-- ('PRIVACY_SECTION_THIRD_PARTY_BODY','ru','LiquidityHQ использует сторонние сервисы, включая Supabase (база данных), PostHog (аналитика продукта и запись сессий), xAI Grok (AI-анализ), Brevo (доставка почты), Whop (платежи), Binance и Bybit (данные о цене, фандинге и открытом интересе), Finnhub (новости), FRED (экономические данные ФРБ Сент-Луиса) и Alternative.me (индекс страха и жадности). Эти поставщики имеют собственные политики конфиденциальности и практики обработки данных - мы не несём ответственности за то, как они обрабатывают данные.'),
-- ('PRIVACY_SECTION_THIRD_PARTY_BODY','zh','LiquidityHQ 集成了以下第三方服务：Supabase（数据库）、PostHog（产品分析与会话录制）、xAI Grok（AI 分析）、Brevo（邮件发送）、Whop（支付）、币安与 Bybit（价格、资金费率及未平仓合约数据）、Finnhub（新闻）、FRED（圣路易斯联邦储备银行经济数据）以及 Alternative.me（恐惧与贪婪指数）。这些服务提供商各自拥有独立的隐私政策与数据处理方式，我们不对其数据处理行为负责。')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
