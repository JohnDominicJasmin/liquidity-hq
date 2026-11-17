-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) BEFORE the release deploy; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The Draw Structure risk box (owner decision 2026-11-17, #1263): the R:R label and the one caption. New keys; the en rows equal the shipped defaults. ko/zh/ru/ar are AI-drafted and not native-reviewed (owner's 2026-11-13 ruling).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('CHANNEL_BOX_RR','en','R:R {rr}'),
('CHANNEL_BOX_RR','ko','손익비 {rr}'),
('CHANNEL_BOX_RR','zh','盈亏比 {rr}'),
('CHANNEL_BOX_RR','ru','R:R {rr}'),
('CHANNEL_BOX_RR','ar','R:R {rr}'),
('DRAW_STRUCTURE_LEVELS_CAPTION','en','Levels from the Channel strategy, not a prediction.'),
('DRAW_STRUCTURE_LEVELS_CAPTION','ko','채널 전략의 수준이며 예측이 아닙니다.'),
('DRAW_STRUCTURE_LEVELS_CAPTION','zh','价位来自通道策略，并非预测。'),
('DRAW_STRUCTURE_LEVELS_CAPTION','ru','Уровни из стратегии «Канал», а не прогноз.'),
('DRAW_STRUCTURE_LEVELS_CAPTION','ar','المستويات من استراتيجية القناة وليست توقعًا.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('CHANNEL_BOX_RR','en','R:R {rr}'),
('CHANNEL_BOX_RR','ko','손익비 {rr}'),
('CHANNEL_BOX_RR','zh','盈亏比 {rr}'),
('CHANNEL_BOX_RR','ru','R:R {rr}'),
('CHANNEL_BOX_RR','ar','R:R {rr}'),
('DRAW_STRUCTURE_LEVELS_CAPTION','en','Levels from the Channel strategy, not a prediction.'),
('DRAW_STRUCTURE_LEVELS_CAPTION','ko','채널 전략의 수준이며 예측이 아닙니다.'),
('DRAW_STRUCTURE_LEVELS_CAPTION','zh','价位来自通道策略，并非预测。'),
('DRAW_STRUCTURE_LEVELS_CAPTION','ru','Уровни из стратегии «Канал», а не прогноз.'),
('DRAW_STRUCTURE_LEVELS_CAPTION','ar','المستويات من استراتيجية القناة وليست توقعًا.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
