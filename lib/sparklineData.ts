'use client';
import { BINANCE_SYMS, BYBIT_SYMS } from './coins';

// Real 24h hourly close series per coin — same public REST endpoints already
// used client-side by KLineProChart, just a much smaller request (24 candles).
// Cached at module scope so every consumer (sidebar, watchlist) shares one fetch.

interface Cached { points: number[]; ts: number }
const cache = new Map<string, Cached>();
const inFlight = new Map<string, Promise<number[]>>();
const REFRESH_MS = 5 * 60_000;

async function fetchKlines(coin: string): Promise<number[]> {
  const bnSym = BINANCE_SYMS[coin];
  const bbSym = BYBIT_SYMS[coin];
  try {
    if (bnSym) {
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${bnSym}&interval=1h&limit=24`, { cache: 'no-store' });
      if (res.ok) {
        const raw = await res.json() as unknown[][];
        const closes = raw.map(k => parseFloat(k[4] as string)).filter(n => isFinite(n));
        if (closes.length >= 2) return closes;
      }
    }
    if (bbSym) {
      const res = await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${bbSym}&interval=60&limit=24`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json() as { result?: { list?: string[][] } };
        const list = data.result?.list ?? [];
        const closes = list.map(k => parseFloat(k[4])).reverse().filter(n => isFinite(n));
        if (closes.length >= 2) return closes;
      }
    }
  } catch { /* network hiccup — keep stale cache, try again next refresh */ }
  return [];
}

export function getSparkline24h(coin: string): number[] {
  return cache.get(coin)?.points ?? [];
}

/** Returns fresh points, fetching only if the cache is missing or stale. */
export async function ensureSparkline24h(coin: string): Promise<number[]> {
  const cached = cache.get(coin);
  if (cached && Date.now() - cached.ts < REFRESH_MS) return cached.points;

  const existing = inFlight.get(coin);
  if (existing) return existing;

  const p = fetchKlines(coin).then(points => {
    inFlight.delete(coin);
    if (points.length) cache.set(coin, { points, ts: Date.now() });
    return points.length ? points : (cache.get(coin)?.points ?? []);
  });
  inFlight.set(coin, p);
  return p;
}
