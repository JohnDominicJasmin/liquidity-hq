import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveWindow, runResolve, GET, type ResolverDb } from '@/app/api/alert-outcomes/resolve/route';

/* #1384 / #1282: the hourly alert-outcome resolver, forced through every failure.
 *
 * WHY THESE ARE UNIT TESTS. Every case below is a state you cannot summon on demand from
 * a deployed environment: a table that will not read, an RPC that does not exist, one
 * window failing while the other succeeds, both exchanges down. And this route CANNOT be
 * exercised on `qa` at all - `liquidity-hq-qa` has no `CRON_SECRET`, `checkCronAuth` fails
 * closed, so every request there is a 401 (measured, #1397).
 *
 * WHAT THEY PIN. One rule, which the route now states in as many words:
 *
 *     200 means the work was DONE. Anything that stopped the work from being done is a
 *     non-2xx, even when nothing threw.
 *
 * Three separate defects in this file came from never having said that, and all three had
 * the same shape - a cheerful zero. An unreadable table, a missing RPC and a total
 * exchange outage each reported `{ok: true, resolved24h: 0}` with a 200, which is
 * indistinguishable from a genuinely quiet hour. The n8n execution history showed an
 * unbroken run of green over a resolver that had stopped resolving.
 *
 * THE TRAP, AND WHY TEST 2 EXISTS. The obvious fix for test 1 is `if (!rows) return
 * error`. That fixes the read failure and silently converts every empty hour into an
 * hourly 500. "Nothing was due" is work done. Test 2 is written to fail against that fix.
 */

type Row = { id: number; coin: string; dir: 'long' | 'short'; price_at_fire: number | null };

/** What the double recorded, so a test can assert on the call rather than only the return. */
interface Spy {
  db: ResolverDb;
  /** Which `resolved_Nh` column each read filtered on, in order. */
  reads: string[];
  /** Every RPC call: the function name and the exact payload the route built. */
  rpcs: Array<{ fn: string; args: Record<string, unknown> }>;
}

/** A ResolverDb double. Per-column control, so one window can fail while the other works. */
function makeDb(opts: {
  rows?: Record<string, Row[]>;
  readError?: Record<string, string>;
  rpcError?: string;
  rpcResult?: number;
} = {}): Spy {
  const spy: Spy = { reads: [], rpcs: [], db: null as unknown as ResolverDb };
  spy.db = {
    from: () => ({
      select: () => ({
        eq: (column: string) => {
          spy.reads.push(column);
          return {
            lte: () => ({
              limit: () => {
                const err = opts.readError?.[column];
                if (err) return Promise.resolve({ data: null, error: { message: err } });
                return Promise.resolve({ data: opts.rows?.[column] ?? [], error: null });
              },
            }),
          };
        },
      }),
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      spy.rpcs.push({ fn, args });
      if (opts.rpcError) return Promise.resolve({ data: null, error: { message: opts.rpcError } });
      return Promise.resolve({ data: opts.rpcResult ?? (args.p_rows as unknown[]).length, error: null });
    },
  };
  return spy;
}

const COL24 = 'resolved_24h', COL48 = 'resolved_48h';
const row = (id: number, coin: string, dir: 'long' | 'short', price: number | null): Row =>
  ({ id, coin, dir, price_at_fire: price });
const PRICES = { BTC: 110_000, ETH: 4_000 };

/* ── 1. a table that cannot be read is a failure, not a quiet hour ─────────── */

test('1. a read failure is reported, not swallowed as zero', async () => {
  const spy = makeDb({ readError: { [COL24]: 'permission denied for table lhq_alert_fires' } });
  const out = await resolveWindow(24, PRICES, spy.db);

  assert.equal(out.resolved, 0);
  assert.ok(out.error, 'the read failed and the window reported no error - this is the defect the PR exists to remove');
  assert.match(out.error, /^24h read: /, 'the error must name the window and the phase, so a 500 says which of the two broke');
  assert.match(out.error, /permission denied/, "the upstream message must survive - 'read failed' alone is not diagnosable");
  assert.equal(spy.rpcs.length, 0, 'nothing may be written when the read did not succeed');
});

test('1b. runResolve carries a read failure up as an error', async () => {
  const spy = makeDb({ readError: { [COL24]: 'relation does not exist' } });
  const out = await runResolve({ db: spy.db, fetchPrices: async () => PRICES });

  assert.equal(out.errors.length, 1, 'the failure did not reach the level that decides the status code');
  assert.match(out.errors[0], /^24h read: /);
  assert.equal(out.resolved24h, 0);
});

/* ── 2. THE TRAP: an empty hour is a success ───────────────────────────────── */

test('2. nothing due is still a success - no error, no rows, no RPC', async () => {
  /* WRITTEN TO FAIL AGAINST THE OBVIOUS FIX FOR TEST 1. `if (!rows) return error` makes
     test 1 pass and turns every quiet hour into an hourly 500. Zero rows needed resolving
     and zero were resolved: that is work done, and it must stay a 200. */
  const spy = makeDb({ rows: { [COL24]: [], [COL48]: [] } });
  const out = await runResolve({ db: spy.db, fetchPrices: async () => PRICES });

  assert.deepEqual(out.errors, [], 'an empty hour was reported as a failure - this would 500 every hour with nothing due');
  assert.equal(out.resolved24h, 0);
  assert.equal(out.resolved48h, 0);
  assert.equal(spy.rpcs.length, 0, 'an empty batch must not be sent to the database at all');
  assert.deepEqual(spy.reads.sort(), [COL24, COL48], 'both windows must still have been read');
});

test('2b. rows present but no live price for any of them is also not an error', async () => {
  // Skipped rows are retried on the next tick by design; only a TOTAL price outage is a failure.
  const spy = makeDb({ rows: { [COL24]: [row(1, 'DOGE', 'long', 0.1)], [COL48]: [] } });
  const out = await runResolve({ db: spy.db, fetchPrices: async () => PRICES });   // no DOGE price
  assert.deepEqual(out.errors, []);
  assert.equal(out.resolved24h, 0);
  assert.equal(spy.rpcs.length, 0);
});

/* ── 3. one window failing must not hide the other ─────────────────────────── */

test('3. a failed 24h window does not hide a successful 48h one', async () => {
  const spy = makeDb({
    readError: { [COL24]: 'statement timeout' },
    rows: { [COL48]: [row(7, 'BTC', 'long', 100_000), row(8, 'ETH', 'short', 5_000)] },
  });
  const out = await runResolve({ db: spy.db, fetchPrices: async () => PRICES });

  assert.equal(out.errors.length, 1, 'exactly one window failed, so exactly one error');
  assert.match(out.errors[0], /^24h /, 'the error names the window that failed');
  assert.ok(!out.errors[0].startsWith('48h'), 'the healthy window was blamed');
  assert.equal(out.resolved48h, 2, 'the successful window was rolled back or lost - it must keep its real count');
  assert.equal(out.resolved24h, 0);
  assert.equal(spy.rpcs.length, 1, 'only the healthy window should have written');
});

/* ── 4. one bad row must not fail the batch ────────────────────────────────── */

test('4. price_at_fire of 0 or null yields a non-finite percentage, and the batch still goes', async () => {
  const spy = makeDb({
    rows: { [COL24]: [row(1, 'BTC', 'long', 0), row(2, 'ETH', 'short', null), row(3, 'BTC', 'long', 100_000)] },
  });
  const out = await resolveWindow(24, PRICES, spy.db);

  assert.ok(!out.error, 'one unusable row failed the whole batch - the other rows are collateral');
  assert.equal(spy.rpcs.length, 1);
  const sent = spy.rpcs[0].args.p_rows as Array<{ id: number; pct: number }>;
  assert.equal(sent.length, 3, 'the bad rows were dropped instead of being sent - they must resolve, with a null percentage');

  const byId = Object.fromEntries(sent.map((r) => [r.id, r.pct]));
  assert.ok(!Number.isFinite(byId[1]), 'entry price 0 must not produce a real-looking number');
  assert.ok(!Number.isFinite(byId[2]), 'a null entry price must not produce a real-looking number');
  assert.ok(Number.isFinite(byId[3]) && byId[3] > 0, 'the healthy row must still carry a real percentage');

  /* Named rather than implied: the NULL appears at SERIALISATION, not in the route.
     In process these are Infinity and NaN; `JSON.stringify` turns both into null, which
     is what PostgREST receives and what the column stores. */
  assert.equal(JSON.parse(JSON.stringify({ v: byId[1] })).v, null);
  assert.equal(JSON.parse(JSON.stringify({ v: byId[2] })).v, null);
});

/* ── 5. a missing RPC function is a failure ────────────────────────────────── */

test('5. an RPC error is reported and nothing is counted as resolved', async () => {
  const spy = makeDb({
    rows: { [COL24]: [row(1, 'BTC', 'long', 100_000)] },
    rpcError: 'Could not find the function public.lhq_dev_resolve_alert_outcomes',
  });
  const out = await resolveWindow(24, PRICES, spy.db);

  assert.equal(out.resolved, 0, 'rows were counted as resolved after the write failed - the exact defect of the loop this replaced');
  assert.ok(out.error);
  assert.match(out.error, /^24h: /);
  assert.match(out.error, /Could not find the function/);
});

test('5b. no prices from either exchange is a failure, and no window is even queried', async () => {
  /* An empty map is unambiguous: not "this coin has no price" but "NO coin has a price",
     which cannot happen while either exchange answers. Before the rule was stated, every
     row was skipped by the per-row price guard and the run reported a cheerful zero. */
  const spy = makeDb({ rows: { [COL24]: [row(1, 'BTC', 'long', 100_000)], [COL48]: [] } });
  const out = await runResolve({ db: spy.db, fetchPrices: async () => ({}) });

  assert.equal(out.errors.length, 1, 'a total exchange outage reported success');
  assert.match(out.errors[0], /no prices/i);
  assert.equal(spy.reads.length, 0, 'the windows were queried anyway - nothing can resolve without prices, so the reads are waste');
  assert.equal(spy.rpcs.length, 0);
});

/* ── 6. the control: this route CAN succeed ────────────────────────────────── */

test('CONTROL: a normal run resolves rows, reports no error, and signs both windows', async () => {
  /* Every test above asserts a failure or a zero, and a function that always errored would
     satisfy all of them. This is the one that must come back positive. */
  const spy = makeDb({
    rows: {
      [COL24]: [row(1, 'BTC', 'long', 100_000), row(2, 'ETH', 'short', 5_000)],
      [COL48]: [row(3, 'BTC', 'short', 120_000)],
    },
  });
  const out = await runResolve({ db: spy.db, fetchPrices: async () => PRICES });

  assert.deepEqual(out.errors, [], 'a healthy run reported an error');
  assert.equal(out.resolved24h, 2);
  assert.equal(out.resolved48h, 1);
  assert.equal(spy.rpcs.length, 2, 'one round trip per window - the whole point of #1282');
  assert.deepEqual(spy.reads.sort(), [COL24, COL48]);

  // And the arithmetic is right, not merely present: BTC long 100k -> 110k is +10%.
  const sent = spy.rpcs.find((r) => (r.args.p_hours as number) === 24)!.args.p_rows as Array<{ id: number; pct: number; price: number }>;
  const btc = sent.find((r) => r.id === 1)!;
  assert.equal(btc.price, 110_000, 'the CURRENT price is stored, not the entry price');
  assert.ok(Math.abs(btc.pct - 10) < 1e-9, `long 100000 -> 110000 should be +10%, got ${btc.pct}`);
  const eth = sent.find((r) => r.id === 2)!;
  assert.ok(Math.abs(eth.pct - 20) < 1e-9, `SHORT 5000 -> 4000 should be +20% (a short profits when price falls), got ${eth.pct}`);
});

test('CONTROL: one round trip per window regardless of row count', async () => {
  // #1282's actual claim. 200 rows must still be ONE rpc, not 200 sequential writes.
  const many = Array.from({ length: 200 }, (_, i) => row(i + 1, 'BTC', 'long', 100_000));
  const spy = makeDb({ rows: { [COL24]: many, [COL48]: [] } });
  const out = await resolveWindow(24, PRICES, spy.db);

  assert.equal(spy.rpcs.length, 1, 'more than one round trip - this is the stall #1282 was filed for');
  assert.equal((spy.rpcs[0].args.p_rows as unknown[]).length, 200);
  assert.equal(out.resolved, 200);
});

/* ── the gate: the one part of GET that is safe to invoke ──────────────────── */

test('GATE: an unauthenticated request is refused 401 before anything is touched', async () => {
  /* The only branch of `GET` reachable without a real database and real exchange calls,
     and the one most worth pinning: this route is cron-only, and `checkCronAuth` fails
     CLOSED - with no CRON_SECRET configured it denies rather than running unauthenticated,
     which is how every route in this family used to behave (`lib/cronAuth.ts`).
     A regression here would expose our own exchange egress to anyone who found the URL. */
  const res = await GET(new Request('https://example.invalid/api/alert-outcomes/resolve'));
  assert.equal(res.status, 401, 'an unauthenticated cron route answered something other than 401');
  assert.deepEqual(await res.json(), { error: 'Unauthorized' });
});

test('GATE: with a secret CONFIGURED, a wrong one is still refused', async () => {
  /* The test above passes trivially when CRON_SECRET is unset - `checkCronAuth` returns
     false on the first line and the comparison never runs, so it proves fail-closed and
     nothing about the check itself. This one configures a secret so the comparison
     actually executes, and `GATE CONTROL` below proves the configured value would have
     been accepted - otherwise both of these would pass against a function hard-wired to
     deny. */
  const saved = process.env.CRON_SECRET;
  const SECRET = 'qa-known-value-for-this-test';
  process.env.CRON_SECRET = SECRET;
  /* A SAME-LENGTH wrong value is the important one, built from the secret so it cannot
     drift out of sync. Every differing-length value is rejected by the cheap length check
     before `timingSafeEqual` is ever called, so a suite of only those would pass against a
     comparison that had been removed entirely. */
  const sameLengthWrong = 'X'.repeat(SECRET.length);
  assert.equal(sameLengthWrong.length, SECRET.length);
  try {
    for (const header of [sameLengthWrong, 'not-the-secret', '', SECRET.slice(0, -1), SECRET + 'X']) {
      const res = await GET(new Request('https://example.invalid/api/alert-outcomes/resolve', {
        headers: { 'x-cron-secret': header },
      }));
      assert.equal(res.status, 401, `header ${JSON.stringify(header)} passed the gate`);
    }
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved;
  }
});

test('GATE CONTROL: the configured secret IS accepted, so the two tests above mean something', async () => {
  /* Asserted on `checkCronAuth` rather than through `GET`, deliberately: the accepted path
     continues into the real database and the real exchanges, which a unit test must not
     do. This proves the gate can say yes without opening it. */
  const { checkCronAuth } = await import('@/lib/cronAuth');
  const saved = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'qa-known-value-for-this-test';
  try {
    const ok = checkCronAuth(new Request('https://example.invalid/x', {
      headers: { 'x-cron-secret': 'qa-known-value-for-this-test' },
    }));
    assert.equal(ok, true, 'the correct secret was rejected - the 401 tests above prove nothing');
    assert.equal(checkCronAuth(new Request('https://example.invalid/x')), false, 'a missing header was accepted');
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved;
  }
});

/* ── the status-code rule, asserted against source ─────────────────────────── */

test('the route maps the three states to 200 / 500 / 503', () => {
  /* COVERAGE BOUNDARY, stated rather than papered over: `GET` calls `runResolve()` with no
     arguments, so the seam cannot reach it and these three cannot be pinned by behaviour
     from here. Asserted against source instead, which is weaker and is labelled as such.
     If `GET` ever takes the same optional deps, replace this with a real request. */
  const src = readFileSync(new URL('../app/api/alert-outcomes/resolve/route.ts', import.meta.url), 'utf8');
  assert.match(src, /status:\s*errors\.length\s*\?\s*500\s*:\s*200/,
    'errors no longer map to 500 - a failed run would report success to the hourly job');
  assert.match(src, /status:\s*503/,
    'the 28s timeout no longer answers 503 - "did not fit" would read as "done"');
  assert.match(src, /ok:\s*errors\.length\s*===\s*0/,
    "the body's ok flag no longer follows the errors list");
});
