-- Antislop audit 001, batch 2, PR A (factual corrections) - #1309 items
-- 36, 37, 38, 39, 40, 41, 42, 43, 44, 54, 57. Owner-approved batch, tracked
-- on #1309. Every key here is corrected to what the code actually does, or
-- has an unsourced/unsupported claim removed - no new facts invented, see
-- the PR description for the file:line citation behind each change.
--
-- en rows are the source of truth and match lib/labelDefaults.en.json
-- exactly. ar/ko/ru/zh rows are MACHINE-TRANSLATED (not reviewed by a
-- native speaker) - the same standard already used for the 2026-07/08
-- translation waves, called out explicitly here per PM/DevOps's decision
-- that a fix landing on en alone leaves four languages still carrying the
-- false claim.
--
-- Two items are correctly absent from this file:
--   - Item 42/57's Telegram strings in app/api/telegram/alert/route.ts and
--     item 43/44's hardcoded JSX/template strings (LandingTerminal.tsx,
--     LandingTicker.tsx, OnboardingFlow.tsx, lib/perpSpot.ts,
--     app/forgot-password/page.tsx, app/global-error.tsx) are code, not
--     lhq_labels rows - fixed directly in their source files instead.
--   - lib/i18n/dictionaries.ts (the landing page's own separate, code-only
--     i18n system - en/ko/zh, not the lhq_labels table) is likewise fixed
--     directly in that file for the 3 keys this batch touches.
--
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and
-- lhq_dev_labels (dev, wdtjhrilakoitfcezxpx). The dev section below is
-- commented out per 20260912b's convention - apply separately, and this is
-- a shared-database write that needs the owner's go at release time.

insert into lhq_labels (key, locale, value) values

('DISCLAIMER_SECTION_DATA_PROVIDERS_BODY','en','Price, funding, and open interest data come from Binance and Bybit. News comes from Finnhub and RSS feeds, and the Fear & Greed index comes from Alternative.me. These services operate independently of LiquidityHQ. We do not guarantee their accuracy, completeness, or availability. Feeds can lag, drop, or briefly disagree with the exchange you actually trade on.'),
('DISCLAIMER_SECTION_DATA_PROVIDERS_BODY','ko','가격, 펀딩비, 미결제약정 데이터는 바이낸스와 바이빗에서 제공됩니다. 뉴스는 Finnhub와 RSS 피드에서, 공포·탐욕 지수는 Alternative.me에서 제공됩니다. 이 서비스들은 LiquidityHQ와 독립적으로 운영되며, 당사는 이들의 정확성, 완전성, 가용성을 보장하지 않습니다. 피드는 지연되거나 끊기거나 실제 거래소와 일시적으로 다를 수 있습니다.'),
('DISCLAIMER_SECTION_DATA_PROVIDERS_BODY','zh','价格、资金费率和未平仓合约数据来自币安和Bybit。新闻来自Finnhub和RSS订阅源，恐惧与贪婪指数来自Alternative.me。这些服务独立于LiquidityHQ运营。我们不保证其准确性、完整性或可用性。数据流可能延迟、中断，或与您实际交易的交易所短暂不一致。'),
('DISCLAIMER_SECTION_DATA_PROVIDERS_BODY','ar','تأتي بيانات الأسعار والتمويل والفائدة المفتوحة من Binance وBybit. تأتي الأخبار من Finnhub وموجزات RSS، ويأتي مؤشر الخوف والجشع من Alternative.me. تعمل هذه الخدمات بشكل مستقل عن LiquidityHQ. نحن لا نضمن دقتها أو اكتمالها أو توفرها. قد تتأخر البيانات أو تنقطع أو تختلف قليلاً عن البورصة التي تتداول عليها فعليًا.'),
('DISCLAIMER_SECTION_DATA_PROVIDERS_BODY','ru','Данные о цене, фандинге и открытом интересе поступают от Binance и Bybit. Новости - от Finnhub и RSS-каналов, индекс страха и жадности - от Alternative.me. Эти сервисы работают независимо от LiquidityHQ. Мы не гарантируем их точность, полноту или доступность. Данные могут задерживаться, пропадать или временно расходиться с биржей, на которой вы торгуете.'),

('PRIVACY_SECTION_THIRD_PARTY_BODY','en','LiquidityHQ integrates with third-party services including Supabase (database), PostHog (product analytics and session recording), xAI Grok (AI analysis), Brevo (email delivery), Lemon Squeezy (payments), Binance and Bybit (price, funding, and open interest data), Finnhub (news and economic calendar), and Alternative.me (Fear & Greed index). These providers have their own privacy policies and data practices. We are not responsible for their data handling.'),
('PRIVACY_SECTION_THIRD_PARTY_BODY','ko','LiquidityHQ는 Supabase(데이터베이스), PostHog(제품 분석 및 세션 기록), xAI Grok(AI 분석), Brevo(이메일 발송), Lemon Squeezy(결제), 바이낸스 및 바이빗(가격·펀딩비·미결제약정 데이터), Finnhub(뉴스 및 경제 캘린더), Alternative.me(공포·탐욕 지수) 등 제3자 서비스와 연동됩니다. 이러한 제공업체는 자체 개인정보 처리방침과 데이터 관행을 따르며, 당사는 이들의 데이터 처리에 대해 책임지지 않습니다.'),
('PRIVACY_SECTION_THIRD_PARTY_BODY','zh','LiquidityHQ 集成了以下第三方服务：Supabase（数据库）、PostHog（产品分析与会话录制）、xAI Grok（AI 分析）、Brevo（邮件发送）、Lemon Squeezy（支付）、币安与 Bybit（价格、资金费率及未平仓合约数据）、Finnhub（新闻与经济日历）以及 Alternative.me（恐惧与贪婪指数）。这些服务提供商各自拥有独立的隐私政策与数据处理方式，我们不对其数据处理行为负责。'),
('PRIVACY_SECTION_THIRD_PARTY_BODY','ar','تتكامل LiquidityHQ مع خدمات طرف ثالث تشمل Supabase (قاعدة البيانات)، وPostHog (تحليلات المنتج وتسجيل الجلسات)، وxAI Grok (تحليل بالذكاء الاصطناعي)، وBrevo (إرسال البريد الإلكتروني)، وLemon Squeezy (المدفوعات)، وBinance وBybit (بيانات الأسعار والتمويل والفائدة المفتوحة)، وFinnhub (الأخبار والتقويم الاقتصادي)، وAlternative.me (مؤشر الخوف والجشع). لهذه الجهات سياسات خصوصية وممارسات بيانات خاصة بها، ولسنا مسؤولين عن كيفية تعاملها مع البيانات.'),
('PRIVACY_SECTION_THIRD_PARTY_BODY','ru','LiquidityHQ использует сторонние сервисы, включая Supabase (база данных), PostHog (аналитика продукта и запись сессий), xAI Grok (AI-анализ), Brevo (доставка почты), Lemon Squeezy (платежи), Binance и Bybit (данные о цене, фандинге и открытом интересе), Finnhub (новости и экономический календарь) и Alternative.me (индекс страха и жадности). Эти поставщики имеют собственные политики конфиденциальности и практики обработки данных - мы не несём ответственности за то, как они обрабатывают данные.'),

('FAQ_Q_DATA_SOURCES_A','en','Price, funding, and open interest data comes from Binance and Bybit. News comes from Finnhub, and the Fear & Greed index comes from Alternative.me. We do not guarantee the accuracy, completeness, or availability of any third-party feed.'),
('FAQ_Q_DATA_SOURCES_A','ko','가격, 펀딩비, 미결제약정 데이터는 바이낸스와 바이빗에서 제공됩니다. 뉴스는 Finnhub에서, 공포·탐욕 지수는 Alternative.me에서 제공됩니다. 타사 피드의 정확성, 완전성, 가용성은 보장하지 않습니다.'),
('FAQ_Q_DATA_SOURCES_A','zh','价格、资金费率和未平仓合约数据来自币安和Bybit。新闻来自Finnhub，恐惧与贪婪指数来自Alternative.me。我们不保证任何第三方数据源的准确性、完整性或可用性。'),
('FAQ_Q_DATA_SOURCES_A','ar','تأتي بيانات الأسعار والتمويل والفائدة المفتوحة من Binance وBybit. تأتي الأخبار من Finnhub، ويأتي مؤشر الخوف والجشع من Alternative.me. نحن لا نضمن دقة أو اكتمال أو توفر أي مصدر بيانات خارجي.'),
('FAQ_Q_DATA_SOURCES_A','ru','Данные о цене, фандинге и открытом интересе поступают от Binance и Bybit. Новости - от Finnhub, индекс страха и жадности - от Alternative.me. Мы не гарантируем точность, полноту или доступность сторонних источников.'),

('ABOUT_DATA_SOURCE_BREAKING_NEWS_VALUE','en','Finnhub REST API'),
('ABOUT_DATA_SOURCE_BREAKING_NEWS_VALUE','ko','Finnhub REST API'),
('ABOUT_DATA_SOURCE_BREAKING_NEWS_VALUE','zh','Finnhub REST API'),
('ABOUT_DATA_SOURCE_BREAKING_NEWS_VALUE','ar','Finnhub REST API'),
('ABOUT_DATA_SOURCE_BREAKING_NEWS_VALUE','ru','Finnhub REST API'),

('ABOUT_DATA_SOURCE_CRYPTO_NEWS_VALUE','en','Finnhub REST API + RSS (CoinDesk, CoinTelegraph, Decrypt, The Block)'),
('ABOUT_DATA_SOURCE_CRYPTO_NEWS_VALUE','ko','Finnhub REST API + RSS (CoinDesk, CoinTelegraph, Decrypt, The Block)'),
('ABOUT_DATA_SOURCE_CRYPTO_NEWS_VALUE','zh','Finnhub REST API + RSS (CoinDesk, CoinTelegraph, Decrypt, The Block)'),
('ABOUT_DATA_SOURCE_CRYPTO_NEWS_VALUE','ar','Finnhub REST API + RSS (CoinDesk, CoinTelegraph, Decrypt, The Block)'),
('ABOUT_DATA_SOURCE_CRYPTO_NEWS_VALUE','ru','Finnhub REST API + RSS (CoinDesk, CoinTelegraph, Decrypt, The Block)'),

('ALERTS_PAGE_SUBTITLE','en','Push alerts to your phone, checked every 5 minutes - funding, momentum, whale flow, sentiment, and price levels'),
('ALERTS_PAGE_SUBTITLE','ko','5분마다 확인하여 휴대폰으로 푸시 알림을 보냅니다 - 펀딩비, 모멘텀, 고래 흐름, 심리, 가격 레벨'),
('ALERTS_PAGE_SUBTITLE','zh','每5分钟检查一次，推送到您的手机 - 资金费率、动能、巨鲸流向、市场情绪和价格水平'),
('ALERTS_PAGE_SUBTITLE','ar','تنبيهات فورية إلى هاتفك، يتم فحصها كل 5 دقائق - التمويل، الزخم، تدفق الحيتان، المعنويات، ومستويات الأسعار'),
('ALERTS_PAGE_SUBTITLE','ru','Push-уведомления на телефон, проверка каждые 5 минут - фандинг, моментум, потоки китов, настроения и ценовые уровни'),

('ALERTS_PRICE_LOCKED_DESC','en','Get a Telegram ping within 5 minutes of a coin crossing a price you care about.'),
('ALERTS_PRICE_LOCKED_DESC','ko','관심 있는 가격을 코인이 돌파하면 5분 이내에 텔레그램 알림을 받으세요.'),
('ALERTS_PRICE_LOCKED_DESC','zh','当币价突破您关注的价位后，5分钟内即可收到 Telegram 通知。'),
('ALERTS_PRICE_LOCKED_DESC','ar','احصل على تنبيه عبر تيليجرام خلال 5 دقائق من تجاوز العملة للسعر الذي يهمك.'),
('ALERTS_PRICE_LOCKED_DESC','ru','Получите уведомление в Telegram в течение 5 минут после того, как монета пересечёт нужную вам цену.'),

('SPOTLIGHT_TOUR_STEP4_BODY','en','Funding rate, long/short ratio, taker pressure, and volume are combined into a single score. When it hits 70+, a Telegram alert fires on the next check, within 5 minutes.'),
('SPOTLIGHT_TOUR_STEP4_BODY','ko','펀딩비, 롱숏 비율, 테이커 압력, 거래량을 하나의 점수로 결합합니다. 점수가 70 이상이 되면 다음 체크 시점(5분 이내)에 텔레그램 알림이 발송됩니다.'),
('SPOTLIGHT_TOUR_STEP4_BODY','zh','将资金费率、多空比、吃单压力和成交量综合为单一评分。当评分达到70以上时，会在下一次检查时（5分钟内）发送Telegram提醒。'),
('SPOTLIGHT_TOUR_STEP4_BODY','ar','يتم دمج معدل التمويل، ونسبة الشراء إلى البيع، وضغط الآخذين، وحجم التداول في درجة واحدة. عند وصولها إلى 70+، يتم إرسال تنبيه عبر تيليجرام في الفحص التالي، خلال 5 دقائق.'),
('SPOTLIGHT_TOUR_STEP4_BODY','ru','Ставка финансирования, соотношение лонг/шорт, давление тейкеров и объём объединяются в единый показатель. При достижении 70+ уведомление в Telegram придёт при следующей проверке, в течение 5 минут.'),

('HOURS_WIN_GOD_BADGE','en','LOW VOLUME'),
('HOURS_WIN_GOD_BADGE','ko','낮은 거래량'),
('HOURS_WIN_GOD_BADGE','zh','低成交量'),
('HOURS_WIN_GOD_BADGE','ar','حجم تداول منخفض'),
('HOURS_WIN_GOD_BADGE','ru','НИЗКИЙ ОБЪЁМ'),

('HOURS_WIN_GOD_DESC','en','Lowest volume of the week. Retail asleep globally. Minimum capital needed to move price. Maximum priority.'),
('HOURS_WIN_GOD_DESC','ko','주간 최저 거래량 구간입니다. 전 세계 리테일 트레이더들이 잠든 시간입니다. 가격을 움직이는 데 필요한 자본이 최소입니다. 최우선 순위입니다.'),
('HOURS_WIN_GOD_DESC','zh','全周最低成交量时段。全球散户都在休息。推动价格所需资金最少。最高优先级。'),
('HOURS_WIN_GOD_DESC','ar','أدنى حجم تداول في الأسبوع. المتداولون الأفراد نائمون عالميًا. أقل رأس مال مطلوب لتحريك السعر. أولوية قصوى.'),
('HOURS_WIN_GOD_DESC','ru','Самый низкий объём за неделю. Розничные трейдеры по всему миру спят. Минимум капитала нужен, чтобы сдвинуть цену. Максимальный приоритет.'),

('HOURS_WIN_MON_EVE_DESC','en','Weekly liquidity build-up complete. US session active. Strong trend continuation or violent reversal setups.'),
('HOURS_WIN_MON_EVE_DESC','ko','주간 유동성 축적이 완료되었습니다. 미국 세션이 활성화됩니다. 강한 추세 지속 또는 급격한 반전 셋업이 나타납니다.'),
('HOURS_WIN_MON_EVE_DESC','zh','每周流动性积累完成。美国交易时段活跃。适合强势趋势延续或剧烈反转形态。'),
('HOURS_WIN_MON_EVE_DESC','ar','اكتمل تراكم السيولة الأسبوعي. جلسة التداول الأمريكية نشطة. إعدادات استمرار اتجاه قوي أو انعكاس حاد.'),
('HOURS_WIN_MON_EVE_DESC','ru','Недельное накопление ликвидности завершено. Активна американская сессия. Сильное продолжение тренда или резкие развороты.'),

('HOURS_WIN_LONDON_TIME','en','3PM – 6PM PHT (7–10AM UTC)'),
('HOURS_WIN_LONDON_TIME','ko','3PM – 6PM PHT (7–10AM UTC)'),
('HOURS_WIN_LONDON_TIME','zh','3PM – 6PM PHT (7–10AM UTC)'),
('HOURS_WIN_LONDON_TIME','ar','3PM – 6PM PHT (7–10AM UTC)'),
('HOURS_WIN_LONDON_TIME','ru','3PM – 6PM PHT (7–10AM UTC)'),

('HOURS_WIN_PRIME_DESC','en','US session hours. Volume picks up. Best daily window for clean setups. 20:00–20:45 UTC is the single most consistent reversal sub-window.'),
('HOURS_WIN_PRIME_DESC','ko','미국 세션 시간대입니다. 거래량이 증가합니다. 깔끔한 셋업을 위한 하루 중 최적의 시간대입니다. 20:00–20:45 UTC는 가장 일관된 반전 구간입니다.'),
('HOURS_WIN_PRIME_DESC','zh','美国交易时段。成交量回升。是形成清晰形态的每日最佳窗口。20:00–20:45 UTC 是最稳定的反转子窗口。'),
('HOURS_WIN_PRIME_DESC','ar','ساعات جلسة التداول الأمريكية. يزداد حجم التداول. أفضل نافذة يومية للإعدادات الواضحة. الفترة 20:00–20:45 بتوقيت UTC هي أكثر نافذة انعكاس اتساقًا.'),
('HOURS_WIN_PRIME_DESC','ru','Часы американской сессии. Объём растёт. Лучшее дневное окно для чётких сетапов. 20:00–20:45 UTC - самое стабильное окно разворота.'),

('FUNDING_SIG_LONGS_OVERCROWDED_DESC','en','The market is extremely long-heavy. Traders are paying 0.05%+ every 8h just to stay long - they are overleveraged. Whales have incentive to dump price and mass-liquidate these longs.'),
('FUNDING_SIG_LONGS_OVERCROWDED_DESC','ko','시장이 극도로 롱에 치우쳐 있습니다. 트레이더들은 롱 포지션을 유지하기 위해 8시간마다 0.05% 이상을 지불하고 있으며, 이는 과도한 레버리지 상태입니다. 고래들은 가격을 떨어뜨려 이 롱 포지션들을 대량 청산시킬 유인이 있습니다.'),
('FUNDING_SIG_LONGS_OVERCROWDED_DESC','zh','市场极度偏多。交易者为维持多头每8小时支付0.05%以上的费率 - 属于过度杠杆。巨鲸有动机打压价格，大规模清算这些多头。'),
('FUNDING_SIG_LONGS_OVERCROWDED_DESC','ar','السوق مثقل جدًا بالمراكز الشرائية (اللونغ). يدفع المتداولون أكثر من 0.05% كل 8 ساعات فقط للبقاء في مراكزهم الشرائية - وهذا يعني رافعة مالية مفرطة. لدى الحيتان حافز لإسقاط السعر وتصفية هذه المراكز الشرائية بشكل جماعي.'),
('FUNDING_SIG_LONGS_OVERCROWDED_DESC','ru','Рынок сильно перегружен лонгами. Трейдеры платят 0.05%+ каждые 8 часов только за удержание лонга - это признак чрезмерного плеча. У китов есть стимул обвалить цену и массово ликвидировать эти лонги.'),

('FUNDING_SIG_SHORTS_CROWDED_ACTION','en','Shorts are crowded here - a squeeze setup, not a short signal.'),
('FUNDING_SIG_SHORTS_CROWDED_ACTION','ko','숏 포지션이 과도하게 몰려 있습니다 - 숏 신호가 아니라 스퀴즈 셋업입니다.'),
('FUNDING_SIG_SHORTS_CROWDED_ACTION','zh','此处空头过度拥挤 - 这是挤压形态，而非做空信号。'),
('FUNDING_SIG_SHORTS_CROWDED_ACTION','ar','الشورت مزدحم هنا - هذا إعداد ضغط (سكويز)، وليس إشارة بيع.'),
('FUNDING_SIG_SHORTS_CROWDED_ACTION','ru','Шорты здесь перегружены - это сетап сквиза, а не сигнал на шорт.'),

('FUNDING_SIG_SHORTS_OVERCROWDED_HINT','en','Squeeze setup'),
('FUNDING_SIG_SHORTS_OVERCROWDED_HINT','ko','스퀴즈 셋업'),
('FUNDING_SIG_SHORTS_OVERCROWDED_HINT','zh','挤压形态'),
('FUNDING_SIG_SHORTS_OVERCROWDED_HINT','ar','إعداد الضغط (سكويز)'),
('FUNDING_SIG_SHORTS_OVERCROWDED_HINT','ru','Сетап сквиза'),

('FUNDING_SIG_SHORTS_OVERCROWDED_ACTION','en','Shorts are extremely crowded - a squeeze setup, not a short signal.'),
('FUNDING_SIG_SHORTS_OVERCROWDED_ACTION','ko','숏 포지션이 극도로 몰려 있습니다 - 숏 신호가 아니라 스퀴즈 셋업입니다.'),
('FUNDING_SIG_SHORTS_OVERCROWDED_ACTION','zh','此处空头极度拥挤 - 这是挤压形态，而非做空信号。'),
('FUNDING_SIG_SHORTS_OVERCROWDED_ACTION','ar','الشورت مزدحم للغاية - هذا إعداد ضغط (سكويز)، وليس إشارة بيع.'),
('FUNDING_SIG_SHORTS_OVERCROWDED_ACTION','ru','Шорты здесь чрезвычайно перегружены - это сетап сквиза, а не сигнал на шорт.'),

('ARENA_BREAKDOWN_SHOW','en','Full breakdown - multi-timeframe, order flow, patterns, reasoning'),
('ARENA_BREAKDOWN_SHOW','ko','전체 분석 보기 - 멀티 타임프레임, 오더플로우, 패턴, 근거'),
('ARENA_BREAKDOWN_SHOW','zh','查看完整分析 - 多周期、订单流、形态、推理'),
('ARENA_BREAKDOWN_SHOW','ar','عرض التحليل الكامل - أطر زمنية متعددة، تدفق الأوامر، الأنماط، التفسير'),
('ARENA_BREAKDOWN_SHOW','ru','Полный разбор - несколько таймфреймов, ордерфлоу, паттерны, обоснование'),

('SETTINGS_TEST_PUSH_FAILED','en','Test failed - try again'),
('SETTINGS_TEST_PUSH_FAILED','ko','테스트 실패 - 다시 시도하세요'),
('SETTINGS_TEST_PUSH_FAILED','zh','测试失败 - 请重试'),
('SETTINGS_TEST_PUSH_FAILED','ar','فشل الاختبار - حاول مرة أخرى'),
('SETTINGS_TEST_PUSH_FAILED','ru','Тест не пройден - попробуйте снова'),

('SETTINGS_STATUS_FAILED','en','Couldn''t save - try again'),
('SETTINGS_STATUS_FAILED','ko','저장하지 못했습니다 - 다시 시도하세요'),
('SETTINGS_STATUS_FAILED','zh','保存失败 - 请重试'),
('SETTINGS_STATUS_FAILED','ar','تعذر الحفظ - حاول مرة أخرى'),
('SETTINGS_STATUS_FAILED','ru','Не удалось сохранить - попробуйте снова'),

('ABSORPTION_DETECTOR_FAILED','en','Couldn''t load - try again'),
('ABSORPTION_DETECTOR_FAILED','ko','불러오지 못했습니다 - 다시 시도하세요'),
('ABSORPTION_DETECTOR_FAILED','zh','加载失败 - 请重试'),
('ABSORPTION_DETECTOR_FAILED','ar','تعذر التحميل - حاول مرة أخرى'),
('ABSORPTION_DETECTOR_FAILED','ru','Не удалось загрузить - попробуйте снова'),

('MARKET_STRUCTURE_FAILED','en','Couldn''t load - try again'),
('MARKET_STRUCTURE_FAILED','ko','불러오지 못했습니다 - 다시 시도하세요'),
('MARKET_STRUCTURE_FAILED','zh','加载失败 - 请重试'),
('MARKET_STRUCTURE_FAILED','ar','تعذر التحميل - حاول مرة أخرى'),
('MARKET_STRUCTURE_FAILED','ru','Не удалось загрузить - попробуйте снова'),

('GLOBAL_MACRO_CONTEXT_FETCH_FAILED','en','Couldn''t load - try again'),
('GLOBAL_MACRO_CONTEXT_FETCH_FAILED','ko','불러오지 못했습니다 - 다시 시도하세요'),
('GLOBAL_MACRO_CONTEXT_FETCH_FAILED','zh','加载失败 - 请重试'),
('GLOBAL_MACRO_CONTEXT_FETCH_FAILED','ar','تعذر التحميل - حاول مرة أخرى'),
('GLOBAL_MACRO_CONTEXT_FETCH_FAILED','ru','Не удалось загрузить - попробуйте снова')

on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately (shared-database
-- write, owner-gated at release time, per 20260912b's convention). Kept
-- commented rather than duplicated 115 rows deep; re-run this same insert
-- with `lhq_labels` replaced by `lhq_dev_labels` when applying to dev.
