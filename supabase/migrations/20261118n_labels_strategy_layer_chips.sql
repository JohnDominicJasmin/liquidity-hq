-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- #2500: the four CHART LAYERS chips (EMA ribbon, RSI, S/R, Liq clusters). New keys; en equals the shipped default. ko/zh/ru/ar AI-drafted, not native-reviewed (owner 2026-11-13).
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('ARENA_LAYERS_GATE_FEATURE_LABEL','en','S/R and liquidity layers'),
('ARENA_LAYERS_GATE_FEATURE_LABEL','ko','S/R 및 청산 레이어'),
('ARENA_LAYERS_GATE_FEATURE_LABEL','zh','支撑阻力与清算图层'),
('ARENA_LAYERS_GATE_FEATURE_LABEL','ru','Слои S/R и ликвидности'),
('ARENA_LAYERS_GATE_FEATURE_LABEL','ar','طبقات الدعم/المقاومة والسيولة'),
('STRATEGY_PANEL_LAYER_EMA_SHORT','en','EMA ribbon'),
('STRATEGY_PANEL_LAYER_EMA_SHORT','ko','EMA 리본'),
('STRATEGY_PANEL_LAYER_EMA_SHORT','zh','EMA 均线带'),
('STRATEGY_PANEL_LAYER_EMA_SHORT','ru','EMA-лента'),
('STRATEGY_PANEL_LAYER_EMA_SHORT','ar','شريط EMA'),
('STRATEGY_PANEL_LAYER_RSI_SHORT','en','RSI'),
('STRATEGY_PANEL_LAYER_RSI_SHORT','ko','RSI'),
('STRATEGY_PANEL_LAYER_RSI_SHORT','zh','RSI'),
('STRATEGY_PANEL_LAYER_RSI_SHORT','ru','RSI'),
('STRATEGY_PANEL_LAYER_RSI_SHORT','ar','RSI'),
('STRATEGY_PANEL_LAYER_SR_SHORT','en','S/R'),
('STRATEGY_PANEL_LAYER_SR_SHORT','ko','S/R'),
('STRATEGY_PANEL_LAYER_SR_SHORT','zh','S/R'),
('STRATEGY_PANEL_LAYER_SR_SHORT','ru','S/R'),
('STRATEGY_PANEL_LAYER_SR_SHORT','ar','S/R'),
('STRATEGY_PANEL_LAYER_LIQ_SHORT','en','Liq clusters'),
('STRATEGY_PANEL_LAYER_LIQ_SHORT','ko','청산 클러스터'),
('STRATEGY_PANEL_LAYER_LIQ_SHORT','zh','清算集群'),
('STRATEGY_PANEL_LAYER_LIQ_SHORT','ru','Кластеры ликв.'),
('STRATEGY_PANEL_LAYER_LIQ_SHORT','ar','تجمعات التصفية')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('ARENA_LAYERS_GATE_FEATURE_LABEL','en','S/R and liquidity layers'),
('ARENA_LAYERS_GATE_FEATURE_LABEL','ko','S/R 및 청산 레이어'),
('ARENA_LAYERS_GATE_FEATURE_LABEL','zh','支撑阻力与清算图层'),
('ARENA_LAYERS_GATE_FEATURE_LABEL','ru','Слои S/R и ликвидности'),
('ARENA_LAYERS_GATE_FEATURE_LABEL','ar','طبقات الدعم/المقاومة والسيولة'),
('STRATEGY_PANEL_LAYER_EMA_SHORT','en','EMA ribbon'),
('STRATEGY_PANEL_LAYER_EMA_SHORT','ko','EMA 리본'),
('STRATEGY_PANEL_LAYER_EMA_SHORT','zh','EMA 均线带'),
('STRATEGY_PANEL_LAYER_EMA_SHORT','ru','EMA-лента'),
('STRATEGY_PANEL_LAYER_EMA_SHORT','ar','شريط EMA'),
('STRATEGY_PANEL_LAYER_RSI_SHORT','en','RSI'),
('STRATEGY_PANEL_LAYER_RSI_SHORT','ko','RSI'),
('STRATEGY_PANEL_LAYER_RSI_SHORT','zh','RSI'),
('STRATEGY_PANEL_LAYER_RSI_SHORT','ru','RSI'),
('STRATEGY_PANEL_LAYER_RSI_SHORT','ar','RSI'),
('STRATEGY_PANEL_LAYER_SR_SHORT','en','S/R'),
('STRATEGY_PANEL_LAYER_SR_SHORT','ko','S/R'),
('STRATEGY_PANEL_LAYER_SR_SHORT','zh','S/R'),
('STRATEGY_PANEL_LAYER_SR_SHORT','ru','S/R'),
('STRATEGY_PANEL_LAYER_SR_SHORT','ar','S/R'),
('STRATEGY_PANEL_LAYER_LIQ_SHORT','en','Liq clusters'),
('STRATEGY_PANEL_LAYER_LIQ_SHORT','ko','청산 클러스터'),
('STRATEGY_PANEL_LAYER_LIQ_SHORT','zh','清算集群'),
('STRATEGY_PANEL_LAYER_LIQ_SHORT','ru','Кластеры ликв.'),
('STRATEGY_PANEL_LAYER_LIQ_SHORT','ar','تجمعات التصفية')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
