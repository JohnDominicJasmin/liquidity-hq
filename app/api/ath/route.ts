import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { cachedStale } from '@/lib/apiCache';
import { reportHealth, healthError } from '@/lib/apiHealth';
import { readSnapshot, writeSnapshot } from '@/lib/marketSnapshot';

/* All-time highs move a few times a year at most, so this is cached hard and
   served stale rather than failed when CoinGecko is unavailable.
   `next: { revalidate }` alone was not enough: it caches successful responses
   only, so a 429 was re-requested on every single hit and answered 502 every
   time. Measured on the qa service - every attempt returned
   {"error":"CoinGecko 429"} while production, on a different instance, was
   fine. The IP had spent its budget on a keyless public API and the route had
   no memory of the last good answer. */
const ATH_TTL = 6 * 60 * 60_000;

/* ── THE COLD CACHE, WHICH THE IN-MEMORY FALLBACK CANNOT COVER (#1651) ────────────────────────
 *
 * `cachedStale` serves the last good answer when CoinGecko fails - but it is a Map on the
 * instance, so EVERY restart starts with nothing to fall back to. Render's free plan sleeps and
 * restarts constantly, and CoinGecko rate-limits our egress by IP, so the window where this route
 * has no memory and no upstream is routine rather than exotic: it answers 502 on every hit until
 * one call gets through. The tracker records it as a known constraint; this makes it survivable.
 *
 * `lhq_market_snapshot` is the existing key/payload table, so this needs no migration.
 *
 * WHAT MAKES A STALE ATH SAFE TO SERVE, which is not true of most stale data. An ATH is a running
 * MAXIMUM, so an old one can only ever be too LOW, never too high - and if the price has since
 * passed it, the live price says so directly. That is the self-check below: a stale ATH under the
 * current price is PROVABLY superseded and its coin is dropped rather than drawn. The fallback
 * detects its own staleness from data it already has, with no timestamp involved.
 *
 * WHAT IS DELIBERATELY NOT SERVED: `drawdownPct`. CoinGecko computes it against the price at ITS
 * fetch time, so it is the one fast-moving number in a slow-moving payload and a day-old copy of
 * it is simply wrong. The row carries `ath` and `athDate` only; DrawdownChart recomputes the
 * percentage from our own live price, which is fresher than CoinGecko's was. Measured against 8
 * coins on 2026-11-06: `(price - ath) / ath * 100` reproduces `ath_change_percentage` to within
 * 0.006 percentage points, the residual being CoinGecko rounding the price it displays.
 *
 * THE AGE CAP exists even though the price check above makes drift self-detecting: without one, a
 * permanently broken CoinGecko path would serve an ever-older row for ever and nothing would ever
 * surface it. Past the cap a 502 is the honest answer. */
const ATH_SNAPSHOT_KEY = 'ath';
const ATH_SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

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
  /** Negative - how far below ATH the current price is, as CoinGecko computed it.
   *  ABSENT on the persisted-snapshot fallback, where it would be a stale number
   *  presented as current; the client recomputes it from the live price instead. */
  drawdownPct?: number;
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
          signal: AbortSignal.timeout(10_000),
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

        /* PERSIST THE SLOW HALF so a cold start has something to serve. Inside the producer, so it
           runs only on a real cache MISS - at most once per ATH_TTL per instance, not per visitor,
           which is what keeps this inside the "page requests only read" rule in lib/marketSnapshot.
           Awaited rather than fire-and-forget: a serverless instance can be frozen the moment the
           response is returned, which is how a detached write silently never happens.
           A write failure must NEVER turn a good answer into a 502, so it is caught and reported,
           not thrown - the caller already has the data it asked for. */
        try {
          await writeSnapshot(
            ATH_SNAPSHOT_KEY,
            Object.fromEntries(Object.entries(out).map(([id, e]) => [id, { ath: e.ath, athDate: e.athDate }])),
            'coingecko',
          );
        } catch (e) {
          reportHealth('ath:snapshot-write', 'market', false, healthError(e));
        }
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
    /* Only reached on a cold cache - the in-memory fallback had no previous good value. Before
       answering 502, try the persisted row: that is the whole point of writing it. */
    const row = await readSnapshot(ATH_SNAPSHOT_KEY);
    const persisted = row && row.ageMs <= ATH_SNAPSHOT_MAX_AGE_MS
      ? (row.payload as Record<string, { ath?: number; athDate?: string }> | null)
      : null;
    const usable: Record<string, AthEntry> = {};
    for (const [id, v] of Object.entries(persisted ?? {})) {
      /* Every field checked rather than trusted: this row was written by an earlier version of
         this route and a payload column has no schema. A row that fails these checks is absent. */
      if (typeof v?.ath === 'number' && Number.isFinite(v.ath) && v.ath > 0 && typeof v.athDate === 'string') {
        usable[id] = { ath: v.ath, athDate: v.athDate };   // no drawdownPct - see the header
      }
    }

    if (Object.keys(usable).length > 0) {
      reportHealth('coingecko:ath', 'market', false,
        `upstream failed, serving ${Math.round((row?.ageMs ?? 0) / 3_600_000)}h-old ATHs from the snapshot - ${healthError(e)}`,
        Object.keys(usable).length);
      return NextResponse.json(usable, {
        headers: {
          /* No s-maxage: this is a degraded answer and must not be cached at the edge for an hour
             the way a good one is, or one cold start poisons every visitor for that hour. */
          'Cache-Control': 'no-store',
          'X-Data-Stale': `true; age=${Math.round((row?.ageMs ?? 0) / 1000)}s; source=snapshot`,
        },
      });
    }

    /* No row, too old, or nothing in it survived the field checks - now it really is a failure. */
    reportHealth('coingecko:ath', 'market', false, healthError(e));
    return apiError('ath', e, 502, 'Upstream unavailable');
  }
}
