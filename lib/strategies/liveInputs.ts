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
export const FUNDING_MIN_SPAN_DAYS = 30;
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

/* THE FUNDING HISTORY IS READ BY TIME, NOT BY COUNT (PM, 2026-11-19). A coin that settles every hour has 24 settlements a day, so "the newest 300" was only 12 days of it. The history is paged back from now to FUNDING_WINDOW_DAYS
   days by start / end time (Binance futures: oldest first, up to 1000 a page; Bybit: newest first, up to 200 a page). Time cursors are not cached by the proxy, so the result is kept here per coin for FUNDING_CACHE_MS: one read per coin
   per half hour, however often the strategy runs. The caller accepts a history that reaches back FUNDING_MIN_SPAN_DAYS (30) days; a shorter one is no reading. */
const FUNDING_CACHE_MS = 30 * 60_000;
const fundingCache = new Map<string, { at: number; pts: FundingPoint[] }>();

async function pageBinanceFunding(sym: string, start: number, end: number, signal?: AbortSignal): Promise<FundingPoint[]> {
  const out: FundingPoint[] = [];
  let cursor = start;
  for (let page = 0; page < 6; page++) {
    const r = await fetch(`/api/proxy?type=funding-rate-1&symbol=${sym}&startTime=${cursor}&endTime=${end}&limit=1000`, { signal });
    if (!r.ok) break;
    const rows = parseBinanceFunding(await r.json());
    if (!rows.length) break;
    out.push(...rows);
    const last = rows[rows.length - 1].time;
    if (rows.length < 1000 || last <= cursor) break;
    cursor = last + 1;
  }
  return out;
}

async function pageBybitFunding(sym: string, start: number, end: number, signal?: AbortSignal): Promise<FundingPoint[]> {
  const out: FundingPoint[] = [];
  let upper = end;
  for (let page = 0; page < 14; page++) {
    const r = await fetch(`/api/proxy?type=funding-history&symbol=${sym}&startTime=${start}&endTime=${upper}&limit=200`, { signal });
    if (!r.ok) break;
    const rows = parseBybitFunding(await r.json());
    if (!rows.length) break;
    out.push(...rows);
    const oldest = Math.min(...rows.map(p => p.time));
    if (rows.length < 200 || oldest <= start) break;
    upper = oldest - 1;
  }
  return out.sort((a, b) => a.time - b.time);
}

/** The coin's settled funding rates of the last 90 days, paged by time through the app's proxy (Binance futures, else Bybit), cached per coin for 30 minutes. Null when neither answers. */
export async function fetchFundingHistory(coin: string, signal?: AbortSignal, nowMs: number = Date.now()): Promise<FundingPoint[] | null> {
  const hit = fundingCache.get(coin);
  if (hit && nowMs - hit.at < FUNDING_CACHE_MS) return hit.pts;
  const bn = (BINANCE_SYMS as Record<string, string | undefined>)[coin];
  const by = (BYBIT_SYMS as Record<string, string | undefined>)[coin];
  const start = nowMs - FUNDING_WINDOW_DAYS * 86_400_000;
  const tries: Array<() => Promise<FundingPoint[]>> = [];
  if (bn) tries.push(() => pageBinanceFunding(bn, start, nowMs, signal));
  if (by) tries.push(() => pageBybitFunding(by, start, nowMs, signal));
  for (const run of tries) {
    try {
      const pts = await run();
      if (pts.length) { fundingCache.set(coin, { at: nowMs, pts }); return pts; }
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

/* OPEN INTEREST "RISING" JUDGED AGAINST THE COIN'S OWN HISTORY (PM, 2026-11-19), the same logic as funding. The changes over every 6 candles in the OI history Binance serves (the newest OI_ROWS rows of this timeframe; its history reaches
   back 30 days at most) are the coin's own distribution; the live change (the newest 6 candles) is EXTREME when it is above zero AND at least 80% of the earlier changes were strictly lower (the top 20%). NO READING (null) when there are
   fewer than OI_MIN_ROWS rows or when the newest 7 rows are not one candle apart (a gap inside the live change; a gap inside an older change just leaves it out). 120 candles is 30 hours at 15 minutes and 5 days at 1 hour: the distribution is the coin's own recent one, on this timeframe. Never a guess. */
export const OI_ROWS = 500;
export const OI_MIN_ROWS = 120;
export const OI_EXTREME_SHARE = 0.8;

export function oiRelative(rows: ReadonlyArray<{ sumOpenInterest?: string | number; timestamp?: number }> | null | undefined, tfMs: number): { oiChange6Pct: number; oiExtreme: boolean } | null {
  if (!Array.isArray(rows) || rows.length < OI_MIN_ROWS) return null;
  const oi = rows.map(r => Number(r.sumOpenInterest)), ts = rows.map(r => Number(r.timestamp));
  const n = rows.length;
  if (!ts.every(Number.isFinite)) return null;
  /* A 6-candle change counts only when its 7 rows really are 6 candles apart (a missing row inside it makes it a 7-candle change). The LIVE change must be one of them, else no reading; a gap inside an OLDER change just leaves that change out of the distribution. */
  const spans = (i: number) => Math.abs((ts[i] - ts[i - 6]) - 6 * tfMs) <= 6 * tfMs * 0.1;
  if (!spans(n - 1)) return null;
  const chg: number[] = [];
  for (let i = 6; i < n; i++) if (spans(i) && oi[i - 6] > 0 && Number.isFinite(oi[i])) chg.push((oi[i] / oi[i - 6] - 1) * 100);
  const live = chg[chg.length - 1];
  const hist = chg.slice(0, -1);
  if (!Number.isFinite(live) || hist.length < OI_MIN_ROWS - 7) return null;
  const below = hist.filter(c => c < live).length / hist.length;
  return { oiChange6Pct: Math.round(live * 100) / 100, oiExtreme: live > 0 && below >= OI_EXTREME_SHARE };
}

export async function fetchOiRelative(coin: string, tf: string, tfMs: number, signal?: AbortSignal): Promise<{ oiChange6Pct: number; oiExtreme: boolean } | null> {
  const sym = (BINANCE_SYMS as Record<string, string | undefined>)[coin];
  if (!sym) return null;
  const r = await fetch(`/api/proxy?type=oi-hist&symbol=${sym}&period=${tf}&limit=${OI_ROWS}`, { signal });
  if (!r.ok) return null;
  return oiRelative((await r.json()) as never, tfMs);
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
