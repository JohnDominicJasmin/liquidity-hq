-- Recompute 51 fabricated alert outcomes: fired at the 1000x scale, resolved at the per-token one.
--
-- ⚠️ **NOT APPLIED. PENDING THE OWNER'S APPROVAL.** This file is a draft. It writes to the shared
-- database, which is one of the three things that goes to the owner directly, so nobody runs it on
-- the strength of this file existing. PM/DevOps recommends applying it; the decision is the owner's.
--
-- ── WHAT IS WRONG WITH THESE 51 ROWS ────────────────────────────────────────────────────────────
--
-- `outcome_pct_24h` is computed in app/api/alert-outcomes/resolve/route.ts:49-52 as
--
--     raw = (current - entry) / entry * 100 ;  pct = dir='long' ? raw : -raw
--
-- where `entry` is the stored `price_at_fire` and `current` is a freshly fetched price. For these
-- 51 rows the two sides are on DIFFERENT SCALES: `price_at_fire` was stored at Bybit's 1000x quote
-- (1000PEPEUSDT / 1000BONKUSDT quote per 1000 tokens) while the resolver had already been fixed to
-- divide the live price down to per-token. So every one of them reads an apparent ~100% move that
-- never happened:
--
--     28 shorts recorded as +99.90% WINS
--     23 longs  recorded as -99.90% LOSSES
--     all 51 between |99.90| and |99.91|
--
-- 50 are pepe/bonk `ema_signal_*` fires from 2026-07-30 15:00Z to 2026-07-31 14:55Z. The 51st is
-- id 39428, `whales`, 2026-09-22 — a different defect with the same signature, fixed in code by
-- PR #1970.
--
-- ── WHY THE AVERAGE DID NOT GIVE THEM AWAY, WHICH IS THE PART WORTH READING ─────────────────────
--
-- **The first pass at this looked at per-rule MEANS and concluded the rows were fine.** They are
-- not. 28 positives and 23 negatives of near-identical magnitude very nearly cancel, so the mean
-- over the 51 is **+9.79** while every single row in it is fabricated:
--
--     bucket                                    rows  |pct| min  |pct| max   mean
--     fire 1000x, resolve per-token (BROKEN)      51       99.90      99.91  +9.79   <- all 51 bad
--     fire 1000x, resolve 1000x     (FINE)       205        0.03      48.70  +0.35   <- all 205 ok
--
-- The 205 rows in the second bucket are genuinely correct and are deliberately NOT touched: a
-- percentage is scale-invariant when both sides share the scale, so a 1000x `price_at_fire`
-- resolved against a 1000x `price_24h` cancels and the stored pct is right. **Stored price being
-- wrong is not the defect. Fire scale disagreeing with resolve scale is the defect**, and that is
-- what the WHERE clause below keys on.
--
-- ── NOT URGENT, AND THE REASON IS WORTH STATING SO IT IS NOT RE-DERIVED ─────────────────────────
--
-- **None of the 51 can reach a user today.** components/AlertOutcomes.tsx reads
-- `.order('fired_at', desc).limit(500)` over the whole table and renders only per-rule aggregates;
-- the per-fire "Recent Fires" list was removed earlier. Measured 2026-11-05:
--
--     fabricated rows inside that 500-row window : 0
--     best rank any fabricated row reaches       : 19,537
--     oldest fire still inside the window        : 2026-11-04
--     resolved rows in the table                 : 58,576
--
-- So this is a data-integrity correction, not an incident. It matters because the rows are wrong
-- and because the window is a moving limit rather than a filter — nothing stops a future query,
-- export, or backtest reading them.
--
-- ── BEFORE / AFTER, per rule and coin, computed 2026-11-05 ──────────────────────────────────────
--
--   rule_key         coin  rows   pct24 before -> after    wins before -> after
--   ema_signal_5m    pepe    27          +3.70 -> -0.10          14 -> 13
--   ema_signal_5m    bonk    11          +9.08 -> +0.42           6 ->  5
--   ema_signal_30m   bonk     4          +0.00 -> -0.50           2 ->  2
--   ema_signal_1h    bonk     4          +0.00 -> +0.11           2 ->  2
--   ema_signal_30m   pepe     3         +33.30 -> -0.75           2 ->  1
--   ema_signal_1h    pepe     1         +99.90 -> -1.94           1 ->  0
--   whales           pepe     1         +99.90 -> +4.72           1 ->  1
--                          ----
--                            51
--
-- Corrected values span -5.84% to +5.90% at 24h and -7.20% to +16.81% at 48h, which is what a real
-- pepe/bonk move looks like over those windows. That range is the sanity check on the recompute: a
-- bug in the arithmetic here would not land inside it.
--
-- ── DRY-RUN VERIFIED, 2026-11-05, WITHOUT WRITING ───────────────────────────────────────────────
--
-- The two UPDATE statements' exact SET expressions were run as a SELECT against prod. Results:
--
--     rows matched                        51      (expected 51)
--     rows still at |pct| > 99 after        0      (the defect is gone)
--     rows still >= 1e-4 after              0      (so the WHERE cannot re-match: idempotent)
--     NULL percentages produced             0
--     control: the 205 same-scale rows    205, mean +0.35 — unchanged
--
-- The control is the load-bearing one. It is the set this file must NOT touch, and it returns the
-- same count and the same mean, which is what separates "corrected the 51" from "rescaled pepe".
--
-- ── WHY IT IS A RECOMPUTE AND NOT A DELETE ──────────────────────────────────────────────────────
--
-- The fires happened and `price_24h`/`price_48h` are correct, so the outcome is recoverable rather
-- than lost. Deleting would also silently shrink the denominator of a published win rate.
--
-- ── IDEMPOTENT, AND BY CONSTRUCTION RATHER THAN BY ASSERTION ────────────────────────────────────
--
-- Each statement corrects `price_at_fire` in the SAME update that recomputes the percentages. All
-- SET expressions read the OLD row, so the pcts are computed from the old 1000x value while
-- `price_at_fire` is rewritten per-token. After it runs, `price_at_fire >= 1e-4` is false for these
-- rows and the WHERE clause matches NOTHING. Re-running is a no-op that reports `UPDATE 0`.
--
-- No ids are hardcoded: the predicate is value-based, so a row that was somehow missed is caught on
-- a later run, and a row already corrected cannot be corrected twice.
--
-- ── THE DIVISOR IS 1000 BECAUSE THIS SET IS pepe AND bonk ONLY. DO NOT COPY THIS FILE BLINDLY ───
--
-- Both are `1000`-prefixed on Bybit, so the factor is exactly 1000. Other 1000x listings are NOT:
-- `sats` is `10000SATSUSDT` (10,000) and `mog` is `1000000MOGUSDT` (1,000,000). Neither has any
-- affected row — neither carries a WHALE_THRESHOLD and neither has fires in this state — but a
-- future correction for them needs its own divisor. The `coin IN ('pepe','bonk')` guard is what
-- makes the literal 1000 safe here, and it is why it is not derived.
--
-- ── VERIFY BEFORE AND AFTER ─────────────────────────────────────────────────────────────────────
--
--   SELECT count(*) AS should_be_51_before_and_0_after
--   FROM lhq_alert_fires
--   WHERE coin IN ('pepe','bonk') AND price_at_fire >= 1e-4
--     AND price_24h IS NOT NULL AND price_24h < 1e-4;
--
--   SELECT rule_key, coin, count(*), round(avg(outcome_pct_24h),2)
--   FROM lhq_alert_fires
--   WHERE coin IN ('pepe','bonk') AND fired_at >= '2026-07-30' AND fired_at < '2026-08-01'
--   GROUP BY rule_key, coin ORDER BY 3 DESC;
--
--   -- and the control that must NOT move: the 205 same-scale rows
--   SELECT count(*) AS should_be_205, round(avg(outcome_pct_24h),2) AS should_stay_0_35
--   FROM lhq_alert_fires
--   WHERE coin IN ('pepe','bonk') AND price_at_fire >= 1e-4 AND resolved_24h
--     AND (price_24h IS NULL OR price_24h >= 1e-4);
--   -- NOTE: after the fix above, `price_at_fire >= 1e-4` no longer selects the corrected 51, so
--   -- this control returns the same 205 rows and the same mean before and after. If it moves,
--   -- the update touched rows it should not have.

-- ════════════════════════════════════════════════════════════════════════════
-- PROD  (lhq_)  — 51 rows expected
-- ════════════════════════════════════════════════════════════════════════════

UPDATE lhq_alert_fires
SET
  outcome_pct_24h = CASE
    WHEN price_24h IS NULL THEN outcome_pct_24h
    WHEN dir = 'long'
      THEN  ((price_24h - price_at_fire / 1000.0) / (price_at_fire / 1000.0)) * 100
      ELSE -(((price_24h - price_at_fire / 1000.0) / (price_at_fire / 1000.0)) * 100)
  END,
  outcome_pct_48h = CASE
    WHEN price_48h IS NULL THEN outcome_pct_48h
    WHEN dir = 'long'
      THEN  ((price_48h - price_at_fire / 1000.0) / (price_at_fire / 1000.0)) * 100
      ELSE -(((price_48h - price_at_fire / 1000.0) / (price_at_fire / 1000.0)) * 100)
  END,
  price_at_fire = price_at_fire / 1000.0
WHERE coin IN ('pepe', 'bonk')
  AND price_at_fire >= 1e-4           -- fired at the 1000x scale
  AND price_24h IS NOT NULL
  AND price_24h  <  1e-4;             -- resolved at the per-token scale: the actual defect

-- ════════════════════════════════════════════════════════════════════════════
-- DEV  (lhq_dev_)  — 0 rows expected, and that is MEASURED, not assumed.
--
-- Queried 2026-11-05: dev holds no row in this state. The statement is kept so the two projects
-- stay symmetrical and so a later dev fire in the same state is caught by re-running the file,
-- rather than leaving dev as the project nobody wrote a statement for. Expect `UPDATE 0`.
-- ════════════════════════════════════════════════════════════════════════════

UPDATE lhq_dev_alert_fires
SET
  outcome_pct_24h = CASE
    WHEN price_24h IS NULL THEN outcome_pct_24h
    WHEN dir = 'long'
      THEN  ((price_24h - price_at_fire / 1000.0) / (price_at_fire / 1000.0)) * 100
      ELSE -(((price_24h - price_at_fire / 1000.0) / (price_at_fire / 1000.0)) * 100)
  END,
  outcome_pct_48h = CASE
    WHEN price_48h IS NULL THEN outcome_pct_48h
    WHEN dir = 'long'
      THEN  ((price_48h - price_at_fire / 1000.0) / (price_at_fire / 1000.0)) * 100
      ELSE -(((price_48h - price_at_fire / 1000.0) / (price_at_fire / 1000.0)) * 100)
  END,
  price_at_fire = price_at_fire / 1000.0
WHERE coin IN ('pepe', 'bonk')
  AND price_at_fire >= 1e-4
  AND price_24h IS NOT NULL
  AND price_24h  <  1e-4;
