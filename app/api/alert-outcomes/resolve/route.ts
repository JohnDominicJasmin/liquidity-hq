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

async function resolveWindow(hours: 24 | 48, prices: Record<string, number>): Promise<number> {
  const admin    = getSupabaseAdmin();
  const resCol   = hours === 24 ? 'resolved_24h'    : 'resolved_48h';
  const priceCol = hours === 24 ? 'price_24h'        : 'price_48h';
  const pctCol   = hours === 24 ? 'outcome_pct_24h'  : 'outcome_pct_48h';
  const cutoff   = new Date(Date.now() - hours * 3_600_000).toISOString();

  const { data: rows } = await admin
    .from(T.alert_fires)
    .select('id, coin, dir, price_at_fire')
    .eq(resCol, false)
    .lte('fired_at', cutoff)
    .limit(200);

  let resolved = 0;
  for (const row of (rows ?? []) as FireRow[]) {
    const current = prices[row.coin];
    if (current == null) continue; // no live price this run - retried on the next cron tick
    const pct = outcomePct(row.dir, row.price_at_fire, current);
    await admin.from(T.alert_fires).update({ [priceCol]: current, [pctCol]: pct, [resCol]: true }).eq('id', row.id);
    resolved++;
  }
  return resolved;
}

async function runResolve(): Promise<{ resolved24h: number; resolved48h: number }> {
  const prices = await fetchCurrentPrices();
  const [resolved24h, resolved48h] = await Promise.all([
    resolveWindow(24, prices),
    resolveWindow(48, prices),
  ]);
  return { resolved24h, resolved48h };
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
  if ('resolved24h' in result) return NextResponse.json({ ok: true, ...result });
  return result;
}
