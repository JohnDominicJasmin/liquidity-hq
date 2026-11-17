-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The compact Strategy panel: a one-line Pro link ("Want more at once? See Pro ->") and the one-line "Always on" caption for the chart layers. New keys; the en rows equal the shipped defaults.
-- ko/zh/ru/ar are AI-drafted and not native-reviewed (owner's 2026-11-13 ruling).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('STRATEGY_PANEL_PRO_LINE','en','Want more at once? See Pro →'),
('STRATEGY_PANEL_PRO_LINE','ko','한 번에 더 많이 쓰고 싶으세요? Pro 보기 →'),
('STRATEGY_PANEL_PRO_LINE','zh','想同时用更多？了解 Pro →'),
('STRATEGY_PANEL_PRO_LINE','ru','Нужно больше сразу? Смотрите Pro →'),
('STRATEGY_PANEL_PRO_LINE','ar','تريد المزيد دفعة واحدة؟ اطّلع على Pro ←'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','en','Always on: {ema} · {rsi} · {gex} (BTC only)'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','ko','항상 켜짐: {ema} · {rsi} · {gex} (BTC 전용)'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','zh','始终开启：{ema} · {rsi} · {gex}（仅 BTC）'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','ru','Всегда включено: {ema} · {rsi} · {gex} (только BTC)'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','ar','مفعّلة دائمًا: {ema} · {rsi} · {gex} (BTC فقط)')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('STRATEGY_PANEL_PRO_LINE','en','Want more at once? See Pro →'),
('STRATEGY_PANEL_PRO_LINE','ko','한 번에 더 많이 쓰고 싶으세요? Pro 보기 →'),
('STRATEGY_PANEL_PRO_LINE','zh','想同时用更多？了解 Pro →'),
('STRATEGY_PANEL_PRO_LINE','ru','Нужно больше сразу? Смотрите Pro →'),
('STRATEGY_PANEL_PRO_LINE','ar','تريد المزيد دفعة واحدة؟ اطّلع على Pro ←'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','en','Always on: {ema} · {rsi} · {gex} (BTC only)'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','ko','항상 켜짐: {ema} · {rsi} · {gex} (BTC 전용)'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','zh','始终开启：{ema} · {rsi} · {gex}（仅 BTC）'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','ru','Всегда включено: {ema} · {rsi} · {gex} (только BTC)'),
('STRATEGY_PANEL_LAYERS_ALWAYS_LINE','ar','مفعّلة دائمًا: {ema} · {rsi} · {gex} (BTC فقط)')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
