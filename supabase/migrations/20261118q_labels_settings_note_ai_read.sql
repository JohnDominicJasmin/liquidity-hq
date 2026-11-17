-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- The Edit settings note now says the AI read uses the trader's settings (owner 2026-11-17). Replaces the existing row's value in each locale (an earlier held migration, 20261118d, wrote the old wording). ko/zh/ru/ar AI-drafted, not native-reviewed.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','en','The AI read uses your settings. Strategy signals use standard settings.'),
('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','ko','AI 분석은 사용자의 설정을 사용합니다. 전략 신호는 표준 설정을 사용합니다.'),
('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','zh','AI 解读使用您的设置。策略信号使用标准设置。'),
('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','ru','ИИ-анализ использует ваши настройки. Сигналы стратегий используют стандартные настройки.'),
('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','ar','تستخدم قراءة الذكاء الاصطناعي إعداداتك. تستخدم إشارات الاستراتيجية الإعدادات القياسية.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','en','The AI read uses your settings. Strategy signals use standard settings.'),
('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','ko','AI 분석은 사용자의 설정을 사용합니다. 전략 신호는 표준 설정을 사용합니다.'),
('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','zh','AI 解读使用您的设置。策略信号使用标准设置。'),
('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','ru','ИИ-анализ использует ваши настройки. Сигналы стратегий используют стандартные настройки.'),
('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','ar','تستخدم قراءة الذكاء الاصطناعي إعداداتك. تستخدم إشارات الاستراتيجية الإعدادات القياسية.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
