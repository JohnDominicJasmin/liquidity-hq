import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { COINS, BINANCE_SYMS, BYBIT_SYMS } from '@/lib/coins';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { cached } from '@/lib/apiCache';

export const dynamic = 'force-dynamic';
// Funding rates settle every 8h - a 20s cache collapses concurrent visitor
// fan-out into one upstream call without making the data noticeably stale.
const CACHE_TTL = 20_000;

interface BNTicker { symbol: string; lastFundingRate: string; nextFundingTime: number }
interface BBTicker { symbol: string; fundingRate: string; nextFundingTime: string }

const BN_HOSTS = [
  'https://fapi.binance.com',
  'https://fapi1.binance.com',
  'https://fapi2.binance.com',
];

async function getBinance(): Promise<{ rates: Record<string, number>; nextMs: Record<string, number> }> {
  for (const host of BN_HOSTS) {
    try {
      const ac  = new AbortController();
      const tid = setTimeout(() => ac.abort(), 6000);
      const res = await fetch(`${host}/fapi/v1/premiumIndex`, {
        cache: 'no-store',
        signal: ac.signal,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      clearTimeout(tid);
      if (!res.ok) continue;
      const data = await res.json() as BNTicker[];
      if (!Array.isArray(data) || data.length === 0) continue;
      const rates: Record<string, number> = {};
      const nextMs: Record<string, number> = {};
      for (const item of data) {
        const coin = Object.entries(BINANCE_SYMS).find(([, sym]) => sym === item.symbol)?.[0];
        if (coin) {
          rates[coin]  = parseFloat(item.lastFundingRate);
          nextMs[coin] = item.nextFundingTime;
        }
      }
      return { rates, nextMs };
    } catch { continue; }
  }
  return { rates: {}, nextMs: {} };
}

async function getBybit(): Promise<{ rates: Record<string, number>; nextMs: Record<string, number> }> {
  const res = await fetch('https://api.bybit.com/v5/market/tickers?category=linear', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Bybit ${res.status}`);
  const data = await res.json() as { result?: { list?: BBTicker[] } };
  const rates: Record<string, number> = {};
  const nextMs: Record<string, number> = {};
  for (const item of data.result?.list ?? []) {
    const coin = Object.entries(BYBIT_SYMS).find(([, sym]) => sym === item.symbol)?.[0];
    if (coin) {
      if (item.fundingRate)     rates[coin]  = parseFloat(item.fundingRate);
      if (item.nextFundingTime) nextMs[coin] = parseInt(item.nextFundingTime);
    }
  }
  return { rates, nextMs };
}

export async function GET(req: NextRequest) {
  if (!rateLimit(`funding:${getClientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }
  try {
    const result = await cached('funding', CACHE_TTL, async () => {
      const [bnResult, bbResult] = await Promise.allSettled([getBinance(), getBybit()]);

      const bn = bnResult.status === 'fulfilled' ? bnResult.value : { rates: {}, nextMs: {} };
      const bb = bbResult.status === 'fulfilled' ? bbResult.value : { rates: {}, nextMs: {} };

      const data = COINS.map(coin => ({
        coin,
        binance:       bn.rates[coin] ?? null,
        bybit:         bb.rates[coin] ?? null,
        nextFundingMs: bn.nextMs[coin] ?? bb.nextMs[coin] ?? null,
      }));

      return { data, ts: Date.now() };
    });
    return NextResponse.json(result);
  } catch (err) {
    return apiError('funding', err, 500, 'Request failed');
  }
}
