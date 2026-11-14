import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cronAuth';
import { reportHealth } from '@/lib/apiHealth';
import { fetchRibbonCandles, closedCandles, type EMASignalTF } from '@/lib/ribbonCandles';
import { persistAlertFires, type FireForOutcome } from '@/lib/alertOutcomes';
import { STRATEGIES } from '@/lib/strategies';
import { TF_MS } from '@/lib/candles';

export const dynamic = 'force-dynamic';

/* THE ARENA STRATEGY FIRE LOG (owner-requested, 2026-11-14): every strategy on every tracked coin and logged timeframe is evaluated on CLOSED candles, and a fresh
 * buy/sell is written to lhq_alert_fires as `strat_<id>_<tf>` so the existing 24 h / 48 h resolver prices it. This is how a strategy earns a measured hit rate;
 * until then the card claims none. Run on a schedule, every 15 min (cron-job.org, owner's account): a re-detection of the same signal is deduplicated by
 * persistAlertFires (two candles of the strategy's own timeframe), so extra ticks are harmless. */

const TRACKED_COINS = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'ltc', 'bch', 'ada'] as const;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const fires: FireForOutcome[] = [];
  const errors: string[] = [];
  let evaluated = 0;
  for (const def of STRATEGIES) {
    for (const tf of def.logTfs) {
      const tfMs = TF_MS[tf];
      if (!tfMs) continue;
      for (const coin of TRACKED_COINS) {
        try {
          const all = await fetchRibbonCandles(coin, tf as EMASignalTF);
          const closed = closedCandles(all, tf as EMASignalTF);
          /* TOO FEW CANDLES IS UNKNOWN, NOT 'NO SIGNAL': counted as a failure of the pass, so the health row cannot read healthy on a silent venue. */
          if (closed.length < def.minCandles) { errors.push(`${def.id}/${coin}/${tf}: only ${closed.length} candles`); continue; }
          evaluated++;
          const r = def.detect(closed, { coin, tf, tfMs });
          if (r.verdict === 'wait' || !r.signalDir) continue;
          const price = closed[closed.length - 1].close;
          fires.push({
            ruleKey: `strat_${def.id}_${tf}`,
            coin,
            dir: r.signalDir,
            label: `${def.id} ${r.verdict} ${coin.toUpperCase()} ${tf}`,
            price,
          });
        } catch (err) {
          errors.push(`${def.id}/${coin}/${tf}: ${String(err).slice(0, 80)}`);
        }
      }
    }
  }
  const tally = await persistAlertFires(fires);
  const ok = errors.length === 0 && tally.failed === 0;
  reportHealth(
    'strategies-track', 'market', ok,
    ok ? `${evaluated} evaluated, ${tally.stored} stored, ${tally.deduped} already logged`
       : `${errors.length} read failures, ${tally.failed} of ${tally.attempted} fires failed to store`,
    tally.stored,
  );
  return NextResponse.json({ evaluated, fires: tally, errors });
}
