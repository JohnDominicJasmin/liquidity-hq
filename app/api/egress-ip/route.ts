import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cronAuth';

export const dynamic = 'force-dynamic';

/*
 * What IP does this service call the outside world from?
 *
 * #368: `binance-futures` returned 418 on `qa` AND `staging` simultaneously,
 * with no deploy and no test traffic, while the same endpoint answered 200 from
 * a laptop. Binance rate-limits by IP, so the standing hypothesis is that
 * Render's free-plan services share an egress IP and the quota is being spent
 * by traffic that is not ours.
 *
 * That hypothesis has survived two attempts to test it and both failed for the
 * same reason - no instrument:
 *
 *   compare the services' outbound IPs   Render's API does not expose it
 *   prod as a paid control               prod predates /api/market/klines, 404
 *   unban-time discriminator             polled at 60s, observed gap 60s -
 *                                        the resolution equalled the effect
 *
 * This is the instrument. Two curls answer it permanently:
 *
 *   curl https://liquidity-hq-qa.onrender.com/api/egress-ip
 *   curl https://liquidity-hq-staging.onrender.com/api/egress-ip
 *
 *   same ip  -> shared egress, and no cache tuning on our side fixes it
 *   differs  -> the hypothesis is dead and the cause is ours after all
 *
 * SCHEDULER SECRET ONLY (owner item #52): send it as the `x-cron-secret` header, as for the other operator checks:
 *
 *   curl -H "x-cron-secret: $CRON_SECRET" https://liquidity-hq.com/api/egress-ip
 *
 * A service with no CRON_SECRET answers 401 to everyone. It reports the IP and nothing else.
 *
 * DELETE THIS WHEN #368 CLOSES. It exists to answer one question. A diagnostic
 * with no removal condition becomes permanent surface area by accident - the
 * same reasoning as the brand-mark exemption on #449.
 */

/* Two providers, because a single one being down would look exactly like a
   failed measurement, and a failed measurement is not evidence either way -
   which is the standing rule that the drift check already follows. */
const ECHO_SERVICES = [
  'https://api.ipify.org?format=json',
  'https://ifconfig.co/json',
];

/* IN-PROCESS CACHE, because this endpoint is an amplifier otherwise.
 *
 * One outbound fetch per request would let a caller make this service call out
 * repeatedly, from the IP whose rate-limit budget is
 * the entire subject of #368. QA caught it, and the irony is the point: a
 * diagnostic for a rate-limit problem should not be a way to spend the quota.
 *
 * A cache rather than lib/rateLimit.ts, because caching is TRUE here. The
 * egress IP does not change between requests within a process - if it did, this
 * route could not answer the question it exists for. A rate limiter would
 * refuse the second caller; a cache serves them the same correct answer.
 *
 * Module-level, so it resets on redeploy - which is exactly when the IP could
 * legitimately have changed. */
const CACHE_MS = 60_000;
let cached: { ip: string; via: string; at: number } | null = null;

export async function GET(req: Request) {
  if (!checkCronAuth(req, { headerOnly: true })) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) {
    return NextResponse.json(
      { ip: cached.ip, via: cached.via, cached: true },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  for (const url of ECHO_SERVICES) {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const body = await res.json() as { ip?: string };
      if (!body?.ip) continue;
      cached = { ip: body.ip, via: new URL(url).host, at: now };
      return NextResponse.json(
        { ip: body.ip, via: cached.via, cached: false },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    } catch {
      /* try the next one - see the note above on failed measurements */
    }
  }

  /* Explicitly "we could not measure", never a blank or a zero. A caller must
     be able to tell "no answer" apart from "an answer that happens to differ". */
  /* A failure is NOT cached. Caching it would turn one bad minute into sixty
     seconds of false 'could not measure', and the whole point of the 503 is
     that it means something specific. */
  return NextResponse.json(
    { ip: null, error: 'could not determine egress ip' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
