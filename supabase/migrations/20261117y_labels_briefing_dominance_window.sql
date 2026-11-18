-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The Briefing macro pulse states the window of the BTC dominance trend ("Alts weak . 24h"). New keys; the en rows equal the shipped defaults.
-- ko/zh/ru/ar are AI-drafted and not native-reviewed (owner's 2026-11-13 ruling).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('BRIEFING_DOM_WINDOW_24H','en','24h'),
('BRIEFING_DOM_WINDOW_24H','ko','24시간'),
('BRIEFING_DOM_WINDOW_24H','zh','24小时'),
('BRIEFING_DOM_WINDOW_24H','ru','24 ч'),
('BRIEFING_DOM_WINDOW_24H','ar','24 ساعة'),
('BRIEFING_DOM_WINDOW_SHORT','en','~50 min'),
('BRIEFING_DOM_WINDOW_SHORT','ko','약 50분'),
('BRIEFING_DOM_WINDOW_SHORT','zh','约50分钟'),
('BRIEFING_DOM_WINDOW_SHORT','ru','~50 мин'),
('BRIEFING_DOM_WINDOW_SHORT','ar','~50 دقيقة')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('BRIEFING_DOM_WINDOW_24H','en','24h'),
('BRIEFING_DOM_WINDOW_24H','ko','24시간'),
('BRIEFING_DOM_WINDOW_24H','zh','24小时'),
('BRIEFING_DOM_WINDOW_24H','ru','24 ч'),
('BRIEFING_DOM_WINDOW_24H','ar','24 ساعة'),
('BRIEFING_DOM_WINDOW_SHORT','en','~50 min'),
('BRIEFING_DOM_WINDOW_SHORT','ko','약 50분'),
('BRIEFING_DOM_WINDOW_SHORT','zh','约50分钟'),
('BRIEFING_DOM_WINDOW_SHORT','ru','~50 мин'),
('BRIEFING_DOM_WINDOW_SHORT','ar','~50 دقيقة')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
