import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { CoinId, BINANCE_SYMS, BYBIT_SYMS } from '@/lib/coins';
import { detectEMASignals, DEFAULT_FILTER_PARAMS, OHLCV } from '@/lib/strategyCore';
import { checkCronAuth } from '@/lib/cronAuth';
import { exchangeFetch } from '@/lib/exchangeGuard';
import { firstVenueThatAnswers } from '@/lib/venueFallback';
import { reportHealth, healthError } from '@/lib/apiHealth';

export const dynamic = 'force-dynamic';

// Live outcome tracking - majors only, 1h + 4h, using the default (raw signal) filter
// validated in the backtest. Runs on a schedule: detects newly-confirmed EMA Ribbon signals using
// the exact same shared detectEMASignals core the Arena chart and backtest engine use,
// logs them, then checks previously-logged open signals against current price to
// resolve win/loss. See app/backtest for the historical validation this complements.

const TRACKED_COINS: CoinId[] = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'ltc', 'bch', 'ada'];
const TRACKED_TFS = ['1h', '4h'] as const;

const TF_BN: Record<string, string> = { '1h': '1h', '4h': '4h' };
const TF_BY: Record<string, string> = { '1h': '60', '4h': '240' };
const TF_MS: Record<string, number> = { '1h': 3_600_000, '4h': 4 * 3_600_000 };

async function fetchBinanceFuturesKlines(sym: string, interval: string, limit: number): Promise<OHLCV[]> {
  const r = await exchangeFetch(
    `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`,
    { signal: AbortSignal.timeout(12_000) },
  );
  if (!r.ok) throw new Error(`Binance klines ${r.status}`);
  const raw = await r.json() as (string | number)[][];
  return raw.map(k => ({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
}

async function fetchBybitKlines(sym: string, interval: string, limit: number): Promise<OHLCV[]> {
  const r = await exchangeFetch(
    `https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=${interval}&limit=${limit}`,
    { signal: AbortSignal.timeout(12_000) },
  );
  if (!r.ok) throw new Error(`Bybit klines ${r.status}`);
  const d = await r.json() as { result?: { list?: string[][] } };
  const list = [...(d?.result?.list ?? [])].reverse();
  return list.map(k => ({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
}

/* THE THIRD CALL SITE OF THE #1263 SHAPE. This read:
 *
 *     if (bnSym) return fetchBinanceFuturesKlines(...);
 *     if (bySym) return fetchBybitKlines(...);
 *
 * which is not a fallback. The first branch returns on success AND throws on failure, so the Bybit
 * line was reachable only for a coin Binance does not list - the one case where it is not a fallback.
 * lib/venueFallback.ts's own header names this shape and the two call sites already converted
 * (useEMAStrategy, backtestEngine); this route was the third and was missed.
 *
 * MEASURED, because "has a fallback now" is worth less than how much of the route it covers: all 8 of
 * the 8 TRACKED_COINS carry BOTH a Binance and a Bybit symbol, so 100% of this route's fetches were
 * single-venue and all 8 gain a second one. There is no coin here for which this changes nothing. */
async function fetchOHLCV(coin: CoinId, tf: string, limit: number): Promise<OHLCV[]> {
  const bnSym = BINANCE_SYMS[coin];
  const bySym = BYBIT_SYMS[coin];
  return firstVenueThatAnswers<OHLCV[]>([
    bnSym ? { venue: 'Binance futures', run: () => fetchBinanceFuturesKlines(bnSym, TF_BN[tf], limit) } : null,
    bySym ? { venue: 'Bybit',           run: () => fetchBybitKlines(bySym, TF_BY[tf], limit) } : null,
  ], `${coin}/${tf}`);
}

interface OpenRow {
  id: number; coin: string; tf: string; dir: 'long' | 'short';
  entry_price: number; sl: number; tp: number; signal_time: string;
}

async function runTracking(): Promise<{ logged: string[]; resolved: string[]; errors: string[] }> {
  const admin = getSupabaseAdmin();
  const logged: string[] = [];
  const resolved: string[] = [];
  const errors: string[] = [];

  // 1. Detect + log newly-confirmed signals
  for (const coin of TRACKED_COINS) {
    for (const tf of TRACKED_TFS) {
      try {
        const candles = await fetchOHLCV(coin, tf, 500);
        /* TOO FEW CANDLES IS UNKNOWN, NOT 'NO SIGNAL' (#1651): a venue that answers with an empty or short list used to fall through here exactly like a market with nothing to report, so the health row read healthy. It is counted as a failure of the pass for that coin/timeframe. */
        if (candles.length < 60) { errors.push(`${coin}/${tf}: only ${candles.length} candles, no read`); continue; }
        const { signalLongs, signalShorts } = detectEMASignals(candles, tf, DEFAULT_FILTER_PARAMS);
        const latest = [...signalLongs, ...signalShorts].sort((a, b) => b.timestamp - a.timestamp)[0];
        if (!latest) continue;

        // Skip stale history - only log if the confirmation happened recently (within
        // ~2 candles), so the first-ever run doesn't backfill the whole fetched window.
        if (Date.now() - latest.timestamp > TF_MS[tf] * 2) continue;

        const { error } = await admin.from(T.live_signals).insert({
          coin, tf, dir: latest.dir,
          entry_price: latest.entryPrice, sl: latest.sl, tp: latest.tp,
          signal_time: new Date(latest.timestamp).toISOString(),
          anti_chop_enabled: true,
        });
        // The (coin,tf,dir,signal_time) unique constraint rejects re-detection of the
        // same signal on a later run - that's expected, not an error worth surfacing.
        if (!error) logged.push(`${coin}/${tf}/${latest.dir}`);
      } catch (err) {
        errors.push(`${coin}/${tf}: ${String(err)}`);
      }
    }
  }

  // 2. Resolve open signals against current price action
  const { data: openSignals, error: openErr } = await admin
    .from(T.live_signals)
    .select('id, coin, tf, dir, entry_price, sl, tp, signal_time')
    .eq('outcome', 'open');
  // A failed read of the open signals is not 'no open signals' either: nothing was resolved because nothing could be read.
  if (openErr) errors.push(`open signals: ${healthError(openErr.message)}`);

  // Each signal resolves independently (different coin/tf/id) - run them
  // concurrently instead of one sequential DB round-trip after another.
  await Promise.all(((openSignals ?? []) as OpenRow[]).map(async sig => {
    try {
      const candles = await fetchOHLCV(sig.coin as CoinId, sig.tf, 500);
      const sinceTime = new Date(sig.signal_time).getTime();
      const forward = candles.filter(c => c.time > sinceTime);

      for (const c of forward) {
        const hitSL = sig.dir === 'long' ? c.low <= sig.sl : c.high >= sig.sl;
        const hitTP = sig.dir === 'long' ? c.high >= sig.tp : c.low <= sig.tp;
        // Conservative same-candle tie-break, same rule as the backtest engine.
        if (hitSL) {
          await admin.from(T.live_signals).update({
            outcome: 'loss', exit_price: sig.sl, exit_time: new Date(c.time).toISOString(), r_multiple: -1,
          }).eq('id', sig.id);
          resolved.push(`${sig.coin}/${sig.tf} LOSS`);
          break;
        }
        if (hitTP) {
          const riskDist   = Math.abs(sig.entry_price - sig.sl);
          const rewardDist = Math.abs(sig.tp - sig.entry_price);
          const r = riskDist > 0 ? rewardDist / riskDist : 0;
          await admin.from(T.live_signals).update({
            outcome: 'win', exit_price: sig.tp, exit_time: new Date(c.time).toISOString(), r_multiple: r,
          }).eq('id', sig.id);
          resolved.push(`${sig.coin}/${sig.tf} WIN`);
          break;
        }
      }
    } catch (err) {
      errors.push(`resolve #${sig.id}: ${String(err)}`);
    }
  }));

  /* THE PASS REPORTED NOTHING, SO AN OUTAGE HERE WAS INVISIBLE. Every failure above is swallowed into
   * `errors` and the route answers `ok: true` either way, so a run where all 16 coin/timeframe fetches
   * failed and a run that worked perfectly are the same 200 to the scheduler. /ops had no row for this
   * route to show otherwise.
   *
   * ONE report per pass, not per coin: 8 coins x 2 timeframes plus the resolve leg would be up to 16
   * writes an hour for one logical outcome, which is the waste lib/apiHealth's own coalescing comment
   * was written about. `ok` is false on ANY error rather than only on a total failure - a partial
   * outage that silently stops logging half the coins is exactly what this is for, and shouldWrite's
   * throttle already bounds how often that can write.
   *
   * The HTTP body is deliberately unchanged: it already returns `errors`, and flipping its status
   * would change what the external scheduler (cron-job.org, see docs/INFRASTRUCTURE.md) alerts on. */
  reportHealth(
    'signals-track', 'market', errors.length === 0,
    errors.length === 0
      ? `${logged.length} logged, ${resolved.length} resolved`
      : `${errors.length} failed - ${healthError(errors[0])}`,
    logged.length + resolved.length,
  );

  return { logged, resolved, errors };
}

export async function GET(req: Request) {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Safety net - never exceed Render's 30s request limit, same pattern as the
  // Telegram alert route.
  let timerId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<NextResponse>(res => {
    timerId = setTimeout(() => {
      // A pass cut off at the ceiling is an unknown pass, not a clean one: say so on /ops (the HTTP body stays as it was for the scheduler).
      reportHealth('signals-track', 'market', false, 'pass hit the 28 s ceiling, some checks skipped');
      res(NextResponse.json({ ok: true, note: 'timeout - some checks skipped' }));
    }, 28_000);
  });
  const result = await Promise.race([runTracking(), timeout]);
  clearTimeout(timerId!);
  if ('logged' in result) return NextResponse.json({ ok: true, ...result });
  return result;
}
