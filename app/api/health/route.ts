import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

/*
 * Is this host up AND is its database answering? For an outside monitor (#1594).
 *
 * The owner asked for an alert after the 2026-10-21 slowness on qa: the site
 * answered, the database behind it did not (PostgREST returned PGRST002 while
 * its schema cache reloaded), and nobody knew until a person noticed. /api/version
 * could not have caught it - it answers without touching the database.
 *
 * 200 { ok: true, db_ms, checked_at } when one trivial read answers within 3 s.
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
  | { status: 200; body: { ok: true; db_ms: number; checked_at: string } }
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
    return { status: 200, body: { ok: true, db_ms: Math.round(performance.now() - started), checked_at: new Date(Date.now()).toISOString() } };
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

export async function GET() {
  const check = await currentCheck();
  return NextResponse.json(check.body, { status: check.status, headers: { 'Cache-Control': 'no-store' } });
}
