import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const COINS = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'hype', 'near', 'zec'] as const;

const BN_MAP: Record<string, string> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT', xrp: 'XRPUSDT',
  bnb: 'BNBUSDT', hype: 'HYPEUSDT', near: 'NEARUSDT', zec: 'ZECUSDT',
};

const OKX_MAP: Record<string, string> = {
  btc: 'BTC-USDT-SWAP', eth: 'ETH-USDT-SWAP', sol: 'SOL-USDT-SWAP', xrp: 'XRP-USDT-SWAP',
  bnb: 'BNB-USDT-SWAP', hype: 'HYPE-USDT-SWAP', near: 'NEAR-USDT-SWAP', zec: 'ZEC-USDT-SWAP',
};

interface BNTicker  { symbol: string; lastFundingRate: string; nextFundingTime: number }
interface BBTicker  { symbol: string; fundingRate: string }
interface OKXResult { data: Array<{ fundingRate: string }> }

async function getBinance(): Promise<{ rates: Record<string, number>; nextMs: Record<string, number> }> {
  const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const data = await res.json() as BNTicker[];
  const rates: Record<string, number> = {};
  const nextMs: Record<string, number> = {};
  for (const item of data) {
    const coin = Object.entries(BN_MAP).find(([, sym]) => sym === item.symbol)?.[0];
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
    const coin = Object.entries(BN_MAP).find(([, sym]) => sym === item.symbol)?.[0];
    if (coin && item.fundingRate) rates[coin] = parseFloat(item.fundingRate);
  }
  return rates;
}

async function getOKXOne(coin: string): Promise<number | null> {
  try {
    const instId = OKX_MAP[coin];
    const res = await fetch(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json() as OKXResult;
    const fr = data.data?.[0]?.fundingRate;
    return fr ? parseFloat(fr) : null;
  } catch { return null; }
}

export async function GET() {
  try {
    const [bnResult, bbResult, ...okxResults] = await Promise.allSettled([
      getBinance(),
      getBybit(),
      ...COINS.map(getOKXOne),
    ]);

    const bn = bnResult.status === 'fulfilled' ? bnResult.value : { rates: {}, nextMs: {} };
    const bb = bbResult.status === 'fulfilled' ? bbResult.value : {};

    const data = COINS.map((coin, i) => {
      const okxR = okxResults[i];
      return {
        coin,
        binance: bn.rates[coin] ?? null,
        bybit:   bb[coin]       ?? null,
        okx:     okxR.status === 'fulfilled' ? okxR.value : null,
        nextFundingMs: bn.nextMs[coin] ?? null,
      };
    });

    return NextResponse.json({ data, ts: Date.now() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
