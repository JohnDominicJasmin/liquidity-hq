-- Labels for the new EMA Buy/Sell Signal timeframe picker on /alerts,
-- replacing the removed ALERTS_EMA_SETUP_*/ALERTS_EMA_CROSS_* keys (dropped
-- from lib/labelKeys.ts - see pendings/ALERTS.md). English-only for now,
-- matching the paused-translation convention (PENDING.md) - falls back to
-- English on every other locale via the labels API's merge behavior.
-- Applied live against both lhq_labels (prod, qdpwhnvmhqgzijuwopso) and
-- lhq_dev_labels (dev, wdtjhrilakoitfcezxpx) via execute_sql.

insert into lhq_labels (key, locale, value) values
('ALERTS_EMA_SIGNAL_TITLE','en','EMA Buy/Sell Signal'),
('ALERTS_EMA_SIGNAL_DESC','en','The same confirmed buy or sell call your Arena chart draws, with entry, stop loss, and target included. Choose which timeframes to receive it on below.'),
('ALERTS_TF_COUNT','en','Timeframes - {onCount}/{cap} on'),
('ALERTS_TF_OVER_LIMIT','en','Timeframes - {onCount} on (limit {cap} - turn some off)'),
('ALERTS_TF_CAP_REACHED_MSG','en','Limit reached ({cap}/{cap} timeframes) - turn one off to add another.'),
('ALERTS_TF_CAP_OVER_MSG','en','You have {onCount} timeframes on, above the {cap}-timeframe limit - turn some off before adding another.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- Same 6 rows, run against lhq_dev_labels on wdtjhrilakoitfcezxpx (already applied).

-- Stale-reference fix: ALERTS_COIN_SELECTION_DESC (existing key, both
-- projects) named "EMA Ribbon Setup entry signals" - that feature no longer
-- exists under that name. Updated the English value only (already applied,
-- both projects):
--   old: 'Tap a coin to stop all alerts for it, including which coins the
--         EMA Ribbon Setup entry signals scan. Your saved price alerts are
--         not affected.'
--   new: 'Tap a coin to stop all alerts for it, including which coins the
--         EMA Buy/Sell Signal scans. Your saved price alerts are not affected.'
-- NOT fixed: the same stale "EMA Ribbon Setup" / "EMA Ribbon 设置" / etc
-- wording still exists in the ko/zh/ar/ru translations of this same key -
-- left alone (translation work is paused, and patching a single term
-- accurately in 4 languages I can't verify natively is riskier than leaving
-- a stale-but-still-correct-shaped sentence). Worth a small patch whenever
-- translation work resumes.

-- Cleanup: the 10 keys these replace (ALERTS_SECTION_TRADING_SIGNALS,
-- ALERTS_EMA_SETUP_4H/1H/30M/15M_TITLE/DESC, ALERTS_SECTION_TREND,
-- ALERTS_EMA_CROSS_TITLE/DESC) are no longer referenced anywhere in the code
-- (checked: only lib/labelKeys.ts had them, already removed from there too).
-- Leaving the old rows in lhq_labels/lhq_dev_labels is harmless (the labels
-- API only ever looks up keys the code actually asks for), so no delete
-- statement here - stale but inert rows, consistent with how this project
-- has handled prior key removals.
