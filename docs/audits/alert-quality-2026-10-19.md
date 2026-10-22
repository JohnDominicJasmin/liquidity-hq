# Alert quality scorecard (2026-10-19)

**Private, internal measurement. Not marketing material.** PRODUCT.md forbids accuracy, profit or "we called it" claims; nothing here may be published as a track record.

## Source and method
- Table `lhq_alert_fires` on production (`qdpwhnvmhqgzijuwopso`), read-only queries run 2026-10-19 ~08:40 UTC by PM/DevOps.
- Every directional Telegram alert is logged at fire time; `app/api/alert-outcomes/resolve/route.ts` records the signed price move at +24h and +48h ("positive = favorable relative to dir", misses included).
- "Favorable" = the price moved in the alert's direction by the window end. It is not a trade result (no stop, target, fees or slippage).
- Window: first fires 2026-07-19 to 2026-07-25 depending on type, through 2026-10-19.

## Results (24h window)

| Alert (`rule_key`) | Fires | Per day | Favorable 24h | Avg move 24h | Favorable 48h | Avg move 48h |
|---|---|---|---|---|---|---|
| ema_signal_15m | 18,078 | 210.3 | 51.0% | +0.23% | 50.6% | +0.23% |
| ema_signal_30m | 12,570 | 145.2 | 51.0% | +0.36% | 50.6% | +0.34% |
| ema_signal_5m | 9,251 | 142.4 | 50.0% | +0.04% | 49.6% | +0.02% |
| rsi | 4,567 | 49.6 | 51.4% | **-0.71%** | 51.2% | **-1.00%** |
| ema_signal_1m | 2,083 | 32.1 | 48.9% | -0.05% | 48.6% | -0.14% |
| whales | 1,939 | 21.4 | 50.8% | -0.01% | 49.7% | -0.04% |
| ema_signal_1h | 1,918 | 29.5 | 53.8% | +0.73% | 53.1% | +0.68% |
| ema_signal_4h | 1,619 | 18.7 | 49.4% | +1.36% | 52.2% | +1.65% |
| ema_cross | 263 | 48.8* | 51.0% | -0.03% | 48.3% | +0.04% |
| ema_signal_2h | 206 | 3.2 | 74.8% | +4.76% | 64.6% | +3.94% |
| ema_signal_1d | 115 | 1.8 | 77.4% | +12.68% | 80.0% | +11.97% |

*ema_cross fired over a few days only and stopped 2026-07-24.

## Reading it honestly
1. **Most alert types are a coin flip** (49-51% favorable) and the fast ones fire 140-210 times a day. That is noise, not signal.
2. **RSI alerts lose on average** (-0.71% at 24h, -1.00% at 48h): the misses are bigger than the hits.
3. **The 2h and 1d numbers are not evidence.** They fired on only 3-4 distinct days in total; one day carried up to 77% of a direction's fires (1d short 77.3%, 1d long 59.2%, 2h long 67.2%). That is one market-wide move lifting many coins at once.
4. **1h depends on market direction:** longs 43.1% favorable (857 fires), shorts 62.5% (1,061). The market fell over the window, so shorts looked good.

## Measurement gaps
- **Five timeframes stopped logging at the same second, 2026-09-27 17:26:15 UTC:** ema_signal_1m, 5m, 1h, 2h, 1d (zero fires in the last 7 days). The same day as release v2026.09.27. Unknown whether intentional; the alert jobs run on an external scheduler (see `docs/INFRASTRUCTURE.md`). Needs a check before any conclusion.
- **Squeeze and distribution alerts have no outcome rows,** although the table's migration lists them as scored types. They cannot be measured today.
- **The AI read (Quick/Deep verdicts) is not logged anywhere,** so its quality is unknown.

## Re-run
```sql
select rule_key, count(*) fires,
  round(100.0*count(*) filter (where resolved_24h and outcome_pct_24h>0)/nullif(count(*) filter (where resolved_24h),0),1) pct_fav_24h,
  round(avg(outcome_pct_24h) filter (where resolved_24h),2) avg_24h
from lhq_alert_fires group by rule_key order by fires desc;
```
