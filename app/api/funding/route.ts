import { NextResponse } from 'next/server';
import { COINS, BINANCE_SYMS, BYBIT_SYMS } from '@/lib/coins';

export const dynamic = 'force-dynamic';

interface BNTicker { symbol: string; lastFundingRate: string; nextFundingTime: number }
interface BBTicker { symbol: string; fundingRate: string }

async function getBinance(): Promise<{ rates: Record<string, number>; nextMs: Record<string, number> }> {
  const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const data = await res.json() as BNTicker[];
  const rates: Record<string, number> = {};
  const nextMs: Record<string, number> = {};
  for (const item of data) {
    const coin = Object.entries(BINANCE_SYMS).find(([, sym]) => sym === item.symbol)?.[0];
    if (coin) {
      rates[coin] = parseFloat(item.lastFundingRate);
      nextMs[coin] = item.nextFundingTime;
    }
  }
  return { rates, nextMs };
}

async function getBybit(): Promise<Record<string, number>> {
  const res = await fetch('https://api.bybit.com/v5/market/tickers?category=linear', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Bybit ${res.status}`);
  const data = await res.json() as { result?: { list?: BBTicker[] } };
  const rates: Record<string, number> = {};
  for (const item of data.result?.list ?? []) {
    const coin = Object.entries(BYBIT_SYMS).find(([, sym]) => sym === item.symbol)?.[0];
    if (coin && item.fundingRate) rates[coin] = parseFloat(item.fundingRate);
  }
  return rates;
}

export async function GET() {
  try {
    const [bnResult, bbResult] = await Promise.allSettled([getBinance(), getBybit()]);

    const bn = bnResult.status === 'fulfilled' ? bnResult.value : { rates: {}, nextMs: {} };
    const bb = bbResult.status === 'fulfilled' ? bbResult.value : {};

    const data = COINS.map(coin => ({
      coin,
      binance: bn.rates[coin] ?? null,
      bybit:   bb[coin]       ?? null,
      nextFundingMs: bn.nextMs[coin] ?? null,
    }));

    return NextResponse.json({ data, ts: Date.now() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
