-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- /upgrade and the landing pricing block say what v2026.11.19 shipped for Pro (PM 2026-11-19, #1630 L3): 16 strategies drawn on the chart, Quick/Deep reads that use your strategy and indicators, Telegram alert controls. The S/R + liquidation layers row (LAYERS_ALL) already says every coin. Facts only, 15 words or fewer (rule 25). 3 keys x 5 locales; en equals the shipped defaults and the landing dictionary. ko/zh/ru/ar AI-drafted, not native-reviewed.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('UPGRADE_PRO_FEATURE_STRATEGIES_ALL','en','16 strategies on every coin, drawn on the chart: Trend, Price action, Sessions, Derivatives'),
('UPGRADE_PRO_FEATURE_STRATEGIES_ALL','ko','모든 코인에서 전략 16개, 차트에 표시: 추세, 가격 행동, 세션, 파생상품'),
('UPGRADE_PRO_FEATURE_STRATEGIES_ALL','zh','所有币种 16 种策略，绘制在图表上：趋势、价格行为、交易时段、衍生品'),
('UPGRADE_PRO_FEATURE_STRATEGIES_ALL','ru','16 стратегий по каждой монете, на графике: тренд, прайс-экшн, сессии, деривативы'),
('UPGRADE_PRO_FEATURE_STRATEGIES_ALL','ar','16 استراتيجية لكل عملة، مرسومة على الرسم البياني: الاتجاه، حركة السعر، الجلسات، المشتقات'),
('UPGRADE_PRO_FEATURE_AI_SETTINGS','en','Quick and Deep reads use your strategy and indicator settings'),
('UPGRADE_PRO_FEATURE_AI_SETTINGS','ko','Quick·Deep 분석이 내 전략과 지표 설정을 사용'),
('UPGRADE_PRO_FEATURE_AI_SETTINGS','zh','Quick 与 Deep 解读使用您的策略和指标设置'),
('UPGRADE_PRO_FEATURE_AI_SETTINGS','ru','Quick и Deep используют вашу стратегию и настройки индикаторов'),
('UPGRADE_PRO_FEATURE_AI_SETTINGS','ar','قراءتا Quick وDeep تستخدمان استراتيجيتك وإعدادات مؤشراتك'),
('UPGRADE_PRO_FEATURE_TELEGRAM','en','Telegram alerts: all signal types, quiet hours, snooze, mute by type'),
('UPGRADE_PRO_FEATURE_TELEGRAM','ko','텔레그램 알림: 전체 신호 유형, 방해 금지 시간, 일시중지, 유형별 음소거'),
('UPGRADE_PRO_FEATURE_TELEGRAM','zh','Telegram 提醒：全部信号类型、免打扰时段、暂停、按类型静音'),
('UPGRADE_PRO_FEATURE_TELEGRAM','ru','Оповещения в Telegram: все типы сигналов, тихие часы, пауза, отключение по типу'),
('UPGRADE_PRO_FEATURE_TELEGRAM','ar','تنبيهات تيليجرام: جميع أنواع الإشارات، ساعات الهدوء، الإيقاف المؤقت، كتم حسب النوع')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('UPGRADE_PRO_FEATURE_STRATEGIES_ALL','en','16 strategies on every coin, drawn on the chart: Trend, Price action, Sessions, Derivatives'),
('UPGRADE_PRO_FEATURE_STRATEGIES_ALL','ko','모든 코인에서 전략 16개, 차트에 표시: 추세, 가격 행동, 세션, 파생상품'),
('UPGRADE_PRO_FEATURE_STRATEGIES_ALL','zh','所有币种 16 种策略，绘制在图表上：趋势、价格行为、交易时段、衍生品'),
('UPGRADE_PRO_FEATURE_STRATEGIES_ALL','ru','16 стратегий по каждой монете, на графике: тренд, прайс-экшн, сессии, деривативы'),
('UPGRADE_PRO_FEATURE_STRATEGIES_ALL','ar','16 استراتيجية لكل عملة، مرسومة على الرسم البياني: الاتجاه، حركة السعر، الجلسات، المشتقات'),
('UPGRADE_PRO_FEATURE_AI_SETTINGS','en','Quick and Deep reads use your strategy and indicator settings'),
('UPGRADE_PRO_FEATURE_AI_SETTINGS','ko','Quick·Deep 분석이 내 전략과 지표 설정을 사용'),
('UPGRADE_PRO_FEATURE_AI_SETTINGS','zh','Quick 与 Deep 解读使用您的策略和指标设置'),
('UPGRADE_PRO_FEATURE_AI_SETTINGS','ru','Quick и Deep используют вашу стратегию и настройки индикаторов'),
('UPGRADE_PRO_FEATURE_AI_SETTINGS','ar','قراءتا Quick وDeep تستخدمان استراتيجيتك وإعدادات مؤشراتك'),
('UPGRADE_PRO_FEATURE_TELEGRAM','en','Telegram alerts: all signal types, quiet hours, snooze, mute by type'),
('UPGRADE_PRO_FEATURE_TELEGRAM','ko','텔레그램 알림: 전체 신호 유형, 방해 금지 시간, 일시중지, 유형별 음소거'),
('UPGRADE_PRO_FEATURE_TELEGRAM','zh','Telegram 提醒：全部信号类型、免打扰时段、暂停、按类型静音'),
('UPGRADE_PRO_FEATURE_TELEGRAM','ru','Оповещения в Telegram: все типы сигналов, тихие часы, пауза, отключение по типу'),
('UPGRADE_PRO_FEATURE_TELEGRAM','ar','تنبيهات تيليجرام: جميع أنواع الإشارات، ساعات الهدوء، الإيقاف المؤقت، كتم حسب النوع')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
