-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project, AFTER 20261118a: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps BEFORE the release deploy; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- Compact Strategy panel, second pass: the layers caption is now one literal line (it no longer takes parameters; this row replaces the one in 20261118a) and the new "Edit settings" link.
-- ko/zh/ru/ar are AI-drafted and not native-reviewed (owner's 2026-11-13 ruling).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','en','Always on: EMA ribbon · RSI · GEX (BTC)'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','ko','항상 켜짐: EMA 리본 · RSI · GEX (BTC)'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','zh','始终开启：EMA 均线带 · RSI · GEX（BTC）'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','ru','Всегда включено: EMA-лента · RSI · GEX (BTC)'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','ar','مفعّلة دائمًا: شريط EMA · RSI · GEX (BTC)'),
('STRATEGY_PANEL_EDIT_SETTINGS','en','Edit settings'),
('STRATEGY_PANEL_EDIT_SETTINGS','ko','설정 편집'),
('STRATEGY_PANEL_EDIT_SETTINGS','zh','编辑设置'),
('STRATEGY_PANEL_EDIT_SETTINGS','ru','Изменить настройки'),
('STRATEGY_PANEL_EDIT_SETTINGS','ar','تعديل الإعدادات')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','en','Always on: EMA ribbon · RSI · GEX (BTC)'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','ko','항상 켜짐: EMA 리본 · RSI · GEX (BTC)'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','zh','始终开启：EMA 均线带 · RSI · GEX（BTC）'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','ru','Всегда включено: EMA-лента · RSI · GEX (BTC)'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','ar','مفعّلة دائمًا: شريط EMA · RSI · GEX (BTC)'),
('STRATEGY_PANEL_EDIT_SETTINGS','en','Edit settings'),
('STRATEGY_PANEL_EDIT_SETTINGS','ko','설정 편집'),
('STRATEGY_PANEL_EDIT_SETTINGS','zh','编辑设置'),
('STRATEGY_PANEL_EDIT_SETTINGS','ru','Изменить настройки'),
('STRATEGY_PANEL_EDIT_SETTINGS','ar','تعديل الإعدادات')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
