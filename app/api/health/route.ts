import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { _exchangeGuardStats, exchangeDegraded } from '@/lib/exchangeGuard';
import { checkCronAuth } from '@/lib/cronAuth';

export const dynamic = 'force-dynamic';

/*
 * Is this host up AND is its database answering? For an outside monitor (#1594).
 *
 * The owner asked for an alert after the 2026-10-21 slowness on qa: the site
 * answered, the database behind it did not (PostgREST returned PGRST002 while
 * its schema cache reloaded), and nobody knew until a person noticed. /api/version
 * could not have caught it - it answers without touching the database.
 *
 * 200 { ok: true, db_ms, db_checked_at, checked_at, exchanges } when one trivial read answers within 3 s.
 *
 * `checked_at` is THIS answer's time, generated per request. `db_checked_at` is when the cached database read actually ran, which
 * may be up to 30 s earlier, and `db_age_ms` is the gap at this request - one field was doing both jobs until #1649, so a caller
 * could not tell a fresh answer from a stale one. Measured on production before the split: three calls across six seconds all
 * returned the same `checked_at` and the same `db_ms` under `Cache-Control: no-store`.
 *
 * `exchanges` names every configured exchange every time - { bybit: { degraded }, binance: { degraded } } - healthy or not, because
 * an absent key cannot be told apart from a healthy one. Read at request time, never cached. A degraded upstream does NOT set
 * ok:false; the site is serving and the guards are working, and a check that goes red during every cooldown gets ignored.
 * The detailed per-exchange figures (strikes, cooling window, last upstream status) are added only for a caller carrying
 * CRON_SECRET: this endpoint is public, and those together map our rate-limit exposure.
 * 503 { ok: false, reason: 'db_slow' } when it does not answer in time.
 * 503 { ok: false, reason: 'db_error' } when it fails, or the client cannot be
 * built (settings missing on the host). The error text goes to the server log,
 * never into the response.
 *
 * PUBLIC ON PURPOSE, like /api/version: the monitor sends no credentials. The
 * response is a status and two numbers - no key, host, error text or setting name.
 *
 * ONE READ PER 30 s, whoever calls. The result is cached in this process and
 * concurrent callers share the read in flight, so an unauthenticated endpoint
 * cannot be used to put load on the database. `no-store` keeps any CDN from
 * serving an old answer; the cache that matters is this one, and it is short.
 *
 * `.retry(false)` IS REQUIRED. supabase-js 2.106 retries a failed GET by itself
 * (network failure, 503, 520) after 1 s, 2 s and 4 s. PGRST002 is a 503, so
 * without this the incident above would outlive the 3 s budget and be reported
 * as db_slow instead of db_error.
 *
 * The 3 s budget is a race as well as an abort: the abort releases the request,
 * the race guarantees the answer at 3 s even if a fetch ignores the signal.
 *
 * The client is built per check, not at module load, so a host missing its
 * settings reports db_error rather than failing to load the route.
 */

const BUDGET_MS = 3000;
const CACHE_MS = 30_000;

type Check =
  | { status: 200; body: { ok: true; db_ms: number; db_checked_at: string } }
  | { status: 503; body: { ok: false; reason: 'db_slow' | 'db_error' } };

const SLOW: Check = { status: 503, body: { ok: false, reason: 'db_slow' } };
const ERROR: Check = { status: 503, body: { ok: false, reason: 'db_error' } };

let cached: { at: number; check: Check } | null = null;
let inFlight: Promise<Check> | null = null;

async function checkDb(): Promise<Check> {
  const started = performance.now();
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => { ac.abort(); resolve('timeout'); }, BUDGET_MS);
  });
  try {
    const read = getSupabaseAdmin().from(T.app_config).select('key').limit(1).retry(false).abortSignal(ac.signal);
    const result = await Promise.race([read, timedOut]);
    if (result === 'timeout') {
      console.warn(`[health] db_slow: no answer within ${BUDGET_MS} ms`);
      return SLOW;
    }
    if (result.error) {
      console.error('[health] db_error:', result.error.code, result.error.message);
      return ERROR;
    }
    /* db_checked_at, not checked_at (#1649). This value is CACHED for 30 s with the rest of the check, so as `checked_at` it was
       answering "when did you answer" with "when was the database last read" - two questions in one field, and the reason a caller
       could not tell a fresh answer from a half-minute-old one. The answer time is added per request in GET. */
    return { status: 200, body: { ok: true, db_ms: Math.round(performance.now() - started), db_checked_at: new Date(Date.now()).toISOString() } };
  } catch (e) {
    console.error('[health] db_error:', e instanceof Error ? e.message : e);
    return ERROR;
  } finally {
    clearTimeout(timer);
  }
}

function currentCheck(): Promise<Check> {
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.check);
  inFlight ??= checkDb()
    .then((check) => { cached = { at: Date.now(), check }; return check; })
    .finally(() => { inFlight = null; });
  return inFlight;
}

export async function GET(req: Request) {
  const check = await currentCheck();

  /* #1649: the exchange breakers, read AT REQUEST TIME and never cached. A cached breaker state reads as current, which is worse
     than no instrument at all - it would have reported "healthy" through the whole of today's Bybit cooldown, and a blip shorter
     than the cache would be invisible permanently. This is also why it is computed here rather than inside `currentCheck`. */
  const now = Date.now();
  const exchanges = exchangeDegraded(now);

  /* An open breaker does NOT make `ok` false. Degraded is not down: the site serves, the guards do their job, and a health check
     that goes red during every normal cooldown is one everybody learns to ignore - which is how a mechanism ends up wired to
     nothing. `ok`, `db_ms` and the status codes are exactly as before. */
  /* How old the cached database reading is, at THIS request. /api/ath already solved this problem with its `X-Data-Stale:
     true; age=<seconds>` header - the one place in this codebase that distinguishes fresh from stale from failed without anyone
     reading a log - so the idea is copied rather than reinvented. Measured live on production before this existed: three calls
     across six seconds returned an identical `checked_at` and an identical `db_ms` under a `Cache-Control: no-store` header, so
     the header promised a freshness the body did not deliver. With the age in the body, a caller can see that for itself. */
  const dbAgeMs = cached ? Math.max(0, now - cached.at) : 0;

  const body = {
    ...check.body,
    checked_at: new Date(now).toISOString(),
    db_age_ms: dbAgeMs,
    exchanges,
    /* The detailed view is credentialed. /api/health is public, and strikes + cooling window + last upstream status together map
       how close this server is to being rate-limited and how long it stays down - coarse in public, detail behind the secret. */
    ...(checkCronAuth(req) ? { exchange_detail: _exchangeGuardStats(now) } : {}),
  };

  return NextResponse.json(body, { status: check.status, headers: { 'Cache-Control': 'no-store' } });
}
