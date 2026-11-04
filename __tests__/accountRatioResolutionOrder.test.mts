/* #1912's fourteenth cell: `accountRatioFor` prefers the STORED ROW over the live fan-out.
 *
 * Dev Team asked for exactly this and said why: *"stub both paths with different values and assert
 * the snapshot's wins. Without it, the resolution order this PR exists for is untested, and the
 * live-path-only version would pass every other cell."* That is the whole point - every other cell
 * in #1910 and #1912 is satisfied by a correct live path alone.
 *
 * BOTH HALVES, OR IT IS HALF A TEST. A cell that only checks "snapshot wins when present" passes on
 * an implementation that ignores the live path entirely; a cell that only checks the live path
 * passes on one that never reads the row. The resolution ORDER is a claim about two states, so both
 * are here and each names what its own failure would mean.
 *
 * THE VALUES DIFFER ON PURPOSE AND BOTH SUM TO 1. `parseRatioPair` REJECTS a pair that does not sum
 * to 1 (#1651 - a missing side used to become a plausible 50/50 that consumers treated as measured),
 * so 0.70/0.30 and 0.55/0.45 are chosen to pass that rule while being impossible to confuse. If they
 * were equal, this file would pass whichever path won and measure nothing - the same vacuity as
 * comparing a dash to a dash.
 *
 * THE STRONGEST ASSERTION HERE IS AN ABSENCE, not a label. `lib/accountRatioData.ts:76` says of the
 * stored row: "exactly as the route does, and with no exchange call when it hits." So when the
 * snapshot wins, ZERO Bybit requests should be made - and that is observable without trusting the
 * `from` field, which a buggy implementation could set while still having paid for the call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./qa/alias-hooks.mjs', pathToFileURL('./'));

const SUPABASE = 'http://supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The 406 PostgREST answers a `maybeSingle()` with no row - `readSnapshot` turns it into null. */
const noRow = () => json(406, {
  code: 'PGRST116', details: 'The result contains 0 rows',
  message: 'JSON object requested, multiple (or no) rows returned',
});

const SNAPSHOT_LONG = 0.7;
const SNAPSHOT_SHORT = 0.3;
const LIVE_BUY = '0.55';
const LIVE_SELL = '0.45';

const net = { snapshotReads: 0, bybit: [] as string[], unknown: [] as string[] };
let serveRow = true;
/** How old the stored row's bucket is. The row is aged DIRECTLY rather than by moving the clock:
 *  the first version of 14c shifted Date.now, and the stub stamps `ts` from Date.now too, so the
 *  row aged with the clock and stayed fresh. A test whose fixture follows the thing it is
 *  measuring cannot measure it. */
let rowAgeMs = 0;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);

  if (url.host === 'api.bybit.com') {
    net.bybit.push(`${url.pathname}${url.search.includes('symbol') ? '?symbol' : ''}`);
    if (url.pathname.startsWith('/v5/market/account-ratio')) {
      /* Bybit's own raw shape - strings, under result.list - because the live path runs through
         `parseRatioPair` and a pre-parsed object would skip the parser this PR shares. */
      return json(200, { retCode: 0, result: { list: [{ buyRatio: LIVE_BUY, sellRatio: LIVE_SELL, timestamp: Date.now() }] } });
    }
    if (url.pathname.endsWith('/ping')) return json(200, {});
    net.unknown.push(`${req.method} ${url.host}${url.pathname}`);
    return json(501, { code: 'QA_STAND_IN_GAP' });
  }

  if (url.origin === SUPABASE) {
    if (url.pathname.includes('market_snapshot')) {
      net.snapshotReads++;
      if (!serveRow) return noRow();
      /* `ts` near now so decideSnapshot judges it FRESH: overdue = max(0, age - samplingMs) and
         samplingMs is 1h, so a just-stamped bucket is 0 overdue and well inside
         SNAPSHOT_TOO_OLD_MS (30 min). A `ts` of 0 or absent would be SKIPPED by agesFrom and the
         row would be declared unjudgeable - serving live, which is this cell's opposite. */
      const row = {
        payload: { data: { BTCUSDT: { longRatio: SNAPSHOT_LONG, shortRatio: SNAPSHOT_SHORT, ts: Date.now() - rowAgeMs } } },
        source: 'qa-fixture',
        updated_at: new Date().toISOString(),
      };
      return (req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? json(200, row) : json(200, [row]);
    }
    if (req.method === 'GET') return json(200, []);
    return new Response(null, { status: 201 });
  }

  net.unknown.push(`${req.method} ${url.host}${url.pathname}`);
  throw new Error(`stray request ${req.method} ${req.url}`);
}) as typeof fetch;

const { accountRatioFor } = await import('../lib/accountRatioData.ts');
const { feedFor } = await import('../lib/marketFeeds.ts');

const reset = (withRow: boolean) => {
  net.snapshotReads = 0; net.bybit = []; net.unknown = [];
  serveRow = withRow;
  rowAgeMs = 0;
};

test('14. PREMISE: the two stubbed pairs differ and both sum to 1, so whichever path wins is identifiable', () => {
  assert.notEqual(SNAPSHOT_LONG, Number(LIVE_BUY),
    'the snapshot and live values are equal, so this file would pass whichever path won and measure nothing');
  assert.equal(SNAPSHOT_LONG + SNAPSHOT_SHORT, 1, 'the snapshot pair must sum to 1 or it is not a pair the product would store');
  assert.equal(Number(LIVE_BUY) + Number(LIVE_SELL), 1,
    'the live pair must sum to 1 or parseRatioPair rejects it (#1651) and the live half degrades to null for a reason unrelated to resolution order');
  assert.notEqual(feedFor('account-ratio', { period: '1h' }), null,
    "feedFor('account-ratio', {period:'1h'}) returns null, so accountRatioFor skips the snapshot branch entirely and the next cell would pass by not looking");
});

test('14a. the stored row WINS over the live fan-out, and costs no exchange call', async () => {
  reset(true);
  const r = await accountRatioFor('btc', '1h');
  assert.deepEqual(net.unknown, [], `the stand-in does not model a path the code asked for: ${net.unknown.join(', ')}`);

  assert.equal(r.ok, true, 'the lookup failed outright, so there is no resolution order to judge');
  if (!r.ok) return;

  assert.equal(r.from, 'snapshot',
    `from is ${JSON.stringify(r.from)} - the live fan-out answered while a fresh stored row existed, which is the resolution order #1912 exists for`);
  assert.equal(r.entry?.longRatio, SNAPSHOT_LONG,
    `longRatio is ${r.entry?.longRatio}, not the stored ${SNAPSHOT_LONG}. If it is ${LIVE_BUY} the live value won while \`from\` claimed snapshot`);
  assert.equal(r.entry?.shortRatio, SNAPSHOT_SHORT, 'shortRatio did not come from the stored row');

  /* THE ABSENCE, which is the part a wrong `from` cannot fake. */
  assert.deepEqual(net.bybit, [],
    `${net.bybit.length} Bybit request(s) were made while the stored row was being served (${net.bybit.join(', ')}). lib/accountRatioData.ts:76 says the stored row costs no exchange call - a snapshot hit that still pays for the fan-out is the cost this path exists to avoid`);
  assert.ok(net.snapshotReads > 0, 'the snapshot table was never read, so this cell is not about the stored row at all');
});

test('14b. THE OTHER HALF: with no stored row the live fan-out answers, so the order is a preference and not the only path', async () => {
  reset(false);
  const r = await accountRatioFor('btc', '1h');
  assert.deepEqual(net.unknown, [], `the stand-in does not model a path the code asked for: ${net.unknown.join(', ')}`);

  assert.equal(r.ok, true, 'the live path failed, so 14a could be passing on an implementation that only ever reads the row');
  if (!r.ok) return;

  assert.equal(r.from, 'live',
    `from is ${JSON.stringify(r.from)} with no stored row available - a 406/PGRST116 must read as absent, not as a snapshot`);
  assert.equal(r.entry?.longRatio, Number(LIVE_BUY),
    `longRatio is ${r.entry?.longRatio}, not the live ${LIVE_BUY} - the live pair was rejected or the fan-out was skipped`);
  assert.ok(net.bybit.length > 0,
    'no Bybit request was made and no stored row was served, so the live half of the resolution order never ran');
  assert.ok(net.snapshotReads > 0,
    'the snapshot table was never consulted, so "the row is checked FIRST" is untested - the live answer here would be right by accident');
});

test('14c. CONTROL: a row the freshness rule rejects falls through to live, so 14a depends on the row being FRESH', async () => {
  /* Without this, 14a passes on an implementation that serves ANY row, however old - and the
     freshness rule is most of what decideSnapshot is. A `ts` well past samplingMs +
     SNAPSHOT_TOO_OLD_MS must be treated as absent rather than served with an age attached. */
  reset(true);
  /* FOUR HOURS OLD against a 1 h feed: overdue = 4h - 1h = 3h, well past SNAPSHOT_TOO_OLD_MS (30 min). */
  rowAgeMs = 4 * 60 * 60_000;
  {
    const r = await accountRatioFor('btc', '1h');
    assert.equal(r.ok, true, 'the lookup failed outright');
    if (!r.ok) return;
    assert.equal(r.from, 'live',
      `a row ~4h old against a 1h feed was served as a snapshot (from=${JSON.stringify(r.from)}). Past SNAPSHOT_TOO_OLD_MS the row must read as absent, or 14a is only asserting "a row exists" rather than "a fresh row wins"`);
    /* THE VALUE, NOT A NETWORK CALL. `bybitFanout` is cached, so the live answer here is legitimately
       served from 14b's call and asserting a fresh request would fail on correct behaviour - which is
       what the first version of this line did. 0.55 is reachable only through the live pair, so the
       number is the proof that the stale row was passed over. */
    assert.equal(r.entry?.longRatio, Number(LIVE_BUY),
      `longRatio is ${r.entry?.longRatio}; the stale row would give ${SNAPSHOT_LONG} and the live pair gives ${LIVE_BUY}, so this is the value that says which path answered`);
    assert.ok(net.snapshotReads > 0, 'the row was never read, so this cell did not exercise the freshness rule');
  }
});

test('14d. a coin with no Bybit symbol is a per-field gap, not a failure or a snapshot read', async () => {
  reset(true);
  const r = await accountRatioFor('definitelynotacoin', '1h');
  assert.equal(r.ok, true, 'an unmapped coin must degrade one field, never refuse the lookup');
  if (!r.ok) return;
  assert.equal(r.entry, null, 'an unmapped coin must yield entry null - "not fetched", never a zero');
  assert.deepEqual(net.bybit, [], 'an unmapped coin reached the exchange');
  /* `from` IS ASSERTED HERE BECAUSE A MUTATION FOUND IT MISSING. Relabelling this return
     'snapshot' (lib/accountRatioData.ts:74) left all five cells green: the other three never reach
     this path, and this one only checked the entry and the absence of a call. A path that reports
     the wrong source is how 'which path answered' stops being auditable from the response. */
  assert.equal(r.from, 'live',
    `from is ${JSON.stringify(r.from)} for a coin with no Bybit symbol. No row was read and no call was made, so reporting 'snapshot' would claim a source that was never consulted`);
  assert.equal(net.snapshotReads, 0,
    'the snapshot table was read for a coin with no Bybit symbol - the early return at :74 is meant to come before any lookup');
});

test.after(() => { globalThis.fetch = realFetch; });
