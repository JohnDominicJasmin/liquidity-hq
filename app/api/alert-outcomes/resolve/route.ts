import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { BINANCE_SYMS, BYBIT_SYMS, bybitPriceFactor } from '@/lib/coins';
import { checkCronAuth } from '@/lib/cronAuth';

export const dynamic = 'force-dynamic';

// Resolves lhq_alert_fires outcomes at +24h and +48h: signed % move from
// price_at_fire to the current price, positive = favorable relative to dir.
// Same two-phase (log-then-resolve-later) shape as app/api/signals/track,
// just against wall-clock windows instead of SL/TP hits - most Telegram
// alerts (squeeze, RSI, whale, distribution, EMA cross) aren't structured
// trade calls with explicit levels, so "outcome" is defined as the honest
// price move by a fixed time, misses included.

interface FireRow { id: number; coin: string; dir: 'long' | 'short'; price_at_fire: number }

async function fetchCurrentPrices(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const [bnR, bbR] = await Promise.allSettled([
    fetch('https://api.binance.com/api/v3/ticker/price', { cache: 'no-store', signal: AbortSignal.timeout(8_000) }),
    fetch('https://api.bybit.com/v5/market/tickers?category=linear', { cache: 'no-store', signal: AbortSignal.timeout(8_000) }),
  ]);
  if (bnR.status === 'fulfilled' && bnR.value.ok) {
    const data = await bnR.value.json() as Array<{ symbol: string; price: string }>;
    for (const item of data) {
      const coin = Object.entries(BINANCE_SYMS).find(([, s]) => s === item.symbol)?.[0];
      if (coin) out[coin] = parseFloat(item.price);
    }
  }
  if (bbR.status === 'fulfilled' && bbR.value.ok) {
    const data = await bbR.value.json() as { result?: { list?: Array<{ symbol: string; lastPrice: string }> } };
    for (const item of data.result?.list ?? []) {
      const coin = Object.entries(BYBIT_SYMS).find(([, s]) => s === item.symbol)?.[0];
      // bybitPriceFactor, not the raw lastPrice. 1000PEPEUSDT/1000BONKUSDT quote
      // per 1000 tokens, while price_at_fire is stored per token - so without
      // this the outcome maths compared two different units and produced
      // ±100,000% moves on those two coins.
      if (coin && out[coin] == null && item.lastPrice) {
        out[coin] = parseFloat(item.lastPrice) * bybitPriceFactor(coin);
      }
    }
  }
  return out;
}

function outcomePct(dir: 'long' | 'short', entry: number, current: number): number {
  const raw = (current - entry) / entry * 100;
  return dir === 'long' ? raw : -raw;
}

// The two Supabase projects each hold their own copy of this function, named the
// same way the tables are (lib/tables.ts) - same pattern as lib/apiHealth.ts.
const RESOLVE_FN = process.env.NEXT_PUBLIC_APP_ENV === 'dev'
  ? 'lhq_dev_resolve_alert_outcomes'
  : 'lhq_resolve_alert_outcomes';

interface WindowResult { resolved: number; error?: string }

async function resolveWindow(hours: 24 | 48, prices: Record<string, number>): Promise<WindowResult> {
  const admin    = getSupabaseAdmin();
  const resCol   = hours === 24 ? 'resolved_24h'    : 'resolved_48h';
  const cutoff   = new Date(Date.now() - hours * 3_600_000).toISOString();

  const { data: rows } = await admin
    .from(T.alert_fires)
    .select('id, coin, dir, price_at_fire')
    .eq(resCol, false)
    .lte('fired_at', cutoff)
    .limit(200);

  const updates: Array<{ id: number; price: number; pct: number }> = [];
  for (const row of (rows ?? []) as FireRow[]) {
    const current = prices[row.coin];
    if (current == null) continue; // no live price this run - retried on the next cron tick
    updates.push({ id: row.id, price: current, pct: outcomePct(row.dir, row.price_at_fire, current) });
  }
  if (updates.length === 0) return { resolved: 0 };

  // #1282: ONE round trip per window. This used to be a PATCH per row, awaited
  // in a loop - up to 200 sequential writes per window, the two windows side by
  // side, which is where the hourly multi-second stalls came from. Each row
  // carries its own price and outcome, so a bulk PATCH (one payload per filter)
  // cannot express it; the RPC is an UPDATE ... FROM over the array, guarded
  // with `not resolved_Nh` so an overlapping or retried run cannot overwrite an
  // outcome that is already resolved. See 20260919a_resolve_alert_outcomes_batch.sql.
  //
  // A failure is LOGGED and RETURNED, not swallowed: the loop this replaces
  // ignored every update error and counted the row as resolved anyway. On error
  // no row is counted, all of them stay unresolved, and the next tick retries.
  const { data, error } = await admin.rpc(RESOLVE_FN, { p_hours: hours, p_rows: updates });
  if (error) {
    console.error(`[alert-outcomes/resolve] ${hours}h batch update failed (${RESOLVE_FN}):`, error.message);
    return { resolved: 0, error: `${hours}h: ${error.message}` };
  }
  // The function returns the rows it actually resolved (rows already resolved
  // by an overlapping run are skipped by its guard, so this can be < updates.length).
  return { resolved: typeof data === 'number' ? data : 0 };
}

async function runResolve(): Promise<{ resolved24h: number; resolved48h: number; errors: string[] }> {
  const prices = await fetchCurrentPrices();
  const [w24, w48] = await Promise.all([
    resolveWindow(24, prices),
    resolveWindow(48, prices),
  ]);
  const errors = [w24.error, w48.error].filter((e): e is string => !!e);
  return { resolved24h: w24.resolved, resolved48h: w48.resolved, errors };
}

export async function GET(req: Request) {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Same 28s safety net as the other cron routes - never exceed Render's 30s limit.
  let timerId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<NextResponse>(res => {
    timerId = setTimeout(() => res(NextResponse.json({ ok: true, note: 'timeout - some rows skipped, retried next run' })), 28_000);
  });
  const result = await Promise.race([runResolve(), timeout]);
  clearTimeout(timerId!);
  // A failed window returns 500, not 200. The loop this replaced ignored every
  // update error and answered ok:true regardless, so a resolver that had stopped
  // resolving looked exactly like a healthy one - "unknown reads as fine". With a
  // 5xx the hourly n8n workflow's execution (docs/INFRASTRUCTURE.md) shows the
  // failure. The body still carries `ok: false` and `errors`, and the counts of
  // whatever did resolve (a window that succeeded is not rolled back; the failed
  // one's rows stay unresolved and the next tick retries them).
  if ('resolved24h' in result) {
    const { errors, ...counts } = result;
    return NextResponse.json(
      { ok: errors.length === 0, ...counts, ...(errors.length ? { errors } : {}) },
      { status: errors.length ? 500 : 200 },
    );
  }
  return result;
}
