import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { CoinId, BINANCE_SYMS, BYBIT_SYMS } from '@/lib/coins';
import { detectEMASignals, DEFAULT_FILTER_PARAMS, OHLCV } from '@/lib/strategyCore';

export const dynamic = 'force-dynamic';

// Live outcome tracking — majors only, 1h + 4h, using the default (raw signal) filter
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
  const r = await fetch(
    `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`,
    { signal: AbortSignal.timeout(12_000) },
  );
  if (!r.ok) throw new Error(`Binance klines ${r.status}`);
  const raw = await r.json() as (string | number)[][];
  return raw.map(k => ({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
}

async function fetchBybitKlines(sym: string, interval: string, limit: number): Promise<OHLCV[]> {
  const r = await fetch(
    `https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=${interval}&limit=${limit}`,
    { signal: AbortSignal.timeout(12_000) },
  );
  if (!r.ok) throw new Error(`Bybit klines ${r.status}`);
  const d = await r.json() as { result?: { list?: string[][] } };
  const list = [...(d?.result?.list ?? [])].reverse();
  return list.map(k => ({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
}

async function fetchOHLCV(coin: CoinId, tf: string, limit: number): Promise<OHLCV[]> {
  const bnSym = BINANCE_SYMS[coin];
  const bySym = BYBIT_SYMS[coin];
  if (bnSym) return fetchBinanceFuturesKlines(bnSym, TF_BN[tf], limit);
  if (bySym) return fetchBybitKlines(bySym, TF_BY[tf], limit);
  throw new Error(`No symbol for ${coin}`);
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
        if (candles.length < 60) continue;
        const { signalLongs, signalShorts } = detectEMASignals(candles, tf, DEFAULT_FILTER_PARAMS);
        const latest = [...signalLongs, ...signalShorts].sort((a, b) => b.timestamp - a.timestamp)[0];
        if (!latest) continue;

        // Skip stale history — only log if the confirmation happened recently (within
        // ~2 candles), so the first-ever run doesn't backfill the whole fetched window.
        if (Date.now() - latest.timestamp > TF_MS[tf] * 2) continue;

        const { error } = await admin.from(T.live_signals).insert({
          coin, tf, dir: latest.dir,
          entry_price: latest.entryPrice, sl: latest.sl, tp: latest.tp,
          signal_time: new Date(latest.timestamp).toISOString(),
          anti_chop_enabled: true,
        });
        // The (coin,tf,dir,signal_time) unique constraint rejects re-detection of the
        // same signal on a later run — that's expected, not an error worth surfacing.
        if (!error) logged.push(`${coin}/${tf}/${latest.dir}`);
      } catch (err) {
        errors.push(`${coin}/${tf}: ${String(err)}`);
      }
    }
  }

  // 2. Resolve open signals against current price action
  const { data: openSignals } = await admin
    .from(T.live_signals)
    .select('id, coin, tf, dir, entry_price, sl, tp, signal_time')
    .eq('outcome', 'open');

  // Each signal resolves independently (different coin/tf/id) — run them
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

  return { logged, resolved, errors };
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('x-cron-secret') ?? new URL(req.url).searchParams.get('secret');
    if (auth !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Safety net — never exceed Render's 30s request limit, same pattern as the
  // Telegram alert route.
  let timerId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<NextResponse>(res => {
    timerId = setTimeout(() => res(NextResponse.json({ ok: true, note: 'timeout — some checks skipped' })), 28_000);
  });
  const result = await Promise.race([runTracking(), timeout]);
  clearTimeout(timerId!);
  if ('logged' in result) return NextResponse.json({ ok: true, ...result });
  return result;
}
