-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso; DEV on wdtjhrilakoitfcezxpx.
-- Pro copy (#1630): price alerts are capped at 50 active per account, so the copy says that instead of "unlimited".
-- HELP_Q_TRIAL_A has no Arabic row; Arabic readers get the English default.

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('FAQ_Q_FREE_VS_PRO_A','ar','تشمل الخطة المجانية لوحة التحكم والموجز والأخبار والماسحات والرسوم البيانية الكاملة، بالإضافة إلى قدر محدود من تحليل الذكاء الاصطناعي يوميًا. وتضيف Pro الأطر الزمنية الأسرع، ودرجة التوافق، وبيانات السلسلة والاقتصاد الكلي، وتنبيهات تيليجرام، وحتى 50 تنبيه سعر نشط، وحصة أكبر بكثير من الذكاء الاصطناعي.'),
('FAQ_Q_FREE_VS_PRO_A','en','Free covers the Dashboard, Briefing, News, Scanners, and full charting, plus a limited amount of AI analysis each day. Pro adds the faster timeframes, the Confluence Score, on-chain and macro data, Telegram alerts, up to 50 active price alerts, and a much larger AI allowance.'),
('FAQ_Q_FREE_VS_PRO_A','ko','무료 플랜에는 대시보드, 브리핑, 뉴스, 스캐너, 전체 차트 기능과 매일 제한된 양의 AI 분석이 포함됩니다. Pro에서는 더 빠른 타임프레임, 합류 점수, 온체인 및 매크로 데이터, 텔레그램 알림, 활성 가격 알림 최대 50개, 그리고 훨씬 더 많은 AI 사용량이 추가됩니다.'),
('FAQ_Q_FREE_VS_PRO_A','ru','Free включает панель управления, брифинг, новости, сканеры и полноценные графики, а также ограниченный объём AI-анализа в день. Pro добавляет более быстрые таймфреймы, Confluence Score, ончейн- и макроданные, оповещения в Telegram, до 50 активных ценовых оповещений и гораздо больший лимит AI.'),
('FAQ_Q_FREE_VS_PRO_A','zh','免费版涵盖仪表盘、简报、资讯、扫描器和完整图表功能，外加每日有限次数的 AI 分析。Pro 额外提供更快的时间周期、共振评分、链上与宏观数据、Telegram 提醒、最多 50 个有效价格提醒，以及多得多的 AI 额度。'),
('HELP_Q_TRIAL_A','en','Full Pro access, with no card required: the faster timeframes, the Confluence Score, on-chain and macro data, Telegram alerts, up to 50 active price alerts, and the one-shot AI tools. Quick and Deep reads, chat and briefings have the same daily limits as the Free plan. When the 14 days end your account moves to the Free plan unless you upgrade.'),
('HELP_Q_TRIAL_A','ko','카드 없이 전체 Pro 기능을 이용할 수 있습니다: 더 빠른 타임프레임, 컨플루언스 점수, 온체인 및 거시 데이터, 텔레그램 알림, 활성 가격 알림 최대 50개, 일회성 AI 도구. 빠른 분석, 심층 분석, 채팅, 브리핑의 일일 한도는 무료 플랜과 같습니다. 14일이 끝나면 업그레이드하지 않는 한 계정은 무료 플랜으로 전환됩니다.'),
('HELP_Q_TRIAL_A','ru','Полный доступ Pro без привязки карты: быстрые таймфреймы, Confluence Score, ончейн- и макроданные, оповещения в Telegram, до 50 активных ценовых оповещений и разовые ИИ-инструменты. Дневные лимиты быстрого и глубокого разбора, чата и сводок такие же, как на бесплатном тарифе. Через 14 дней аккаунт перейдёт на бесплатный тариф, если вы не оформите подписку.'),
('HELP_Q_TRIAL_A','zh','无需绑定银行卡即可使用完整 Pro 功能:更快的时间周期、共振评分、链上与宏观数据、Telegram 提醒、最多 50 个有效价格提醒,以及一次性 AI 工具。快速解读、深度解读、聊天和简报的每日额度与免费版相同。14 天结束后,除非升级,您的账户将转为免费版。'),
('UPGRADE_PRO_FEATURE_UNLIMITED_ALERTS','ar','حتى 50 تنبيه سعر نشط'),
('UPGRADE_PRO_FEATURE_UNLIMITED_ALERTS','en','Up to 50 active price alerts'),
('UPGRADE_PRO_FEATURE_UNLIMITED_ALERTS','ko','활성 가격 알림 최대 50개'),
('UPGRADE_PRO_FEATURE_UNLIMITED_ALERTS','ru','До 50 активных оповещений о цене'),
('UPGRADE_PRO_FEATURE_UNLIMITED_ALERTS','zh','最多 50 个有效价格提醒')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('FAQ_Q_FREE_VS_PRO_A','ar','تشمل الخطة المجانية لوحة التحكم والموجز والأخبار والماسحات والرسوم البيانية الكاملة، بالإضافة إلى قدر محدود من تحليل الذكاء الاصطناعي يوميًا. وتضيف Pro الأطر الزمنية الأسرع، ودرجة التوافق، وبيانات السلسلة والاقتصاد الكلي، وتنبيهات تيليجرام، وحتى 50 تنبيه سعر نشط، وحصة أكبر بكثير من الذكاء الاصطناعي.'),
('FAQ_Q_FREE_VS_PRO_A','en','Free covers the Dashboard, Briefing, News, Scanners, and full charting, plus a limited amount of AI analysis each day. Pro adds the faster timeframes, the Confluence Score, on-chain and macro data, Telegram alerts, up to 50 active price alerts, and a much larger AI allowance.'),
('FAQ_Q_FREE_VS_PRO_A','ko','무료 플랜에는 대시보드, 브리핑, 뉴스, 스캐너, 전체 차트 기능과 매일 제한된 양의 AI 분석이 포함됩니다. Pro에서는 더 빠른 타임프레임, 합류 점수, 온체인 및 매크로 데이터, 텔레그램 알림, 활성 가격 알림 최대 50개, 그리고 훨씬 더 많은 AI 사용량이 추가됩니다.'),
('FAQ_Q_FREE_VS_PRO_A','ru','Free включает панель управления, брифинг, новости, сканеры и полноценные графики, а также ограниченный объём AI-анализа в день. Pro добавляет более быстрые таймфреймы, Confluence Score, ончейн- и макроданные, оповещения в Telegram, до 50 активных ценовых оповещений и гораздо больший лимит AI.'),
('FAQ_Q_FREE_VS_PRO_A','zh','免费版涵盖仪表盘、简报、资讯、扫描器和完整图表功能，外加每日有限次数的 AI 分析。Pro 额外提供更快的时间周期、共振评分、链上与宏观数据、Telegram 提醒、最多 50 个有效价格提醒，以及多得多的 AI 额度。'),
('HELP_Q_TRIAL_A','en','Full Pro access, with no card required: the faster timeframes, the Confluence Score, on-chain and macro data, Telegram alerts, up to 50 active price alerts, and the one-shot AI tools. Quick and Deep reads, chat and briefings have the same daily limits as the Free plan. When the 14 days end your account moves to the Free plan unless you upgrade.'),
('HELP_Q_TRIAL_A','ko','카드 없이 전체 Pro 기능을 이용할 수 있습니다: 더 빠른 타임프레임, 컨플루언스 점수, 온체인 및 거시 데이터, 텔레그램 알림, 활성 가격 알림 최대 50개, 일회성 AI 도구. 빠른 분석, 심층 분석, 채팅, 브리핑의 일일 한도는 무료 플랜과 같습니다. 14일이 끝나면 업그레이드하지 않는 한 계정은 무료 플랜으로 전환됩니다.'),
('HELP_Q_TRIAL_A','ru','Полный доступ Pro без привязки карты: быстрые таймфреймы, Confluence Score, ончейн- и макроданные, оповещения в Telegram, до 50 активных ценовых оповещений и разовые ИИ-инструменты. Дневные лимиты быстрого и глубокого разбора, чата и сводок такие же, как на бесплатном тарифе. Через 14 дней аккаунт перейдёт на бесплатный тариф, если вы не оформите подписку.'),
('HELP_Q_TRIAL_A','zh','无需绑定银行卡即可使用完整 Pro 功能:更快的时间周期、共振评分、链上与宏观数据、Telegram 提醒、最多 50 个有效价格提醒,以及一次性 AI 工具。快速解读、深度解读、聊天和简报的每日额度与免费版相同。14 天结束后,除非升级,您的账户将转为免费版。'),
('UPGRADE_PRO_FEATURE_UNLIMITED_ALERTS','ar','حتى 50 تنبيه سعر نشط'),
('UPGRADE_PRO_FEATURE_UNLIMITED_ALERTS','en','Up to 50 active price alerts'),
('UPGRADE_PRO_FEATURE_UNLIMITED_ALERTS','ko','활성 가격 알림 최대 50개'),
('UPGRADE_PRO_FEATURE_UNLIMITED_ALERTS','ru','До 50 активных оповещений о цене'),
('UPGRADE_PRO_FEATURE_UNLIMITED_ALERTS','zh','最多 50 个有效价格提醒')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
