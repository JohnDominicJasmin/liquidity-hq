import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

const CG_IDS: Record<string, string> = {
  btc:  'bitcoin',
  eth:  'ethereum',
  sol:  'solana',
  xrp:  'ripple',
  bnb:  'binancecoin',
  hype: 'hyperliquid',
  near: 'near',
  sui:  'sui',
  doge: 'dogecoin',
  avax: 'avalanche-2',
  link: 'chainlink',
  ada:  'cardano',
  dot:  'polkadot',
  atom: 'cosmos',
  wif:  'dogwifcoin',
  pepe: 'pepe',
  bonk: 'bonk',
};

export interface AthEntry {
  ath: number;
  athDate: string;
  drawdownPct: number; // negative — how far below ATH current price is
}

export async function GET(req: NextRequest) {
  if (!rateLimit(`ath:${getClientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }
  const ids = Object.values(CG_IDS).join(',');
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&per_page=50&sparkline=false`;

  try {
    const r = await fetch(url, {
      next: { revalidate: 3600 },
      headers: { 'Accept': 'application/json' },
    });

    if (!r.ok) {
      return NextResponse.json({ error: `CoinGecko ${r.status}` }, { status: 502 });
    }

    const data: Array<{
      id: string;
      ath: number;
      ath_date: string;
      ath_change_percentage: number;
    }> = await r.json();

    const cgToOur = Object.fromEntries(
      Object.entries(CG_IDS).map(([ours, cg]) => [cg, ours])
    );

    const result: Record<string, AthEntry> = {};
    for (const coin of data) {
      const ourId = cgToOur[coin.id];
      if (ourId && coin.ath != null) {
        result[ourId] = {
          ath: coin.ath,
          athDate: coin.ath_date,
          drawdownPct: coin.ath_change_percentage,
        };
      }
    }

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'fetch failed' },
      { status: 500 }
    );
  }
}
