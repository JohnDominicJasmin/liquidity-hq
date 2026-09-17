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
('GLOBAL_MACRO_CONTEXT_FETCH_FAILED','ru','Не удалось загрузить - попробуйте снова'),

('LIQ_DISCLAIMER','en','Model only - price levels approximate 1/leverage and do not account for maintenance margin, funding, or fees; bar widths and USD amounts show relative density across tiers modeled from open interest.'),
('LIQ_DISCLAIMER','ko','모델일 뿐입니다 - 가격 레벨은 1/레버리지에 근사한 값이며 유지증거금, 펀딩비, 수수료는 반영하지 않습니다. 막대 너비와 USD 금액은 미결제약정을 기반으로 모델링된 구간별 상대적 밀집도를 나타냅니다.'),
('LIQ_DISCLAIMER','zh','仅为模型 - 价格水平近似于1/杠杆，未计入维持保证金、资金费率或手续费；柱宽和美元金额显示基于未平仓合约建模的各价位相对密度。'),
('LIQ_DISCLAIMER','ar','نموذج تقريبي فقط - مستويات الأسعار تقارب 1/الرافعة المالية ولا تأخذ في الاعتبار هامش الصيانة أو التمويل أو الرسوم؛ تُظهر عروض الأشرطة والمبالغ بالدولار الكثافة النسبية عبر المستويات المستندة إلى الفائدة المفتوحة.'),
('LIQ_DISCLAIMER','ru','Только модель - уровни цены приблизительно равны 1/плечо и не учитывают поддерживающую маржу, фандинг или комиссии; ширина полос и суммы в долларах показывают относительную плотность по уровням, смоделированную на основе открытого интереса.'),

('BRIEFING_HINT_BODY','en','Your market summary, generated on demand - top setups, key support and resistance levels, macro signals, and AI-generated trade ideas.'),
('BRIEFING_HINT_BODY','ko','요청 시 생성되는 시장 요약 - 주요 셋업, 핵심 지지/저항 레벨, 매크로 신호, AI가 생성한 트레이드 아이디어.'),
('BRIEFING_HINT_BODY','zh','按需生成的市场摘要 - 顶级形态、关键支撑阻力位、宏观信号，以及AI生成的交易创意。'),
('BRIEFING_HINT_BODY','ar','ملخص السوق الخاص بك، يُنشأ عند الطلب - أفضل الإعدادات، مستويات الدعم والمقاومة الرئيسية، الإشارات الكلية، وأفكار تداول من الذكاء الاصطناعي.'),
('BRIEFING_HINT_BODY','ru','Ваша рыночная сводка, формируется по запросу - лучшие сетапы, ключевые уровни поддержки и сопротивления, макросигналы и торговые идеи от AI.'),

('SIGNAL_ACCURACY_CACHE_NOTE','en','Updates hourly'),
('SIGNAL_ACCURACY_CACHE_NOTE','ko','매시간 업데이트'),
('SIGNAL_ACCURACY_CACHE_NOTE','zh','每小时更新'),
('SIGNAL_ACCURACY_CACHE_NOTE','ar','يتم التحديث كل ساعة'),
('SIGNAL_ACCURACY_CACHE_NOTE','ru','Обновляется ежечасно'),

('ARENA_ANTICHOP_TIP','en','Adds a stricter confirmation step: requires the EMA9/20 ribbon to clearly separate, price to close meaningfully past EMA50, and the move to hold for several candles before a marker confirms. Fewer, calmer-looking signals - but a 3-year backtest found this filter cuts the raw signal''s already-thin edge down to a coin flip (1.13 profit factor raw vs 0.98 filtered). OFF (default) shows every raw cross immediately, including some that reverse fast, but has the better track record. ON trades quieter alerts for a worse actual outcome.'),
('ARENA_ANTICHOP_TIP','ko','더 엄격한 확인 단계를 추가합니다: EMA9/20 리본이 뚜렷하게 벌어지고, 가격이 EMA50을 의미 있게 넘어 마감하며, 여러 캔들 동안 움직임이 유지되어야 마커가 확정됩니다. 신호는 줄어들고 더 차분해 보이지만, 3년간의 백테스트 결과 이 필터는 원본 신호의 이미 얇은 엣지를 동전 던지기 수준으로 낮췄습니다(원본 1.13 vs 필터링 0.98 손익비). OFF(기본값)는 빠르게 반전되는 것을 포함해 모든 원본 크로스를 즉시 보여주지만 실적은 더 좋습니다. ON은 더 조용한 알림 대신 실제 결과는 더 나쁩니다.'),
('ARENA_ANTICHOP_TIP','zh','增加更严格的确认步骤：需要EMA9/20带明显分离、价格有效收在EMA50之上/下，且该走势需持续数根K线后标记才会确认。信号更少、看起来更平稳 - 但三年回测发现该过滤器把原始信号本就微薄的优势削弱到接近抛硬币的水平（原始盈利因子1.13，过滤后0.98）。关闭（默认）会立即显示所有原始交叉信号，包括一些快速反转的信号，但历史表现更好。开启会换来更安静的提醒，但实际结果更差。'),
('ARENA_ANTICHOP_TIP','ar','يضيف خطوة تأكيد أكثر صرامة: يتطلب انفصال شريط EMA9/20 بوضوح، وإغلاق السعر بشكل ملموس بعد EMA50، واستمرار الحركة لعدة شموع قبل تأكيد العلامة. إشارات أقل وأكثر هدوءًا - لكن اختبارًا رجعيًا لمدة 3 سنوات وجد أن هذا الفلتر يقلل الميزة الضعيفة أصلاً للإشارة الخام إلى مستوى قذف العملة (عامل ربح 1.13 خام مقابل 0.98 مُفلتر). الوضع OFF (الافتراضي) يعرض كل تقاطع خام فورًا، بما في ذلك بعضها الذي ينعكس بسرعة، لكن له سجل أداء أفضل. الوضع ON يقدم تنبيهات أهدأ بنتيجة فعلية أسوأ.'),
('ARENA_ANTICHOP_TIP','ru','Добавляет более строгий шаг подтверждения: требует явного расхождения ленты EMA9/20, значимого закрытия цены за EMA50 и удержания движения несколько свечей до подтверждения маркера. Меньше сигналов, выглядят спокойнее - но трёхлетний бэктест показал, что этот фильтр снижает и без того тонкое преимущество исходного сигнала до уровня подбрасывания монеты (профит-фактор 1.13 без фильтра против 0.98 с фильтром). OFF (по умолчанию) показывает каждое пересечение сразу, включая быстрые развороты, но с лучшей историей результатов. ON даёт более спокойные уведомления при худшем фактическом результате.'),

('DASH_EDGE_FUNDING_TIP','en','The fee longs pay shorts every 8 hours to keep perpetual futures positions open. Strongly positive means too many people are leveraged long, raising the risk of a long-liquidation cascade if price drops.'),
('DASH_EDGE_FUNDING_TIP','ko','롱이 숏에게 8시간마다 지불하는 수수료로 무기한 선물 포지션을 유지하는 비용입니다. 강한 양수 값은 너무 많은 사람들이 롱에 레버리지를 걸고 있다는 뜻이며, 가격이 하락하면 롱 청산 연쇄가 발생할 위험이 커집니다.'),
('DASH_EDGE_FUNDING_TIP','zh','这是多头每8小时支付给空头、以维持永续合约仓位的费率。强烈为正意味着过多的人在做多加杠杆，价格下跌时引发多头连环清算的风险上升。'),
('DASH_EDGE_FUNDING_TIP','ar','هي الرسوم التي يدفعها أصحاب المراكز الشرائية للبائعين كل 8 ساعات للحفاظ على مراكز العقود الآجلة الدائمة مفتوحة. القيمة الموجبة بقوة تعني أن عددًا كبيرًا جدًا من الأشخاص يستخدمون رافعة مالية في مراكز شرائية، مما يرفع خطر تصفية جماعية للمراكز الشرائية إذا انخفض السعر.'),
('DASH_EDGE_FUNDING_TIP','ru','Это комиссия, которую лонги платят шортам каждые 8 часов за удержание бессрочных фьючерсных позиций. Сильно положительное значение означает, что слишком много людей используют плечо в лонг, что повышает риск каскадной ликвидации лонгов при падении цены.'),

('COIN_MARKET_SNAPSHOT_FUNDING_TOOLTIP','en','The fee longs pay shorts every 8 hours to keep perpetual futures positions open. Strongly positive means too many people are leveraged long, raising the risk of a long-liquidation cascade if price drops.'),
('COIN_MARKET_SNAPSHOT_FUNDING_TOOLTIP','ko','롱이 숏에게 8시간마다 지불하는 수수료로 무기한 선물 포지션을 유지하는 비용입니다. 강한 양수 값은 너무 많은 사람들이 롱에 레버리지를 걸고 있다는 뜻이며, 가격이 하락하면 롱 청산 연쇄가 발생할 위험이 커집니다.'),
('COIN_MARKET_SNAPSHOT_FUNDING_TOOLTIP','zh','这是多头每8小时支付给空头、以维持永续合约仓位的费率。强烈为正意味着过多的人在做多加杠杆，价格下跌时引发多头连环清算的风险上升。'),
('COIN_MARKET_SNAPSHOT_FUNDING_TOOLTIP','ar','هي الرسوم التي يدفعها أصحاب المراكز الشرائية للبائعين كل 8 ساعات للحفاظ على مراكز العقود الآجلة الدائمة مفتوحة. القيمة الموجبة بقوة تعني أن عددًا كبيرًا جدًا من الأشخاص يستخدمون رافعة مالية في مراكز شرائية، مما يرفع خطر تصفية جماعية للمراكز الشرائية إذا انخفض السعر.'),
('COIN_MARKET_SNAPSHOT_FUNDING_TOOLTIP','ru','Это комиссия, которую лонги платят шортам каждые 8 часов за удержание бессрочных фьючерсных позиций. Сильно положительное значение означает, что слишком много людей используют плечо в лонг, что повышает риск каскадной ликвидации лонгов при падении цены.'),

('FUNDING_TIP_HEAVY_POS','en','The fee longs pay shorts every 8 hours to keep perpetual futures positions open. Strongly positive means too many traders are leveraged long, raising the risk of a long-liquidation cascade if price drops.'),
('FUNDING_TIP_HEAVY_POS','ko','롱이 숏에게 8시간마다 지불하는 수수료로 무기한 선물 포지션을 유지하는 비용입니다. 강한 양수 값은 너무 많은 트레이더들이 롱에 레버리지를 걸고 있다는 뜻이며, 가격이 하락하면 롱 청산 연쇄가 발생할 위험이 커집니다.'),
('FUNDING_TIP_HEAVY_POS','zh','这是多头每8小时支付给空头、以维持永续合约仓位的费率。强烈为正意味着过多的交易者在做多加杠杆，价格下跌时引发多头连环清算的风险上升。'),
('FUNDING_TIP_HEAVY_POS','ar','هي الرسوم التي يدفعها أصحاب المراكز الشرائية للبائعين كل 8 ساعات للحفاظ على مراكز العقود الآجلة الدائمة مفتوحة. القيمة الموجبة بقوة تعني أن عددًا كبيرًا جدًا من المتداولين يستخدمون رافعة مالية في مراكز شرائية، مما يرفع خطر تصفية جماعية للمراكز الشرائية إذا انخفض السعر.'),
('FUNDING_TIP_HEAVY_POS','ru','Это комиссия, которую лонги платят шортам каждые 8 часов за удержание бессрочных фьючерсных позиций. Сильно положительное значение означает, что слишком много трейдеров используют плечо в лонг, что повышает риск каскадной ликвидации лонгов при падении цены.'),

('FUNDING_TIP_HEAVY_NEG','en','The fee longs pay shorts every 8 hours to keep perpetual futures positions open. Strongly negative means too many traders are leveraged short, raising the risk of a short squeeze if price rises.'),
('FUNDING_TIP_HEAVY_NEG','ko','롱이 숏에게 8시간마다 지불하는 수수료로 무기한 선물 포지션을 유지하는 비용입니다. 강한 음수 값은 너무 많은 트레이더들이 숏에 레버리지를 걸고 있다는 뜻이며, 가격이 오르면 숏 스퀴즈가 발생할 위험이 커집니다.'),
('FUNDING_TIP_HEAVY_NEG','zh','这是多头每8小时支付给空头、以维持永续合约仓位的费率。强烈为负意味着过多的交易者在做空加杠杆，价格上涨时引发空头挤压的风险上升。'),
('FUNDING_TIP_HEAVY_NEG','ar','هي الرسوم التي يدفعها أصحاب المراكز الشرائية للبائعين كل 8 ساعات للحفاظ على مراكز العقود الآجلة الدائمة مفتوحة. القيمة السالبة بقوة تعني أن عددًا كبيرًا جدًا من المتداولين يستخدمون رافعة مالية في مراكز بيعية، مما يرفع خطر حدوث ضغط شراء قسري (سكويز) إذا ارتفع السعر.'),
('FUNDING_TIP_HEAVY_NEG','ru','Это комиссия, которую лонги платят шортам каждые 8 часов за удержание бессрочных фьючерсных позиций. Сильно отрицательное значение означает, что слишком много трейдеров используют плечо в шорт, что повышает риск шорт-сквиза при росте цены.'),

('FAQ_Q_BUYSELL_SIGNAL_A','en','It''s the EMA ribbon strategy: a 9/20 EMA cross arms a direction, then the first candle that closes past the 50 EMA confirms it and prints the marker, with an entry, stop, and target shown. The same rule runs on the chart and in every alert. Extra indicators you add to the chart (RSI, MACD, etc.) are for your own reading and don''t change what triggers an alert.'),
('FAQ_Q_BUYSELL_SIGNAL_A','ko','EMA 리본 전략입니다: 9/20 EMA 교차가 방향을 활성화하고, 50 EMA를 넘어 마감하는 첫 캔들이 이를 확정하며 마커를 표시합니다. 진입가, 손절가, 목표가가 함께 표시됩니다. 차트와 모든 알림에서 동일한 규칙이 적용됩니다. 차트에 추가한 다른 지표(RSI, MACD 등)는 사용자가 참고용으로 보는 것일 뿐, 알림이 발생하는 기준을 바꾸지 않습니다.'),
('FAQ_Q_BUYSELL_SIGNAL_A','zh','这是EMA带策略：9/20 EMA交叉激活方向，随后第一根收盘价越过50 EMA的K线确认信号并打印标记，同时显示入场价、止损和目标位。图表和每条提醒使用的是同一套规则。您在图表上额外添加的指标（RSI、MACD等）仅供您自己参考，不会改变提醒的触发条件。'),
('FAQ_Q_BUYSELL_SIGNAL_A','ar','إنها استراتيجية شريط EMA: يقوم تقاطع EMA 9/20 بتفعيل اتجاه، ثم تؤكده أول شمعة تُغلق بعد EMA 50 وتطبع العلامة، مع عرض نقطة الدخول ووقف الخسارة والهدف. تُطبَّق نفس القاعدة على الرسم البياني وفي كل تنبيه. المؤشرات الإضافية التي تضيفها إلى الرسم البياني (RSI، MACD، إلخ) هي لقراءتك الخاصة فقط ولا تغيّر ما يُشغّل التنبيه.'),
('FAQ_Q_BUYSELL_SIGNAL_A','ru','Это стратегия EMA-ленты: пересечение EMA 9/20 задаёт направление, затем первая свеча, закрывшаяся за EMA 50, подтверждает его и печатает маркер с точкой входа, стопом и целью. На графике и в каждом уведомлении действует одно и то же правило. Дополнительные индикаторы, которые вы добавляете на график (RSI, MACD и т.д.), нужны только для вашего собственного анализа и не влияют на то, что запускает уведомление.'),

('FAQ_Q_ALERT_MISMATCH_A','en','Alerts use the same fixed EMA ribbon signal engine as the Arena chart''s own marker. If you''ve added extra chart indicators (RSI, MACD, SMA, etc.), those are just for your own reading and don''t feed the alert engine, so an alert can look disconnected from whatever indicator you''re currently viewing. If it still looks out of place, check the timeframe the alert was for - it may be describing an earlier candle than the one currently in view.'),
('FAQ_Q_ALERT_MISMATCH_A','ko','알림은 아레나 차트 자체의 마커와 동일한 고정 EMA 리본 신호 엔진을 사용합니다. RSI, MACD, SMA 등 차트에 추가 지표를 넣었다면, 이는 개인적으로 참고하기 위한 것일 뿐 알림 엔진에는 반영되지 않으므로, 현재 보고 있는 지표와 알림이 서로 무관해 보일 수 있습니다. 그래도 이상해 보인다면 알림이 어떤 타임프레임을 기준으로 했는지 확인하세요 - 지금 보고 있는 캔들보다 이전 캔들을 설명하고 있을 수 있습니다.'),
('FAQ_Q_ALERT_MISMATCH_A','zh','提醒使用的信号引擎与Arena图表自身标记完全相同、固定不变的EMA带规则。如果您在图表上添加了额外指标（RSI、MACD、SMA等），那只是供您自己参考，并不会输入到提醒引擎中，因此提醒可能看起来与您当前查看的指标无关。如果仍觉得不对劲，请检查该提醒对应的时间周期 - 它描述的可能是比当前视图更早的一根K线。'),
('FAQ_Q_ALERT_MISMATCH_A','ar','تستخدم التنبيهات محرك إشارة شريط EMA الثابت نفسه الذي يستخدمه مؤشر الرسم البياني في Arena. إذا أضفت مؤشرات إضافية للرسم البياني (RSI، MACD، SMA، إلخ)، فهذه فقط لقراءتك الخاصة ولا تُغذّي محرك التنبيهات، لذا قد يبدو التنبيه غير مرتبط بالمؤشر الذي تشاهده حاليًا. إذا كان لا يزال يبدو في غير محله، تحقق من الإطار الزمني الذي كان التنبيه من أجله - فقد يصف شمعة أقدم من تلك المعروضة حاليًا.'),
('FAQ_Q_ALERT_MISMATCH_A','ru','Уведомления используют тот же фиксированный сигнальный движок EMA-ленты, что и маркер на графике Arena. Если вы добавили на график дополнительные индикаторы (RSI, MACD, SMA и т.д.), они предназначены только для вашего анализа и не влияют на движок уведомлений, поэтому уведомление может казаться не связанным с тем индикатором, который вы сейчас смотрите. Если это всё ещё выглядит странно, проверьте таймфрейм уведомления - оно может описывать более раннюю свечу, чем та, что сейчас в поле зрения.'),

('DASH_EDGE_SETUP_TIP','en','Squeeze setup score: funding rate (0–40 pts) + long/short ratio positioning (0–40 pts) + taker buy/sell pressure (0–15 pts) + volume spike bonus (0–20 pts). LONG_LIQ = longs overcrowded, ripe for a dump. SHORT_SQ = shorts overcrowded, ripe for a pump.'),
('DASH_EDGE_SETUP_TIP','ko','스퀴즈 셋업 점수: 펀딩비(0-40점) + 롱숏 비율 포지셔닝(0-40점) + 테이커 매수/매도 압력(0-15점) + 거래량 급등 보너스(0-20점). LONG_LIQ = 롱 과밀, 하락 가능성 높음. SHORT_SQ = 숏 과밀, 상승 가능성 높음.'),
('DASH_EDGE_SETUP_TIP','zh','挤压形态评分：资金费率（0-40分）+ 多空比定位（0-40分）+ 吃单买卖压力（0-15分）+ 成交量激增加分（0-20分）。LONG_LIQ = 多头过度拥挤，易遭打压；SHORT_SQ = 空头过度拥挤，易被拉升。'),
('DASH_EDGE_SETUP_TIP','ar','درجة إعداد الضغط (سكويز): معدل التمويل (0-40 نقطة) + مركز نسبة الشراء/البيع (0-40 نقطة) + ضغط الشراء/البيع من الآخذين (0-15 نقطة) + مكافأة ارتفاع حجم التداول (0-20 نقطة). LONG_LIQ = ازدحام المراكز الشرائية، مهيأ للهبوط. SHORT_SQ = ازدحام المراكز البيعية، مهيأ للصعود.'),
('DASH_EDGE_SETUP_TIP','ru','Показатель сетапа сквиза: ставка финансирования (0-40 баллов) + позиционирование по соотношению лонг/шорт (0-40 баллов) + давление тейкеров на покупку/продажу (0-15 баллов) + бонус за всплеск объёма (0-20 баллов). LONG_LIQ = лонги перегружены, созрели для слива. SHORT_SQ = шорты перегружены, созрели для пампа.'),

('FUNDING_SIG_SHORTS_OVERCROWDED_DESC','en','Extreme short crowding - traders are paying 0.03%+ every 8h just to stay short. This is unsustainable. Whales have incentive to push price up and mass-liquidate these shorts.'),
('FUNDING_SIG_SHORTS_OVERCROWDED_DESC','ko','극도의 숏 밀집 - 트레이더들은 숏 포지션을 유지하기 위해 8시간마다 0.03% 이상을 지불하고 있습니다. 이는 지속 불가능합니다. 고래들은 가격을 밀어올려 이 숏 포지션들을 대량 청산시킬 유인이 있습니다.'),
('FUNDING_SIG_SHORTS_OVERCROWDED_DESC','zh','极度空头拥挤 - 交易者为维持空头每8小时支付0.03%以上的费率。这是不可持续的。巨鲸有动机拉升价格，大规模清算这些空头。'),
('FUNDING_SIG_SHORTS_OVERCROWDED_DESC','ar','ازدحام شديد في المراكز البيعية (الشورت) - يدفع المتداولون أكثر من 0.03% كل 8 ساعات فقط للبقاء في مراكزهم البيعية. هذا غير مستدام. لدى الحيتان حافز لدفع السعر للأعلى وتصفية هذه المراكز البيعية بشكل جماعي.'),
('FUNDING_SIG_SHORTS_OVERCROWDED_DESC','ru','Крайняя перегруженность шортами - трейдеры платят 0.03%+ каждые 8 часов только за удержание шорта. Это неустойчиво. У китов есть стимул поднять цену и массово ликвидировать эти шорты.'),

('WHALE_TRADES_FEED_BIAS_NET_BUY','en','Whales net buying'),
('WHALE_TRADES_FEED_BIAS_NET_BUY','ko','고래 순매수'),
('WHALE_TRADES_FEED_BIAS_NET_BUY','zh','巨鲸净买入'),
('WHALE_TRADES_FEED_BIAS_NET_BUY','ar','الحيتان صافي شراء'),
('WHALE_TRADES_FEED_BIAS_NET_BUY','ru','Киты нетто-покупают'),

('WHALE_TRADES_FEED_BIAS_NET_SELL','en','Whales net selling'),
('WHALE_TRADES_FEED_BIAS_NET_SELL','ko','고래 순매도'),
('WHALE_TRADES_FEED_BIAS_NET_SELL','zh','巨鲸净卖出'),
('WHALE_TRADES_FEED_BIAS_NET_SELL','ar','الحيتان صافي بيع'),
('WHALE_TRADES_FEED_BIAS_NET_SELL','ru','Киты нетто-продают'),

('NEWS_WHALE_NOTE_BUY','en','Large buy-side activity - watch follow-through'),
('NEWS_WHALE_NOTE_BUY','ko','대규모 매수 활동 - 후속 움직임을 지켜보세요'),
('NEWS_WHALE_NOTE_BUY','zh','大额买盘活动 - 关注后续走势'),
('NEWS_WHALE_NOTE_BUY','ar','نشاط شراء كبير - راقب استمرارية الحركة'),
('NEWS_WHALE_NOTE_BUY','ru','Крупная покупательская активность - следите за продолжением'),

('ABSORPTION_DETECTOR_MTF_TEXT','en','Multi-timeframe confirmed'),
('ABSORPTION_DETECTOR_MTF_TEXT','ko','멀티 타임프레임 확인됨'),
('ABSORPTION_DETECTOR_MTF_TEXT','zh','多周期已确认'),
('ABSORPTION_DETECTOR_MTF_TEXT','ar','تم التأكيد عبر أطر زمنية متعددة'),
('ABSORPTION_DETECTOR_MTF_TEXT','ru','Подтверждено на нескольких таймфреймах'),

('ARENA_NOTIF_CVD_BODY_BULL','en','Price falling but buyers absorbing. Watch for reversal ↑'),
('ARENA_NOTIF_CVD_BODY_BULL','ko','가격은 하락 중이지만 매수세가 흡수하고 있습니다. 반전을 주시하세요 ↑'),
('ARENA_NOTIF_CVD_BODY_BULL','zh','价格下跌但买盘在吸收。留意反转 ↑'),
('ARENA_NOTIF_CVD_BODY_BULL','ar','السعر ينخفض لكن المشترين يمتصون الضغط. راقب الانعكاس ↑'),
('ARENA_NOTIF_CVD_BODY_BULL','ru','Цена падает, но покупатели поглощают давление. Следите за разворотом ↑'),

('ACCUMULATION_TRACKER_TOOLTIP','en','Scores every coin for stealth accumulation: price still flat while CVD shows absorption, taker buys dominate, open interest builds, whale positioning leans long, and funding stays calm (crowd not in yet). High score = quiet accumulation before the move.'),
('ACCUMULATION_TRACKER_TOOLTIP','ko','모든 코인에 대해 은밀한 매집을 점수화합니다: 가격은 여전히 횡보하는데 CVD는 흡수를 보이고, 테이커 매수가 우세하며, 미결제약정이 쌓이고, 고래 포지션이 롱으로 기울며, 펀딩비는 잠잠합니다(아직 대중이 들어오지 않음). 높은 점수 = 움직임 전 조용한 매집.'),
('ACCUMULATION_TRACKER_TOOLTIP','zh','为每个币种的隐蔽吸筹打分：价格仍横盘，但CVD显示吸收、吃单买盘占优、未平仓合约上升、巨鲸持仓偏多，且资金费率保持平静（大众尚未入场）。高分 = 行情启动前的悄然吸筹。'),
('ACCUMULATION_TRACKER_TOOLTIP','ar','يسجل كل عملة من حيث التجميع الخفي: السعر لا يزال ثابتًا بينما يُظهر CVD امتصاصًا، وشراء الآخذين مهيمن، والفائدة المفتوحة تتزايد، ومراكز الحيتان تميل للشراء، ويبقى التمويل هادئًا (الجمهور لم يدخل بعد). الدرجة العالية = تجميع هادئ قبل الحركة.'),
('ACCUMULATION_TRACKER_TOOLTIP','ru','Оценивает каждую монету на скрытое накопление: цена всё ещё в боковике, а CVD показывает поглощение, тейкеры преимущественно покупают, открытый интерес растёт, позиционирование китов склоняется в лонг, а фандинг остаётся спокойным (толпа ещё не зашла). Высокий балл = тихое накопление перед движением.'),

('WHALE_TRADES_FEED_TOOLTIP','en','Live single trades over $50K on Binance futures. Large clusters of buys or sells can signal a shift in positioning before smaller traders react.'),
('WHALE_TRADES_FEED_TOOLTIP','ko','바이낸스 선물에서 $50K 이상의 실시간 단일 거래입니다. 대규모 매수 또는 매도 클러스터는 소규모 트레이더들이 반응하기 전 포지셔닝 변화를 시사할 수 있습니다.'),
('WHALE_TRADES_FEED_TOOLTIP','zh','币安期货上超过5万美元的实时单笔交易。大量买入或卖出的聚集可能预示着在小散户反应之前仓位发生了变化。'),
('WHALE_TRADES_FEED_TOOLTIP','ar','صفقات فردية مباشرة تتجاوز 50 ألف دولار على عقود Binance الآجلة. قد تشير التجمعات الكبيرة من عمليات الشراء أو البيع إلى تحول في المراكز قبل أن يتفاعل صغار المتداولين.'),
('WHALE_TRADES_FEED_TOOLTIP','ru','Живые одиночные сделки свыше $50K на фьючерсах Binance. Крупные скопления покупок или продаж могут сигнализировать об изменении позиционирования до того, как на это отреагируют мелкие трейдеры.')

on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately (shared-database
-- write, owner-gated at release time, per 20260912b's convention). Kept
-- commented rather than duplicated 115 rows deep; re-run this same insert
-- with `lhq_labels` replaced by `lhq_dev_labels` when applying to dev.
