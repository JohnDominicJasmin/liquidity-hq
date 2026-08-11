import { test, expect } from '@playwright/test';
import { getGuarded } from './_shared';

/* The server-side klines route (#200 batch 1, added in #231, sliced in #232).
 *
 * This route exists so 12 client call sites stop asking Binance and Bybit
 * directly. It is pinned BEFORE the rewiring lands, deliberately - once those
 * sites depend on it, a change to what it returns is a change to all of them at
 * once, and the cheapest moment to fix a contract is while nothing consumes it.
 *
 * ── WHY COUNT ALONE IS NOT ENOUGH, WHICH I GOT WRONG FIRST ─────────────────
 *
 * I announced this spec as "limit=N returns exactly N". Dev pointed out that a
 * wrong-direction slice passes that: same count, OLDEST candles instead of
 * newest, a chart of the wrong period rendered confidently. The two upstreams
 * order oppositely, measured rather than assumed:
 *
 *     bybit    first ts 1786377600000 > last 1786363200000   NEWEST-first
 *     binance  first ts 1786363200000 < last 1786377600000   OLDEST-first
 *
 * So Bybit slices (0, n) and Binance slices (-n), and a spec that only counts
 * cannot tell a correct slice from a reversed one. That is the second
 * count-shaped assertion today that the wrong thing would have satisfied - the
 * first was cache-policy asserting headers exist while nothing cached them.
 *
 * Recency is therefore asserted against an UNSLICED request rather than against
 * the slice direction, so the test does not encode the same assumption it is
 * checking.
 */

const ROUTE = '/api/market/klines';

/** Newest timestamp in a response, whichever envelope and order it uses. */
function newestTs(source: string, body: unknown): number {
  const rows = source === 'bybit'
    ? ((body as { result?: { list?: unknown[][] } })?.result?.list ?? [])
    : (Array.isArray(body) ? body as unknown[][] : []);
  const ts = rows.map(r => Number(r?.[0])).filter(Number.isFinite);
  return ts.length ? Math.max(...ts) : NaN;
}

function count(source: string, body: unknown): number {
  return source === 'bybit'
    ? ((body as { result?: { list?: unknown[] } })?.result?.list ?? []).length
    : (Array.isArray(body) ? body.length : 0);
}

/* One per upstream dialect. Bybit takes bare minutes, Binance suffixed strings -
 * the route deliberately does not translate between them, because silently
 * rewriting an interval is how a chart shows a timeframe nobody asked for. */
const SOURCES = [
  { source: 'bybit',           symbol: 'BTCUSDT', interval: '60' },
  { source: 'binance',         symbol: 'BTCUSDT', interval: '1h' },
  { source: 'binance-futures', symbol: 'BTCUSDT', interval: '1h' },
] as const;

/* Every bucket boundary plus the values real call sites use. 4, 20, 24 and 152
 * are the ones that were wrong before #232 - they bucket UP to 5, 25, 25 and
 * 200 respectively. */
const LIMITS = [1, 4, 20, 24, 50, 100, 152, 300];

test.describe('server-side klines route', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'HTTP-level, viewport irrelevant');
  });

  for (const { source, symbol, interval } of SOURCES) {
    test(`${source}: returns exactly the requested count, and the NEWEST ones`, async ({ request }, testInfo) => {
      /* The reference is a request the route cannot have sliced wrongly, because
       * 300 is itself a bucket - so its newest timestamp is the upstream's
       * newest, whatever order the upstream uses. Comparing against this instead
       * of against a hardcoded direction means the test does not assume the
       * thing it is testing. */
      const refRes = await getGuarded(request, `${ROUTE}?source=${source}&symbol=${symbol}&interval=${interval}&limit=300`);
      test.skip(refRes.status() !== 200,
        `${source} reference request returned ${refRes.status()} - upstream refused this IP, ` +
        'so slicing cannot be judged. That is a real condition (Binance IP-banned qa and staging ' +
        'for klines on 2026-08-10, #228) and skipping is correct; a run where EVERY source skips ' +
        'is a finding, not a pass.');

      const refNewest = newestTs(source, await refRes.json());
      expect(Number.isFinite(refNewest), `${source} reference carried no parseable timestamps`).toBe(true);

      const observed: string[] = [];

      for (const limit of LIMITS) {
        const res = await getGuarded(request, `${ROUTE}?source=${source}&symbol=${symbol}&interval=${interval}&limit=${limit}`);
        expect(res.status(), `${source} limit=${limit} returned ${res.status()}`).toBe(200);

        const body = await res.json();
        const n = count(source, body);
        observed.push(`${limit}->${n}`);

        /* #232: the bucket is what gets FETCHED and CACHED; this is what gets
         * RETURNED. Before that fix, 4->5, 20->25, 24->25 and 152->200. */
        expect(n,
          `${source} limit=${limit} returned ${n} candles. The bucket is what gets cached, not ` +
          'what gets returned - see sliceToLimit in the route. Anything computing over "the last ' +
          'N" silently uses a different N than it asked for, and lengths that differ per caller ' +
          'are impossible to reason about downstream.\n\n' +
          `observed so far: ${observed.join(' ')}`,
        ).toBe(limit);

        /* THE HALF A COUNT CANNOT SEE. A reversed slice returns the right number
         * of the WRONG candles. Greater-than-or-equal rather than strict equality
         * because the newest bar is still forming and the reference was fetched
         * moments earlier - a later request can legitimately carry a newer one.
         * What must never happen is OLDER. */
        expect(newestTs(source, body),
          `${source} limit=${limit} returned ${n} candles whose newest timestamp is OLDER than ` +
          'the unsliced reference. That is a reversed slice: the correct count of the wrong ' +
          'candles, which renders a chart of the wrong period and looks entirely plausible.\n\n' +
          'Bybit is NEWEST-first and slices (0, n); Binance is OLDEST-first and slices (-n). ' +
          'Getting that backwards is exactly this failure.',
        ).toBeGreaterThanOrEqual(refNewest);
      }

      testInfo.annotations.push({ type: 'known-issue', description: `${source} limit->count: ${observed.join(' ')}` });
    });
  }

  test('a refused upstream is loud, never an empty success', async ({ request }) => {
    /* #228 is the whole reason this assertion exists: /api/market/snapshot
     * returned klines:{} with HTTP 200 for hours while Binance IP-banned the
     * egress address. This route was built after that and must not repeat it. */
    const res = await getGuarded(request, `${ROUTE}?source=bybit&symbol=BTCUSDT&interval=60&limit=50`);

    if (res.status() === 200) {
      expect(count('bybit', await res.json()),
        'the route answered 200 with ZERO candles. That is #228 exactly - a refused upstream ' +
        'must produce a non-2xx carrying the upstream status, so a caller can tell "no data" ' +
        'from "refused". An empty success is indistinguishable from a quiet market.',
      ).toBeGreaterThan(0);
    } else {
      /* A non-2xx here is the CORRECT behaviour under a ban, not a test failure.
       * Asserted rather than skipped so the shape stays pinned either way. */
      const body = await res.text();
      expect(res.status(), `refusal answered ${res.status()}, which is not a documented failure`).toBeGreaterThanOrEqual(400);
      expect(body, 'a refusal must carry an error the caller can read').toMatch(/error/i);
    }
  });

  test('a second caller costs no upstream call', async ({ request }) => {
    /* Measured on the DATA, not on a header - #198's lesson. Two requests inside
     * the 300s TTL for a 60-minute interval must be byte-identical, because the
     * second is served from cached(). */
    const url = `${ROUTE}?source=bybit&symbol=ETHUSDT&interval=60&limit=100`;
    const a = await getGuarded(request, url);
    test.skip(a.status() !== 200, `upstream unavailable (${a.status()}), cannot judge caching`);
    const first = JSON.stringify(await a.json());

    await new Promise(r => setTimeout(r, 1500));
    const b = await getGuarded(request, url);
    const second = JSON.stringify(await b.json());

    expect(second,
      'two requests 1.5s apart inside a 300s TTL returned DIFFERENT bodies, so the second was ' +
      'not served from cache. cached() plus #201 single-flight is what makes this route safe ' +
      'to point 12 client sites at - without it they concentrate on one IP that Binance has ' +
      'already banned once (#228).',
    ).toBe(first);
  });

  test('validation rejects what would poison the cache key space', async ({ request }) => {
    /* cached() holds a module-level Map that never evicts, so the key space has
     * to stay finite. Each of these is a 400 today and must remain one - a route
     * that accepts arbitrary symbols or intervals is a slow memory leak, which
     * is the risk flagged on #199. */
    const cases: Array<[string, string]> = [
      ['unknown source',     `${ROUTE}?source=kraken&symbol=BTCUSDT&interval=60&limit=10`],
      ['untracked symbol',   `${ROUTE}?source=bybit&symbol=DOGEUSDT9&interval=60&limit=10`],
      ['wrong dialect',      `${ROUTE}?source=bybit&symbol=BTCUSDT&interval=1h&limit=10`],
      ['limit out of range', `${ROUTE}?source=bybit&symbol=BTCUSDT&interval=60&limit=9999`],
    ];

    for (const [name, url] of cases) {
      const res = await getGuarded(request, url);
      expect(res.status(),
        `${name} was NOT rejected - it returned ${res.status()}. Every accepted value becomes a ` +
        'cache key that is never evicted, so an open validation is a slow leak rather than a ' +
        'cosmetic problem.',
      ).toBe(400);
    }

    /* THE CONTROL. Four 400s prove nothing if the route 400s everything - a
     * broken handler would satisfy the block above completely. */
    const ok = await getGuarded(request, `${ROUTE}?source=bybit&symbol=BTCUSDT&interval=60&limit=10`);
    expect([200, 429, 502, 503],
      `a VALID request returned ${ok.status()}. The four rejections above are meaningless if the ` +
      'route refuses everything - this control is what separates "validation works" from ' +
      '"the handler is broken".',
    ).toContain(ok.status());
  });
});
