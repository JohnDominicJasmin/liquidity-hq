import { BINANCE_SYMS, BYBIT_SYMS } from '../coins.ts';
import type { StrategyContext } from './types.ts';

/* THE LIVE INPUTS THE PHASE-2 STRATEGIES NEED (client side), read the way the rest of the app reads them. A value that cannot be read comes back undefined / null, which the strategies treat as NOT KNOWN (their own "needs live data" / "needs taker data" wait), never as zero. */

/** The Funding page's "paying heavily" class from a funding rate (a fraction, 0.0005 = 0.05%): longs_heavy at +0.05% or more, shorts_heavy at -0.03% or less, else none. Same bands as lib/marketStore.ts classifyFunding. */
export function fundingClassOf(rate: number | null | undefined): { fundingClass: 'longs_heavy' | 'shorts_heavy' | 'none'; fundingPct: number } | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  const pct = rate * 100;
  return { fundingClass: pct >= 0.05 ? 'longs_heavy' : pct <= -0.03 ? 'shorts_heavy' : 'none', fundingPct: Math.round(pct * 10000) / 10000 };
}

/* FUNDING "PAYING HEAVILY" JUDGED AGAINST THE COIN'S OWN HISTORY (PM, 2026-11-19). The fixed bands above never fired in a calm month (BTC / ETH / SOL funding stayed between -0.015% and +0.010% for 30 days), so the squeeze strategy used a bar the market never reached. It is relative now:
   HISTORY       the coin's settled funding rates of the last FUNDING_WINDOW_DAYS days (fractions, 0.0001 = 0.01%), the live rate itself not included.
   LONGS HEAVY   the live rate is above zero AND at least 95% of the history's settlements were strictly lower than it (it is in the top 5% of the coin's own 90 days).
   SHORTS HEAVY  the live rate is below zero AND at least 95% of the history's settlements were strictly higher than it (the bottom 5%).
   Strictly, so a coin whose funding sits at the exchange baseline for weeks (a tie) is never "heavy" just for equalling its own top value.
   NO READING (null) when the history is missing, has fewer than FUNDING_MIN_POINTS settlements, or does not reach back FUNDING_MIN_SPAN_DAYS days. Never a guess. */
export const FUNDING_WINDOW_DAYS = 90;
export const FUNDING_EXTREME_SHARE = 0.95;
export const FUNDING_MIN_POINTS = 60;
export const FUNDING_MIN_SPAN_DAYS = 45;
export interface FundingPoint { time: number; rate: number }

export function fundingClassRelative(rate: number | null | undefined, history: readonly FundingPoint[] | null | undefined, nowMs: number): { fundingClass: 'longs_heavy' | 'shorts_heavy' | 'none'; fundingPct: number } | null {
  if (rate == null || !Number.isFinite(rate) || !Array.isArray(history)) return null;
  const day = 86_400_000;
  const pts = history.filter(p => Number.isFinite(p.rate) && Number.isFinite(p.time) && p.time >= nowMs - FUNDING_WINDOW_DAYS * day && p.time <= nowMs);
  if (pts.length < FUNDING_MIN_POINTS) return null;
  if (nowMs - Math.min(...pts.map(p => p.time)) < FUNDING_MIN_SPAN_DAYS * day) return null;
  const below = pts.filter(p => p.rate < rate).length / pts.length;
  const above = pts.filter(p => p.rate > rate).length / pts.length;
  const fundingClass = rate > 0 && below >= FUNDING_EXTREME_SHARE ? 'longs_heavy' : rate < 0 && above >= FUNDING_EXTREME_SHARE ? 'shorts_heavy' : 'none';
  return { fundingClass, fundingPct: Math.round(rate * 100 * 10000) / 10000 };
}

/** Settled funding rates from Binance futures (/fapi/v1/fundingRate: oldest first, `fundingTime` ms, `fundingRate` string). Rows that do not parse are dropped. */
export function parseBinanceFunding(body: unknown): FundingPoint[] {
  if (!Array.isArray(body)) return [];
  return (body as Array<{ fundingTime?: number | string; fundingRate?: string | number }>)
    .map(r => ({ time: Number(r?.fundingTime), rate: Number(r?.fundingRate) })).filter(p => Number.isFinite(p.time) && Number.isFinite(p.rate));
}
/** Settled funding rates from Bybit (/v5/market/funding/history: newest first, `fundingRateTimestamp` ms string). */
export function parseBybitFunding(body: unknown): FundingPoint[] {
  const list = (body as { result?: { list?: Array<{ fundingRate?: string; fundingRateTimestamp?: string }> } } | null)?.result?.list;
  if (!Array.isArray(list)) return [];
  return list.map(r => ({ time: Number(r?.fundingRateTimestamp), rate: Number(r?.fundingRate) })).filter(p => Number.isFinite(p.time) && Number.isFinite(p.rate));
}

/** The coin's recent settled funding rates through the app's own cached proxy (15 min cache, one request per coin): Binance futures, newest 300 settlements (100 days at 8 h), else Bybit, newest 200 (67 days). Null when neither answers: the strategy then says it has no reading. */
export async function fetchFundingHistory(coin: string, signal?: AbortSignal): Promise<FundingPoint[] | null> {
  const bn = (BINANCE_SYMS as Record<string, string | undefined>)[coin];
  const by = (BYBIT_SYMS as Record<string, string | undefined>)[coin];
  const tries: Array<{ url: string; parse: (b: unknown) => FundingPoint[] }> = [];
  if (bn) tries.push({ url: `/api/proxy?type=funding-rate-1&symbol=${bn}&limit=300`, parse: parseBinanceFunding });
  if (by) tries.push({ url: `/api/proxy?type=funding-history&symbol=${by}&limit=200`, parse: parseBybitFunding });
  for (const t of tries) {
    try {
      const r = await fetch(t.url, { signal });
      if (!r.ok) continue;
      const pts = t.parse(await r.json());
      if (pts.length) return pts;
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') throw e;
    }
  }
  return null;
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
