-- #1626 C (owner, 2026-10-21: "Standard RSI"): name the timeframe next to every RSI value, and correct the RSI alert's description.
--
--   SETUP_SCANNER_RSI_VAL, BRIEFING_TAG_RSI, MARKET_CONDITIONS_WIDGET_RSI_LABEL: these RSI values are 15-minute readings and did not say so
--     (the Dashboard "BTC RSI (14)" is 15m). Now "RSI 15m ..." / "BTC RSI (14, 15m)".
--   ALERTS_RSI_DESC: said "> 78 overbought · < 22 oversold", which the cron has not used since the defaults became 70/30 (per user, in Settings).
--     Now says what the alert does: 1h RSI, 70/30 by default, your own values from Settings, 4h cooldown.
--
-- Overwrites the live rows for these four keys in every locale (the label table is the record). ar/ko/ru/zh are Dev machine translations,
-- NOT native-reviewed.
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out (apply to dev only when QA says no test pass is running).
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).

insert into lhq_labels (key, locale, value) values
('SETUP_SCANNER_RSI_VAL','en','RSI 15m {v}'),
('SETUP_SCANNER_RSI_VAL','ar','RSI 15m {v}'),
('SETUP_SCANNER_RSI_VAL','ko','RSI 15m {v}'),
('SETUP_SCANNER_RSI_VAL','ru','RSI 15m {v}'),
('SETUP_SCANNER_RSI_VAL','zh','RSI 15m {v}'),
('BRIEFING_TAG_RSI','en','RSI 15m {value}'),
('BRIEFING_TAG_RSI','ar','RSI 15m {value}'),
('BRIEFING_TAG_RSI','ko','RSI 15m {value}'),
('BRIEFING_TAG_RSI','ru','RSI 15m {value}'),
('BRIEFING_TAG_RSI','zh','RSI 15m {value}'),
('MARKET_CONDITIONS_WIDGET_RSI_LABEL','en','BTC RSI (14, 15m)'),
('MARKET_CONDITIONS_WIDGET_RSI_LABEL','ar','مؤشر RSI لـ BTC (14، 15m)'),
('MARKET_CONDITIONS_WIDGET_RSI_LABEL','ko','BTC RSI (14, 15분)'),
('MARKET_CONDITIONS_WIDGET_RSI_LABEL','ru','BTC RSI (14, 15m)'),
('MARKET_CONDITIONS_WIDGET_RSI_LABEL','zh','BTC RSI（14，15分钟）'),
('ALERTS_RSI_DESC','en','1h RSI > 70 overbought · < 30 oversold by default (set yours in Settings) · 4h cooldown'),
('ALERTS_RSI_DESC','ar','RSI على إطار ساعة: > 70 تشبع شرائي · < 30 تشبع بيعي افتراضيًا (اضبط قيمك في الإعدادات) · فترة تهدئة 4 ساعات'),
('ALERTS_RSI_DESC','ko','1시간 RSI 70 초과 과매수 · 30 미만 과매도 (기본값, 설정에서 변경 가능) · 4시간 쿨다운'),
('ALERTS_RSI_DESC','ru','RSI 1ч > 70 перекупленность · < 30 перепроданность по умолчанию (свои значения в Настройках) · пауза 4 ч'),
('ALERTS_RSI_DESC','zh','1小时 RSI > 70 超买 · < 30 超卖（默认值，可在设置中修改）· 4小时冷却')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: the same rows against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('SETUP_SCANNER_RSI_VAL','en','RSI 15m {v}'),
-- ('SETUP_SCANNER_RSI_VAL','ar','RSI 15m {v}'),
-- ('SETUP_SCANNER_RSI_VAL','ko','RSI 15m {v}'),
-- ('SETUP_SCANNER_RSI_VAL','ru','RSI 15m {v}'),
-- ('SETUP_SCANNER_RSI_VAL','zh','RSI 15m {v}'),
-- ('BRIEFING_TAG_RSI','en','RSI 15m {value}'),
-- ('BRIEFING_TAG_RSI','ar','RSI 15m {value}'),
-- ('BRIEFING_TAG_RSI','ko','RSI 15m {value}'),
-- ('BRIEFING_TAG_RSI','ru','RSI 15m {value}'),
-- ('BRIEFING_TAG_RSI','zh','RSI 15m {value}'),
-- ('MARKET_CONDITIONS_WIDGET_RSI_LABEL','en','BTC RSI (14, 15m)'),
-- ('MARKET_CONDITIONS_WIDGET_RSI_LABEL','ar','مؤشر RSI لـ BTC (14، 15m)'),
-- ('MARKET_CONDITIONS_WIDGET_RSI_LABEL','ko','BTC RSI (14, 15분)'),
-- ('MARKET_CONDITIONS_WIDGET_RSI_LABEL','ru','BTC RSI (14, 15m)'),
-- ('MARKET_CONDITIONS_WIDGET_RSI_LABEL','zh','BTC RSI（14，15分钟）'),
-- ('ALERTS_RSI_DESC','en','1h RSI > 70 overbought · < 30 oversold by default (set yours in Settings) · 4h cooldown'),
-- ('ALERTS_RSI_DESC','ar','RSI على إطار ساعة: > 70 تشبع شرائي · < 30 تشبع بيعي افتراضيًا (اضبط قيمك في الإعدادات) · فترة تهدئة 4 ساعات'),
-- ('ALERTS_RSI_DESC','ko','1시간 RSI 70 초과 과매수 · 30 미만 과매도 (기본값, 설정에서 변경 가능) · 4시간 쿨다운'),
-- ('ALERTS_RSI_DESC','ru','RSI 1ч > 70 перекупленность · < 30 перепроданность по умолчанию (свои значения в Настройках) · пауза 4 ч'),
-- ('ALERTS_RSI_DESC','zh','1小时 RSI > 70 超买 · < 30 超卖（默认值，可在设置中修改）· 4小时冷却')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
