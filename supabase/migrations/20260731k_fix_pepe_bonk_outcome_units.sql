-- Repair PEPE/BONK alert outcomes recorded in mismatched price units.
--
-- Bybit quotes those two as 1000PEPEUSDT / 1000BONKUSDT - per 1000 tokens. The
-- alert cron used TWO different price sources without agreeing on a unit:
--
--   ema_signal_*        price_at_fire from fetchRibbonCandles - NOT normalised,
--                       so stored at 1000x (e.g. PEPE 0.0027)
--   rsi / ema_cross     price_at_fire from the spot price map - raw (0.0000027)
--
-- The outcome resolver then read Bybit's ticker, also 1000x and also
-- un-normalised. So the ema_* rows happened to be self-consistent (1000x vs
-- 1000x - the ratio cancels, percentages correct), while the rsi/ema_cross rows
-- compared raw against 1000x and produced moves of +-100,000%.
--
-- 22 rows of 6,201 dragged the Alert Track Record's average 24h move to
-- -126.70% when the true median is +0.27%.
--
-- Code fix (same commit): lib/coins.ts now exports bybitPriceFactor /
-- bybitSymbolPriceFactor, fetchRibbonCandles applies it to OHLC, and the
-- resolver applies it to the ticker - so every price is raw from here on. That
-- also fixes a user-visible bug: PEPE/BONK EMA and structure alerts were
-- quoting entry/SL/TP at 1000x the price the app's own ticker shows.
--
-- This migration repairs only the mismatched rows. The ~205 ema_* rows keep
-- their 1000x price_at_fire/price_24h - rewriting them would be cosmetic, their
-- percentages were never wrong, and leaving them makes the unit switch visible
-- in the data rather than silently rewritten.
--
-- Guarded on the ratio, not on rule_key or a percentage: a >100x jump between
-- fire price and outcome price is only possible from the unit mismatch. No coin
-- outside pepe/bonk matched (verified: 0 rows).
--
-- ALREADY APPLIED to prod 2026-07-31. Idempotent - after running, the ratio
-- guard no longer matches, so a second run is a no-op.
--
-- Result: avg outcome_pct_24h -126.70 -> +0.648, median +0.274. Two >50% rows
-- remain (BCH -52% 1d short, LDO +44% 4h long) - real moves, correct units.

-- ── PROD (qdpwhnvmhqgzijuwopso) ──────────────────────────────────────────────
update lhq_alert_fires
set price_24h = price_24h / 1000.0,
    outcome_pct_24h = (case when dir = 'long' then 1 else -1 end)
                      * ((price_24h / 1000.0) - price_at_fire) / price_at_fire * 100
where resolved_24h and coin in ('pepe', 'bonk') and price_24h / price_at_fire > 100;

update lhq_alert_fires
set price_48h = price_48h / 1000.0,
    outcome_pct_48h = (case when dir = 'long' then 1 else -1 end)
                      * ((price_48h / 1000.0) - price_at_fire) / price_at_fire * 100
where resolved_48h and coin in ('pepe', 'bonk') and price_48h / price_at_fire > 100;

-- ── DEV (wdtjhrilakoitfcezxpx) ───────────────────────────────────────────────
-- update lhq_dev_alert_fires
-- set price_24h = price_24h / 1000.0,
--     outcome_pct_24h = (case when dir = 'long' then 1 else -1 end)
--                       * ((price_24h / 1000.0) - price_at_fire) / price_at_fire * 100
-- where resolved_24h and coin in ('pepe', 'bonk') and price_24h / price_at_fire > 100;
--
-- update lhq_dev_alert_fires
-- set price_48h = price_48h / 1000.0,
--     outcome_pct_48h = (case when dir = 'long' then 1 else -1 end)
--                       * ((price_48h / 1000.0) - price_at_fire) / price_at_fire * 100
-- where resolved_48h and coin in ('pepe', 'bonk') and price_48h / price_at_fire > 100;
