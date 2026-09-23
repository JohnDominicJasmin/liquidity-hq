import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { BINANCE_SYMS, BYBIT_SYMS, bybitPriceFactor } from '@/lib/coins';
import { checkCronAuth } from '@/lib/cronAuth';

export const dynamic = 'force-dynamic';

// Resolves lhq_alert_fires outcomes at +24h and +48h: signed % move from
// price_at_fire to the current price, positive = favorable relative to dir.
// Same two-phase (log-then-resolve-later) shape as app/api/signals/track,
// just against wall-clock windows instead of SL/TP hits - most Telegram
// alerts (squeeze, RSI, whale, distribution, EMA cross) aren't structured
// trade calls with explicit levels, so "outcome" is defined as the honest
// price move by a fixed time, misses included.

interface FireRow { id: number; coin: string; dir: 'long' | 'short'; price_at_fire: number }

async function fetchCurrentPrices(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const [bnR, bbR] = await Promise.allSettled([
    fetch('https://api.binance.com/api/v3/ticker/price', { cache: 'no-store', signal: AbortSignal.timeout(8_000) }),
    fetch('https://api.bybit.com/v5/market/tickers?category=linear', { cache: 'no-store', signal: AbortSignal.timeout(8_000) }),
  ]);
  if (bnR.status === 'fulfilled' && bnR.value.ok) {
    const data = await bnR.value.json() as Array<{ symbol: string; price: string }>;
    for (const item of data) {
      const coin = Object.entries(BINANCE_SYMS).find(([, s]) => s === item.symbol)?.[0];
      if (coin) out[coin] = parseFloat(item.price);
    }
  }
  if (bbR.status === 'fulfilled' && bbR.value.ok) {
    const data = await bbR.value.json() as { result?: { list?: Array<{ symbol: string; lastPrice: string }> } };
    for (const item of data.result?.list ?? []) {
      const coin = Object.entries(BYBIT_SYMS).find(([, s]) => s === item.symbol)?.[0];
      // bybitPriceFactor, not the raw lastPrice. 1000PEPEUSDT/1000BONKUSDT quote
      // per 1000 tokens, while price_at_fire is stored per token - so without
      // this the outcome maths compared two different units and produced
      // ±100,000% moves on those two coins.
      if (coin && out[coin] == null && item.lastPrice) {
        out[coin] = parseFloat(item.lastPrice) * bybitPriceFactor(coin);
      }
    }
  }
  return out;
}

function outcomePct(dir: 'long' | 'short', entry: number, current: number): number {
  const raw = (current - entry) / entry * 100;
  return dir === 'long' ? raw : -raw;
}

// The two Supabase projects each hold their own copy of this function, named the
// same way the tables are (lib/tables.ts) - same pattern as lib/apiHealth.ts.
const RESOLVE_FN = process.env.NEXT_PUBLIC_APP_ENV === 'dev'
  ? 'lhq_dev_resolve_alert_outcomes'
  : 'lhq_resolve_alert_outcomes';

interface WindowResult { resolved: number; error?: string }

/* THE DATABASE SURFACE THIS ROUTE ACTUALLY USES, named so it can be doubled.
 *
 * Deliberately NOT `SupabaseClient`: a test double for the full client is not
 * writable in a few lines, and every branch below - an unreadable table, a
 * failing RPC, one window failing while the other succeeds - can only be forced
 * by controlling what the database returns. QA spiked the alternative first:
 * `node:test`'s `mock.module` works, but only behind
 * `--experimental-test-module-mocks`, which would put an unstable Node flag
 * under every test in the repo to buy one route's coverage.
 *
 * So the dependency is injected instead, the same move that made
 * `decideSnapshot` testable in #1404: take the collaborator as an argument with
 * a real default, and the call sites do not change. A double implements four
 * chained methods and `rpc`. */
export interface ResolverDb {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: boolean): {
        lte(column: string, value: string): {
          limit(n: number): PromiseLike<{ data: unknown; error: { message: string } | null }>;
        };
      };
    };
  };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function resolveWindow(
  hours: 24 | 48,
  prices: Record<string, number>,
  db: ResolverDb = getSupabaseAdmin() as unknown as ResolverDb,
): Promise<WindowResult> {
  const admin    = db;
  const resCol   = hours === 24 ? 'resolved_24h'    : 'resolved_48h';
  const cutoff   = new Date(Date.now() - hours * 3_600_000).toISOString();

  /* THE READ'S ERROR IS HANDLED, not dropped - the same rule as the RPC below,
   * and for the same reason this PR exists (QA's review of #1384).
   *
   * Destructuring only `data` made an unreadable table indistinguishable from a
   * quiet hour: `rows` comes back null, `updates` is empty, the function returns
   * `{ resolved: 0 }` with no error, and the route answers 200 with
   * `{ ok: true, resolved24h: 0, resolved48h: 0 }`. That is exactly the defect
   * named forty lines below about the loop this replaced - "ignored every update
   * error and counted the row as resolved anyway" - surviving on the read path
   * while being fixed on the write path.
   *
   * Returned rather than thrown so it travels the route's existing failure
   * machinery: `runResolve` collects it into `errors`, and the handler answers
   * 500 with `ok: false`, which is what makes the hourly n8n execution show the
   * failure instead of a green tick over a resolver that resolved nothing. */
  const { data: rows, error: readError } = await admin
    .from(T.alert_fires)
    .select('id, coin, dir, price_at_fire')
    .eq(resCol, false)
    .lte('fired_at', cutoff)
    .limit(200);
  if (readError) {
    console.error(`[alert-outcomes/resolve] ${hours}h read of ${T.alert_fires} failed:`, readError.message);
    return { resolved: 0, error: `${hours}h read: ${readError.message}` };
  }

  const updates: Array<{ id: number; price: number; pct: number }> = [];
  for (const row of (rows ?? []) as FireRow[]) {
    const current = prices[row.coin];
    if (current == null) continue; // no live price this run - retried on the next cron tick
    updates.push({ id: row.id, price: current, pct: outcomePct(row.dir, row.price_at_fire, current) });
  }
  if (updates.length === 0) return { resolved: 0 };

  // #1282: ONE round trip per window. This used to be a PATCH per row, awaited
  // in a loop - up to 200 sequential writes per window, the two windows side by
  // side, which is where the hourly multi-second stalls came from. Each row
  // carries its own price and outcome, so a bulk PATCH (one payload per filter)
  // cannot express it; the RPC is an UPDATE ... FROM over the array, guarded
  // with `not resolved_Nh` so an overlapping or retried run cannot overwrite an
  // outcome that is already resolved. See 20260919a_resolve_alert_outcomes_batch.sql.
  //
  // A failure is LOGGED and RETURNED, not swallowed: the loop this replaces
  // ignored every update error and counted the row as resolved anyway. On error
  // no row is counted, all of them stay unresolved, and the next tick retries.
  const { data, error } = await admin.rpc(RESOLVE_FN, { p_hours: hours, p_rows: updates });
  if (error) {
    console.error(`[alert-outcomes/resolve] ${hours}h batch update failed (${RESOLVE_FN}):`, error.message);
    return { resolved: 0, error: `${hours}h: ${error.message}` };
  }
  // The function returns the rows it actually resolved (rows already resolved
  // by an overlapping run are skipped by its guard, so this can be < updates.length).
  return { resolved: typeof data === 'number' ? data : 0 };
}

export interface ResolveDeps {
  db?: ResolverDb;
  fetchPrices?: () => Promise<Record<string, number>>;
}

export async function runResolve(deps: ResolveDeps = {}): Promise<{ resolved24h: number; resolved48h: number; errors: string[] }> {
  const { db, fetchPrices = fetchCurrentPrices } = deps;
  const prices = await fetchPrices();

  /* NO PRICES AT ALL IS A FAILURE, not a quiet hour.
   *
   * `fetchCurrentPrices` swallows both upstreams with Promise.allSettled, so
   * Binance and Bybit both being down returns an empty map - and then every row
   * is skipped by the `current == null` guard below, the run resolves zero, and
   * the route answers 200. A resolver that cannot reach a single price looked
   * exactly like an hour with nothing due. That is the same defect this PR
   * exists to remove, one level up from the read error.
   *
   * An empty map is unambiguous: it is not "this coin has no price", it is "no
   * coin has a price", which cannot happen while either exchange is answering.
   * Reported as an error so the handler's 500 carries it, and the windows are
   * skipped because nothing could resolve without prices anyway. */
  if (Object.keys(prices).length === 0) {
    console.error('[alert-outcomes/resolve] no prices from either exchange - nothing can resolve this run');
    return { resolved24h: 0, resolved48h: 0, errors: ['no prices: both Binance and Bybit failed or returned nothing'] };
  }

  const [w24, w48] = await Promise.all([
    resolveWindow(24, prices, db),
    resolveWindow(48, prices, db),
  ]);
  const errors = [w24.error, w48.error].filter((e): e is string => !!e);
  return { resolved24h: w24.resolved, resolved48h: w48.resolved, errors };
}

export async function GET(req: Request) {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  /* WHAT A 200 MEANS ON THIS ROUTE, stated once because three separate defects
   * in this file came from not having said it:
   *
   *     200 means the work was done. Anything that stopped the work from being
   *     done is a non-2xx, even when nothing threw.
   *
   * "Nothing was due" is work done - zero rows needed resolving and zero were
   * resolved, which is a true success and must stay 200. "The table could not be
   * read", "no exchange answered" and "we ran out of time" are all the work NOT
   * being done, and each one used to answer 200 with a cheerful zero.
   *
   * Same 28s safety net as the other cron routes - never exceed Render's 30s
   * limit - but it now answers 503. Before this, a resolver that had become too
   * slow to finish reported success every hour while resolving less and less,
   * and the n8n execution history showed an unbroken run of green. 503 rather
   * than 500: the work did not fail, it did not fit, and a retry is the right
   * response. */
  let timerId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<NextResponse>(res => {
    timerId = setTimeout(() => res(NextResponse.json(
      { ok: false, error: 'timeout', note: 'exceeded 28s - some rows unresolved, retried next run' },
      { status: 503 },
    )), 28_000);
  });
  const result = await Promise.race([runResolve(), timeout]);
  clearTimeout(timerId!);
  // A failed window returns 500, not 200. The loop this replaced ignored every
  // update error and answered ok:true regardless, so a resolver that had stopped
  // resolving looked exactly like a healthy one - "unknown reads as fine". With a
  // 5xx the hourly n8n workflow's execution (docs/INFRASTRUCTURE.md) shows the
  // failure. The body still carries `ok: false` and `errors`, and the counts of
  // whatever did resolve (a window that succeeded is not rolled back; the failed
  // one's rows stay unresolved and the next tick retries them).
  if ('resolved24h' in result) {
    const { errors, ...counts } = result;
    return NextResponse.json(
      { ok: errors.length === 0, ...counts, ...(errors.length ? { errors } : {}) },
      { status: errors.length ? 500 : 200 },
    );
  }
  return result;
}
