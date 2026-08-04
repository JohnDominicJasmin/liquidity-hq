import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { cachedStale } from '@/lib/apiCache';
import { reportHealth, healthError } from '@/lib/apiHealth';

/* All-time highs move a few times a year at most, so this is cached hard and
   served stale rather than failed when CoinGecko is unavailable.
   `next: { revalidate }` alone was not enough: it caches successful responses
   only, so a 429 was re-requested on every single hit and answered 502 every
   time. Measured on the qa service - every attempt returned
   {"error":"CoinGecko 429"} while production, on a different instance, was
   fine. The IP had spent its budget on a keyless public API and the route had
   no memory of the last good answer. */
const ATH_TTL = 6 * 60 * 60_000;

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
  drawdownPct: number; // negative - how far below ATH current price is
}

export async function GET(req: NextRequest) {
  if (!rateLimit(`ath:${getClientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }
  const ids = Object.values(CG_IDS).join(',');
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&per_page=50&sparkline=false`;

  try {
    const { data: result, stale, ageMs } = await cachedStale<Record<string, AthEntry>>(
      'ath', ATH_TTL, async () => {
        const r = await fetch(url, {
          cache: 'no-store',   // cachedStale owns the caching now
          headers: { 'Accept': 'application/json' },
        });
        if (!r.ok) throw new Error(`CoinGecko ${r.status}`);

        const data: Array<{
          id: string;
          ath: number;
          ath_date: string;
          ath_change_percentage: number;
        }> = await r.json();

        const cgToOur = Object.fromEntries(
          Object.entries(CG_IDS).map(([ours, cg]) => [cg, ours])
        );

        const out: Record<string, AthEntry> = {};
        for (const coin of data) {
          const ourId = cgToOur[coin.id];
          if (ourId && coin.ath != null) {
            out[ourId] = {
              ath: coin.ath,
              athDate: coin.ath_date,
              drawdownPct: coin.ath_change_percentage,
            };
          }
        }
        /* An empty object would otherwise be cached as a perfectly good answer
           and served for six hours. CoinGecko returning 200 with nothing usable
           is a failure wearing a success's clothes. */
        if (Object.keys(out).length === 0) throw new Error('CoinGecko returned no usable rows');
        return out;
      },
    );

    reportHealth('coingecko:ath', 'market', !stale,
      stale ? `serving ${Math.round(ageMs / 60_000)}min-old data - upstream failing`
            : `${Object.keys(result).length} coins`,
      Object.keys(result).length);

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        /* Debug-only. The body shape is unchanged so nothing downstream has to
           care, but "is this stale?" is the first question when a number looks
           wrong, and it should not require reading server logs to answer. */
        'X-Data-Stale': stale ? `true; age=${Math.round(ageMs / 1000)}s` : 'false',
      },
    });
  } catch (e) {
    /* Only reached on a cold cache - no previous good value exists to fall
       back to, so this really is a failure. */
    reportHealth('coingecko:ath', 'market', false, healthError(e));
    return apiError('ath', e, 502, 'Upstream unavailable');
  }
}
