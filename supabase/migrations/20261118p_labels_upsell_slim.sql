-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- Upsell overload (owner 2026-11-17): the slim locked row and the one-line EMA lock. New keys; en equals the shipped default. ko/zh/ru/ar AI-drafted, not native-reviewed (owner 2026-11-13).
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('UPGRADE_GATE_LOCKED_ROW','en','{feature} · Pro'),
('UPGRADE_GATE_LOCKED_ROW','ko','{feature} · Pro'),
('UPGRADE_GATE_LOCKED_ROW','zh','{feature} · Pro'),
('UPGRADE_GATE_LOCKED_ROW','ru','{feature} · Pro'),
('UPGRADE_GATE_LOCKED_ROW','ar','{feature} · Pro'),
('EMA_SIGNAL_LOCKED_LINE','en','EMA signals for {coin} · Pro'),
('EMA_SIGNAL_LOCKED_LINE','ko','{coin} EMA 신호 · Pro'),
('EMA_SIGNAL_LOCKED_LINE','zh','{coin} 的 EMA 信号 · Pro'),
('EMA_SIGNAL_LOCKED_LINE','ru','EMA-сигналы для {coin} · Pro'),
('EMA_SIGNAL_LOCKED_LINE','ar','إشارات EMA لـ {coin} · Pro')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('UPGRADE_GATE_LOCKED_ROW','en','{feature} · Pro'),
('UPGRADE_GATE_LOCKED_ROW','ko','{feature} · Pro'),
('UPGRADE_GATE_LOCKED_ROW','zh','{feature} · Pro'),
('UPGRADE_GATE_LOCKED_ROW','ru','{feature} · Pro'),
('UPGRADE_GATE_LOCKED_ROW','ar','{feature} · Pro'),
('EMA_SIGNAL_LOCKED_LINE','en','EMA signals for {coin} · Pro'),
('EMA_SIGNAL_LOCKED_LINE','ko','{coin} EMA 신호 · Pro'),
('EMA_SIGNAL_LOCKED_LINE','zh','{coin} 的 EMA 信号 · Pro'),
('EMA_SIGNAL_LOCKED_LINE','ru','EMA-сигналы для {coin} · Pro'),
('EMA_SIGNAL_LOCKED_LINE','ar','إشارات EMA لـ {coin} · Pro')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
