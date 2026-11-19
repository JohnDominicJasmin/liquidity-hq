-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- The Arena Liq chip says why it is off for a coin whose liquidation feed comes in mixed units (sats, tag, toshi, turbo; PM 2026-11-20): "Liquidation levels for this coin come in mixed units; not shown."
-- en equals lib/labelDefaults.en.json; ko/zh/ru/ar are AI-drafted and not native-reviewed.

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('STRATEGY_PANEL_LIQ_MIXED_UNITS','en','Liquidation levels for this coin come in mixed units; not shown.'),
('STRATEGY_PANEL_LIQ_MIXED_UNITS','ko','이 코인의 청산 수준은 단위가 섞여 있어 표시하지 않습니다.'),
('STRATEGY_PANEL_LIQ_MIXED_UNITS','zh','该币种的清算价位单位不一致，不予显示。'),
('STRATEGY_PANEL_LIQ_MIXED_UNITS','ru','Уровни ликвидаций этой монеты в разных единицах; не показаны.'),
('STRATEGY_PANEL_LIQ_MIXED_UNITS','ar','مستويات التصفية لهذه العملة بوحدات مختلطة؛ غير معروضة.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('STRATEGY_PANEL_LIQ_MIXED_UNITS','en','Liquidation levels for this coin come in mixed units; not shown.'),
('STRATEGY_PANEL_LIQ_MIXED_UNITS','ko','이 코인의 청산 수준은 단위가 섞여 있어 표시하지 않습니다.'),
('STRATEGY_PANEL_LIQ_MIXED_UNITS','zh','该币种的清算价位单位不一致，不予显示。'),
('STRATEGY_PANEL_LIQ_MIXED_UNITS','ru','Уровни ликвидаций этой монеты в разных единицах; не показаны.'),
('STRATEGY_PANEL_LIQ_MIXED_UNITS','ar','مستويات التصفية لهذه العملة بوحدات مختلطة؛ غير معروضة.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
