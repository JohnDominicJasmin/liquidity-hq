-- #1673 item 1 (owner, 2026-10-22, on "BTC RSI (14, 15M)": "It looks like million... It's too confusing. Do better."): every label that shows a
-- chart timeframe or a time window as jargon now says it in plain words. The RSI label is the owner's own wording, "BTC RSI (15-minute chart)",
-- with the RSI period (14) dropped. The rest is the sweep the owner asked for: labels whose "15m" / "1h" / "4h" / "24h" / "7d" are shown in
-- capitals ("15M" reads as 15 million) or written that way. Found by reading every render site at c842556f; the before -> after list is on #1673.
--
-- ENGLISH ONLY, 29 keys. The owner chose "English now, the rest later" on 2026-10-22, having been told the other four locales would be Dev
-- machine translations with no native review. ar/ko/ru/zh keep TODAY's wording until a speaker has checked the new strings: imperfect, but not
-- wrong. Their rows are written and held in 20261022d_labels_timeframes_translations.sql, which must NOT be applied before that review.
--
-- Overwrites the live English row for each key (the label table is the record).
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out (apply to dev only when QA says no test pass is running).
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).

insert into lhq_labels (key, locale, value) values
('MARKET_CONDITIONS_WIDGET_RSI_LABEL','en','BTC RSI (15-minute chart)'),
('DASH_EDGE_OI1H_LABEL','en','Open Interest, last hour - {coin}'),
('ARENA_SCANNER_COL_24H','en','24 hours'),
('MARKETS_24H_COL_LABEL','en','24 hours'),
('FUNDING_RANGE_24H','en','24 hours'),
('FUNDING_RANGE_3D','en','3 days'),
('FUNDING_RANGE_7D','en','7 days'),
('FUNDING_RANGE_14D','en','14 days'),
('HOURS_SESSION_MAP_TITLE','en','24-hour session map'),
('WHALE_TRADES_FEED_STAT_BUYS','en','Whale buys (last hour)'),
('WHALE_TRADES_FEED_STAT_SELLS','en','Whale sells (last hour)'),
('SIGNAL_ACCURACY_COL_WIN_RATE_12H','en','Win rate after 12 hours'),
('SIGNAL_ACCURACY_COL_WIN_RATE_24H','en','Win rate after 24 hours'),
('LIQ_FEED_CLUSTERS_TITLE','en','Hot price levels · last 24 hours'),
('SPOTLIGHT_TOUR_CARD2_LABEL','en','OI change (last 4 hours)'),
('ABSORPTION_DETECTOR_TITLE','en','Absorption Detector · 15-minute chart'),
('ABSORPTION_DETECTOR_MTF_BADGE','en','1-hour ✓'),
('ABSORPTION_DETECTOR_FOOTER','en','Accum = buyers absorbing sells (price should fall but holds) · Distrib = sellers absorbing buys · 15-minute and 1-hour charts'),
('MARKET_STRUCTURE_TITLE','en','Market Structure · 4-hour chart'),
('MARKET_STRUCTURE_FOOTER','en','BOS = trend continuation · CHoCH = potential reversal · 4-hour chart, swing lookback 3'),
('SIGNAL_ACCURACY_CANDLES_INFO','en','BTC · 4-hour chart · last {candles} candles'),
('HIGHER_TF_MOVE_BADGE_MOVE_TEXT','en','4-hour chart: {direction} {pct}% in about 24 hours'),
('MULTI_TF_ALIGNMENT_SUBTITLE','en','{coin} RSI direction - 5 min · 15 min · 1 hour · 4 hours · 1 day · 1 week · 1 month'),
('ALERTS_RSI_TITLE','en','RSI (1-hour chart)'),
('ALERTS_RAPID_MOVES_DESC','en','±5% in one 1-hour candle · ±10% in one 4-hour candle · flash ±4% in 5 min · cooldowns 30 min to 4 hours'),
('ARENA_NOTIF_RSI_OB_TITLE','en','{coin} Momentum too high (1-hour chart)'),
('ARENA_NOTIF_RSI_OS_TITLE','en','{coin} Momentum too low (1-hour chart)'),
('SETUP_SCANNER_RSI_VAL','en','15-minute RSI {v}'),
('BRIEFING_TAG_RSI','en','15-minute RSI {value}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: the same rows against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('MARKET_CONDITIONS_WIDGET_RSI_LABEL','en','BTC RSI (15-minute chart)'),
-- ('DASH_EDGE_OI1H_LABEL','en','Open Interest, last hour - {coin}'),
-- ('ARENA_SCANNER_COL_24H','en','24 hours'),
-- ('MARKETS_24H_COL_LABEL','en','24 hours'),
-- ('FUNDING_RANGE_24H','en','24 hours'),
-- ('FUNDING_RANGE_3D','en','3 days'),
-- ('FUNDING_RANGE_7D','en','7 days'),
-- ('FUNDING_RANGE_14D','en','14 days'),
-- ('HOURS_SESSION_MAP_TITLE','en','24-hour session map'),
-- ('WHALE_TRADES_FEED_STAT_BUYS','en','Whale buys (last hour)'),
-- ('WHALE_TRADES_FEED_STAT_SELLS','en','Whale sells (last hour)'),
-- ('SIGNAL_ACCURACY_COL_WIN_RATE_12H','en','Win rate after 12 hours'),
-- ('SIGNAL_ACCURACY_COL_WIN_RATE_24H','en','Win rate after 24 hours'),
-- ('LIQ_FEED_CLUSTERS_TITLE','en','Hot price levels · last 24 hours'),
-- ('SPOTLIGHT_TOUR_CARD2_LABEL','en','OI change (last 4 hours)'),
-- ('ABSORPTION_DETECTOR_TITLE','en','Absorption Detector · 15-minute chart'),
-- ('ABSORPTION_DETECTOR_MTF_BADGE','en','1-hour ✓'),
-- ('ABSORPTION_DETECTOR_FOOTER','en','Accum = buyers absorbing sells (price should fall but holds) · Distrib = sellers absorbing buys · 15-minute and 1-hour charts'),
-- ('MARKET_STRUCTURE_TITLE','en','Market Structure · 4-hour chart'),
-- ('MARKET_STRUCTURE_FOOTER','en','BOS = trend continuation · CHoCH = potential reversal · 4-hour chart, swing lookback 3'),
-- ('SIGNAL_ACCURACY_CANDLES_INFO','en','BTC · 4-hour chart · last {candles} candles'),
-- ('HIGHER_TF_MOVE_BADGE_MOVE_TEXT','en','4-hour chart: {direction} {pct}% in about 24 hours'),
-- ('MULTI_TF_ALIGNMENT_SUBTITLE','en','{coin} RSI direction - 5 min · 15 min · 1 hour · 4 hours · 1 day · 1 week · 1 month'),
-- ('ALERTS_RSI_TITLE','en','RSI (1-hour chart)'),
-- ('ALERTS_RAPID_MOVES_DESC','en','±5% in one 1-hour candle · ±10% in one 4-hour candle · flash ±4% in 5 min · cooldowns 30 min to 4 hours'),
-- ('ARENA_NOTIF_RSI_OB_TITLE','en','{coin} Momentum too high (1-hour chart)'),
-- ('ARENA_NOTIF_RSI_OS_TITLE','en','{coin} Momentum too low (1-hour chart)'),
-- ('SETUP_SCANNER_RSI_VAL','en','15-minute RSI {v}'),
-- ('BRIEFING_TAG_RSI','en','15-minute RSI {value}')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
