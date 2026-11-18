import { BINANCE_SYMS } from '../coins.ts';
import type { StrategyContext } from './types.ts';

/* THE LIVE INPUTS THE PHASE-2 STRATEGIES NEED (client side), read the way the rest of the app reads them. A value that cannot be read comes back undefined / null, which the strategies treat as NOT KNOWN (their own "needs live data" / "needs taker data" wait), never as zero. */

/** The Funding page's "paying heavily" class from a funding rate (a fraction, 0.0005 = 0.05%): longs_heavy at +0.05% or more, shorts_heavy at -0.03% or less, else none. Same bands as lib/marketStore.ts classifyFunding. */
export function fundingClassOf(rate: number | null | undefined): { fundingClass: 'longs_heavy' | 'shorts_heavy' | 'none'; fundingPct: number } | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  const pct = rate * 100;
  return { fundingClass: pct >= 0.05 ? 'longs_heavy' : pct <= -0.03 ? 'shorts_heavy' : 'none', fundingPct: Math.round(pct * 10000) / 10000 };
}

/** Open interest change over the last 6 candles, in percent, from Binance's openInterestHist rows (oldest first): newest against the one 6 rows earlier. Null when there are fewer than 7 rows or the rows are not spaced one candle apart (a different source answered at another interval). */
export function oiChange6(rows: ReadonlyArray<{ sumOpenInterest?: string | number; timestamp?: number }>, tfMs: number): number | null {
  if (!Array.isArray(rows) || rows.length < 7) return null;
  const last7 = rows.slice(-7);
  const t0 = Number(last7[0].timestamp), t6 = Number(last7[6].timestamp);
  if (Number.isFinite(t0) && Number.isFinite(t6) && Math.abs((t6 - t0) / 6 - tfMs) > tfMs * 0.1) return null;
  const a = Number(last7[0].sumOpenInterest), b = Number(last7[6].sumOpenInterest);
  if (!(a > 0) || !Number.isFinite(b)) return null;
  return Math.round(((b / a - 1) * 100) * 100) / 100;
}

export async function fetchOiChange6(coin: string, tf: string, tfMs: number, signal?: AbortSignal): Promise<number | null> {
  const sym = (BINANCE_SYMS as Record<string, string | undefined>)[coin];
  if (!sym) return null;
  const r = await fetch(`/api/proxy?type=oi-hist&symbol=${sym}&period=${tf}&limit=7`, { signal });
  if (!r.ok) return null;
  return oiChange6((await r.json()) as never, tfMs);
}

/** Taker buy / sell volume by candle open time, from Binance futures klines (index 9 is the taker buy base volume). Undefined for a coin Binance does not list. */
export async function fetchTakerMap(coin: string, bnInterval: string, limit: number, signal?: AbortSignal): Promise<StrategyContext['taker']> {
  const sym = (BINANCE_SYMS as Record<string, string | undefined>)[coin];
  if (!sym) return undefined;
  const r = await fetch(`/api/market/klines?source=binance-futures&symbol=${sym}&interval=${bnInterval}&limit=${limit}&closed=1`, { signal });
  if (!r.ok) return undefined;
  const raw = (await r.json()) as (string | number)[][];
  if (!Array.isArray(raw)) return undefined;
  const m = new Map<number, { buy: number; sell: number }>();
  for (const k of raw) {
    const vol = +k[5], buy = +k[9];
    if (Number.isFinite(vol) && Number.isFinite(buy)) m.set(+k[0], { buy, sell: vol - buy });
  }
  return m.size ? m : undefined;
}
