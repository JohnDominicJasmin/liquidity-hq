-- #1571 (owner, 2026-10-17): the Privacy page names Lemon Squeezy as the payments provider. Lemon Squeezy rejected the store and the provider is
-- Whop, so the Whop PDF and the site disagreed. ONE key, five locales: PRIVACY_SECTION_THIRD_PARTY_BODY.
--
-- Read (select only) on PROD 2026-10-17: all five locale rows exist and every one names "Lemon Squeezy" (en, ar, ko, ru, zh); no other label in
-- any locale carries the name (searched by the Latin name and by its common transliterations). The values below are the LIVE values with ONLY
-- the provider name changed to "Whop"; nothing else in the paragraph is touched (the other providers, the disclaimer sentence). The name stays
-- in Latin script in every locale, as the other provider names do. ar/ko/ru/zh were machine-translated earlier and are not native-reviewed.
--
-- Also changed: lib/labelDefaults.en.json (the English default), so the build-time fallback and the table say the same thing.
-- NOT changed: "Last updated" on the Privacy page; the owner's scope was the provider name only. Not legal advice.
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out (apply one section at a time, to dev only when QA says
-- no test pass is running).
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).

insert into lhq_labels (key, locale, value) values
('PRIVACY_SECTION_THIRD_PARTY_BODY','en','LiquidityHQ integrates with third-party services including Supabase (database), PostHog (product analytics and session recording), xAI Grok (AI analysis), Brevo (email delivery), Whop (payments), Binance and Bybit (price, funding, and open interest data), Finnhub (news and economic calendar), and Alternative.me (Fear & Greed index). These providers have their own privacy policies and data practices. We are not responsible for their data handling.'),
('PRIVACY_SECTION_THIRD_PARTY_BODY','ar','تتكامل LiquidityHQ مع خدمات طرف ثالث تشمل Supabase (قاعدة البيانات)، وPostHog (تحليلات المنتج وتسجيل الجلسات)، وxAI Grok (تحليل بالذكاء الاصطناعي)، وBrevo (إرسال البريد الإلكتروني)، وWhop (المدفوعات)، وBinance وBybit (بيانات الأسعار والتمويل والفائدة المفتوحة)، وFinnhub (الأخبار والتقويم الاقتصادي)، وAlternative.me (مؤشر الخوف والجشع). لهذه الجهات سياسات خصوصية وممارسات بيانات خاصة بها، ولسنا مسؤولين عن كيفية تعاملها مع البيانات.'),
('PRIVACY_SECTION_THIRD_PARTY_BODY','ko','LiquidityHQ는 Supabase(데이터베이스), PostHog(제품 분석 및 세션 기록), xAI Grok(AI 분석), Brevo(이메일 발송), Whop(결제), 바이낸스 및 바이빗(가격·펀딩비·미결제약정 데이터), Finnhub(뉴스 및 경제 캘린더), Alternative.me(공포·탐욕 지수) 등 제3자 서비스와 연동됩니다. 이러한 제공업체는 자체 개인정보 처리방침과 데이터 관행을 따르며, 당사는 이들의 데이터 처리에 대해 책임지지 않습니다.'),
('PRIVACY_SECTION_THIRD_PARTY_BODY','ru','LiquidityHQ использует сторонние сервисы, включая Supabase (база данных), PostHog (аналитика продукта и запись сессий), xAI Grok (AI-анализ), Brevo (доставка почты), Whop (платежи), Binance и Bybit (данные о цене, фандинге и открытом интересе), Finnhub (новости и экономический календарь) и Alternative.me (индекс страха и жадности). Эти поставщики имеют собственные политики конфиденциальности и практики обработки данных - мы не несём ответственности за то, как они обрабатывают данные.'),
('PRIVACY_SECTION_THIRD_PARTY_BODY','zh','LiquidityHQ 集成了以下第三方服务：Supabase（数据库）、PostHog（产品分析与会话录制）、xAI Grok（AI 分析）、Brevo（邮件发送）、Whop（支付）、币安与 Bybit（价格、资金费率及未平仓合约数据）、Finnhub（新闻与经济日历）以及 Alternative.me（恐惧与贪婪指数）。这些服务提供商各自拥有独立的隐私政策与数据处理方式，我们不对其数据处理行为负责。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: the same rows against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('PRIVACY_SECTION_THIRD_PARTY_BODY','en','LiquidityHQ integrates with third-party services including Supabase (database), PostHog (product analytics and session recording), xAI Grok (AI analysis), Brevo (email delivery), Whop (payments), Binance and Bybit (price, funding, and open interest data), Finnhub (news and economic calendar), and Alternative.me (Fear & Greed index). These providers have their own privacy policies and data practices. We are not responsible for their data handling.'),
-- ('PRIVACY_SECTION_THIRD_PARTY_BODY','ar','تتكامل LiquidityHQ مع خدمات طرف ثالث تشمل Supabase (قاعدة البيانات)، وPostHog (تحليلات المنتج وتسجيل الجلسات)، وxAI Grok (تحليل بالذكاء الاصطناعي)، وBrevo (إرسال البريد الإلكتروني)، وWhop (المدفوعات)، وBinance وBybit (بيانات الأسعار والتمويل والفائدة المفتوحة)، وFinnhub (الأخبار والتقويم الاقتصادي)، وAlternative.me (مؤشر الخوف والجشع). لهذه الجهات سياسات خصوصية وممارسات بيانات خاصة بها، ولسنا مسؤولين عن كيفية تعاملها مع البيانات.'),
-- ('PRIVACY_SECTION_THIRD_PARTY_BODY','ko','LiquidityHQ는 Supabase(데이터베이스), PostHog(제품 분석 및 세션 기록), xAI Grok(AI 분석), Brevo(이메일 발송), Whop(결제), 바이낸스 및 바이빗(가격·펀딩비·미결제약정 데이터), Finnhub(뉴스 및 경제 캘린더), Alternative.me(공포·탐욕 지수) 등 제3자 서비스와 연동됩니다. 이러한 제공업체는 자체 개인정보 처리방침과 데이터 관행을 따르며, 당사는 이들의 데이터 처리에 대해 책임지지 않습니다.'),
-- ('PRIVACY_SECTION_THIRD_PARTY_BODY','ru','LiquidityHQ использует сторонние сервисы, включая Supabase (база данных), PostHog (аналитика продукта и запись сессий), xAI Grok (AI-анализ), Brevo (доставка почты), Whop (платежи), Binance и Bybit (данные о цене, фандинге и открытом интересе), Finnhub (новости и экономический календарь) и Alternative.me (индекс страха и жадности). Эти поставщики имеют собственные политики конфиденциальности и практики обработки данных - мы не несём ответственности за то, как они обрабатывают данные.'),
-- ('PRIVACY_SECTION_THIRD_PARTY_BODY','zh','LiquidityHQ 集成了以下第三方服务：Supabase（数据库）、PostHog（产品分析与会话录制）、xAI Grok（AI 分析）、Brevo（邮件发送）、Whop（支付）、币安与 Bybit（价格、资金费率及未平仓合约数据）、Finnhub（新闻与经济日历）以及 Alternative.me（恐惧与贪婪指数）。这些服务提供商各自拥有独立的隐私政策与数据处理方式，我们不对其数据处理行为负责。')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
