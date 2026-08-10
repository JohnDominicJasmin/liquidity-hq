import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

/* Does the server-side cache actually SERVE repeat callers?
 *
 * `cache-policy.spec.ts` asserts a `Cache-Control` header is present. This
 * asserts that a second caller costs no upstream call - which is the only reason
 * anybody wanted the header, and a claim that file never made.
 *
 * ── WHAT THIS FILE COST ME, RECORDED SO IT IS NOT REPEATED ─────────────────
 *
 * Two wrong conclusions on the way here, both from the same habit of trusting a
 * cheap signal that was adjacent to the real question.
 *
 * 1. I reported on #198 that repeat payloads VARY and called that independent
 *    proof the cache was dead. It was not proof of anything. Both routes stamp
 *    `ts: Date.now()` into every response, so the bytes differ on every request
 *    no matter how well the data is cached. I was hashing a clock.
 *
 * 2. I filed #199 asking dev to build `lib/upstreamCache.ts`. `lib/apiCache.ts`
 *    already existed, with `cached()` AND `cachedStale()` - including the
 *    serve-stale-on-failure behaviour I raised as an open design question. My
 *    grep searched for `new Map()` and the code says
 *    `new Map<string, { ts: number; data: unknown }>()`, so the type parameters
 *    hid it.
 *
 * Strip `ts` and measure again (qa, 4 requests ~800ms apart):
 *
 *   /api/market/snapshot  whole body  e3341fcc 7d29d12f 9d9c7fa1 82e433bf  VARIES
 *                         minus ts    1309a683 1309a683 1309a683 1309a683  IDENTICAL
 *   /api/market/rsi       whole body  c6240db6 7ea565ad 2bcc4aca 5835e799  VARIES
 *                         minus ts    cdb116f4 cdb116f4 cdb116f4 cdb116f4  IDENTICAL
 *
 * The data is cached. It was cached the whole time.
 *
 * ── WHAT REMAINS TRUE FROM THE #198 INVESTIGATION ──────────────────────────
 *
 * The `s-maxage` finding stands, because it never rested on payloads: `age` is
 * absent from every response, `x-render-origin-server: Render` is present on
 * every repeat, and a `_next/static` chunk with `max-age=31536000, immutable` is
 * `cf-cache-status: DYNAMIC` too. Nothing in front of this app caches anything.
 *
 * What changed is how much that matters. `s-maxage` being inert would be serious
 * if it were the only thing collapsing upstream calls. It is not - `cached()`
 * and Next's Data Cache already do that server-side, which is why the routes
 * below pass. The header is redundant, not load-bearing.
 *
 * The real remaining cost is #200: 56 call sites still call Binance and Bybit
 * straight from the browser, where no server-side cache can reach them.
 *
 * ── WHY THE ASSERTION IS SHAPED THIS WAY ───────────────────────────────────
 *
 * Byte-identity is NECESSARY evidence of a cache and never SUFFICIENT. An
 * all-time high and a published calendar look identical with no cache at all. So
 * a route is only usable here if its data provably moves when uncached, and the
 * rest are reported honestly as inconclusive rather than counted as passes.
 */

/** ~800ms between samples: shorter than any TTL here, longer than one upstream tick. */
const GAP_MS = 800;
const SAMPLES = 4;

/* Fields stamped per-response rather than carried from the cached data. Hashing
 * these measures the server's clock, which is the mistake documented above. */
const VOLATILE_FIELDS = ['ts', 'timestamp', 'generatedAt', 'fetchedAt'] as const;

function stableDigest(raw: string): string {
  let payload = raw;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const f of VOLATILE_FIELDS) delete (parsed as Record<string, unknown>)[f];
      payload = JSON.stringify(parsed);
    }
  } catch {
    /* Not JSON - hash it as-is. A non-JSON route is not one of ours below. */
  }
  return createHash('sha1').update(payload).digest('hex').slice(0, 10);
}

interface Probe { stable: string[]; raw: string[]; statuses: number[] }

type Req = { get: (u: string) => Promise<{ status(): number; text(): Promise<string> }> };

async function probe(request: Req, path: string): Promise<Probe> {
  const stable: string[] = [];
  const raw: string[] = [];
  const statuses: number[] = [];

  for (let i = 0; i < SAMPLES; i++) {
    const res = await request.get(path);
    statuses.push(res.status());
    const body = await res.text();
    raw.push(createHash('sha1').update(body).digest('hex').slice(0, 10));
    stable.push(stableDigest(body));
    if (i < SAMPLES - 1) await new Promise(r => setTimeout(r, GAP_MS));
  }
  return { stable, raw, statuses };
}

/* Routes whose DATA measurably moves when uncached, so identity across a window
 * is real evidence. Each names the shortest TTL it composes, because the claim
 * is "identical inside the shortest window this route depends on". */
const CACHED: Array<{ path: string; shortestTtl: string; why: string }> = [
  {
    path: '/api/market/snapshot',
    shortestTtl: '3 min (TICKER_TTL / KLINES_TTL)',
    why: 'composes cached() over Bybit tickers, klines and LSR; the ticker moves every second when uncached',
  },
  {
    path: '/api/market/rsi',
    shortestTtl: '3 min (FAST_TTL)',
    why: 'derived from live klines via cached(); recomputes on every uncached call',
  },
];

/* Identity here proves nothing - the data barely moves either way. Asserted for
 * liveness only, and used as the validity control below. */
const INCONCLUSIVE: Array<{ path: string; why: string }> = [
  { path: '/api/econ-calendar',   why: 'a published calendar is static for hours' },
  { path: '/api/funding',         why: 'funding settles on a fixed 8-hour schedule' },
  { path: '/api/signal-accuracy', why: 'historical stats change only when outcomes resolve' },
  { path: '/api/forex/jpy',       why: 'quoted to few decimals; often unchanged second to second' },
  /* DEMOTED from the group above by this file's own guard, on its first run.
   * The audit called it "Yahoo quotes move continuously", so it looked usable.
   * Five samples 10s apart say otherwise:
   *   qa    aa3badbe aa3badbe aa3badbe aa3badbe 46b00156
   *   prod  9f2f1492 d76e4589 d76e4589 d76e4589 d76e4589
   * It ticks every ~30-40s, so at an 800ms gap it is stable by luck rather than
   * by caching - the assertion would pass or fail on Yahoo's schedule. */
  { path: '/api/macro',           why: 'ticks every ~30-40s, so a short sample is stable by luck, not by caching' },
];

test.describe('cache effectiveness', () => {
  // HTTP-level; the mobile project would fetch identical bytes.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'response bodies are viewport-independent');
  });

  for (const { path, shortestTtl, why } of CACHED) {
    test(`${path} serves repeat callers from cache (${shortestTtl})`, async ({ request }) => {
      const { stable, raw, statuses } = await probe(request, path);

      expect(statuses.every(s => s < 400),
        `${path} returned ${statuses.join(', ')} - cannot judge caching from a failing route`,
      ).toBe(true);

      const span = ((SAMPLES - 1) * GAP_MS) / 1000;

      expect(new Set(stable).size,
        `${path} returned ${new Set(stable).size} DIFFERENT payloads across ${SAMPLES} requests ` +
        `spanning ~${span}s, far inside its ${shortestTtl} window.\n\n` +
        `Volatile fields (${VOLATILE_FIELDS.join(', ')}) are already excluded, so this is the ` +
        'DATA changing, not the response clock. Something stopped collapsing upstream calls: ' +
        `check that this route still goes through cached() in lib/apiCache.ts (${why}).\n\n` +
        'Cost of ignoring this: the route calls its upstream once per visitor instead of once ' +
        'per TTL, so third-party spend scales with traffic. That is #197/#199, and the ' +
        'CoinGecko 429s already seen on /api/ath are what it looks like when the bill lands.\n\n' +
        `raw digests (WITH the clock, expected to differ): ${raw.join(' ')}\n` +
        `stable digests (what is asserted):                ${stable.join(' ')}`,
      ).toBe(1);

      /* The clock SHOULD still move. If raw digests are identical too, something
       * in front started serving a stored response - which would be new, since
       * nothing currently caches at the edge. Not a failure, but it means the
       * assertion above passed for a different reason than intended, and the
       * file's premise needs re-checking. */
      if (new Set(raw).size === 1) {
        console.log(
          `[cache-effective] NOTE: ${path} returned byte-identical responses INCLUDING its ` +
          'per-request timestamp. A shared/edge cache may now be in play - re-check the ' +
          'premise in this file\'s header before trusting it.',
        );
      }
    });
  }

  /* The control that makes the group above mean something.
   *
   * Without it, a green run could equally mean the probe is measuring something
   * that is constant for an uninteresting reason - an error page, a redirect, a
   * cached 404. This asserts the probe observes stability where stability
   * genuinely exists AND reports the routes it could not judge. */
  test('control: the probe reports stability where data really is stable', async ({ request }) => {
    const results: string[] = [];
    let anyStable = false;

    for (const { path, why } of INCONCLUSIVE) {
      const { stable, statuses } = await probe(request, path);
      if (statuses.some(s => s >= 400)) {
        results.push(`${path}: HTTP ${statuses.join(',')} - upstream failing, skipped`);
        continue;
      }
      const isStable = new Set(stable).size === 1;
      if (isStable) anyStable = true;
      results.push(`${path}: ${isStable ? 'stable' : 'varies'} (${why})`);
    }

    expect(anyStable,
      'NOT ONE route returned an identical payload twice. Either every upstream is churning at ' +
      'once, or the probe is measuring something other than the response body.\n\n' +
      'Until this control passes, treat the results above as unproven - the probe has not ' +
      'demonstrated it can tell stability from variation.\n\n' + results.join('\n'),
    ).toBe(true);

    console.log(`[cache-effective] inconclusive by design:\n  ${results.join('\n  ')}`);
  });

  /* /api/ath is deliberately NOT in either list.
   *
   * It returned `502 {"error":"Upstream unavailable"}` on qa on 2026-08-10 while
   * production served 200 from the same commit. That is not flake - the comment
   * in lib/apiCache.ts documents CoinGecko rate-limiting the qa instance by IP,
   * and cachedStale() was written for this exact route because of it.
   *
   * Recorded as its own test because it is the live demonstration of #200's
   * warning: one server IP asking a keyless public API on behalf of everyone is
   * how you get refused. Right now cachedStale() has no last-good value to serve
   * on qa, so the degradation is a 502 rather than a stale number.
   *
   * Asserted as KNOWN so it cannot be quietly forgotten, and so it FAILS the day
   * qa starts succeeding - at which point delete this and put /api/ath in
   * INCONCLUSIVE. */
  /* /api/ath: the STATUS VARIES BY SERVICE, and pinning it to one value was wrong.
   *
   * This asserted `502` because that is what qa and staging both returned when it
   * was written. Measured a few hours later:
   *
   *     qa 502    staging 200    prod 200
   *
   * `staging`'s CoinGecko budget reset and `qa`'s did not - they are separate
   * Render services with separate IPs, and the limit is per IP. So the test began
   * failing on staging for the best possible reason, which is still a failing
   * test that tells nobody anything useful.
   *
   * THIS IS THE SAME MISTAKE THREE TIMES NOW, and it is worth naming rather than
   * quietly fixing: `navigationTimeout` without `expect.timeout`, `CI` without
   * `E2E_BASE_URL`, and now one service's status pinned as if it were every
   * service's. Each time I encoded the environment I had just looked at.
   *
   * WHAT IS ACTUALLY WORTH ASSERTING. Not the status - that is CoinGecko's
   * decision and it changes hourly. What must hold is that a refused upstream
   * degrades PREDICTABLY: a documented 502, or a served response. Never a 500,
   * never a hang, never a partial body. That is a property of our code and it is
   * true on every service.
   *
   * The status is recorded rather than gated, with the per-service split named,
   * because "which IPs are currently rate-limited" is real information for #200 -
   * it is the risk that issue warns about, observable today. */
  test('/api/ath degrades predictably when CoinGecko refuses it', async ({ request }, testInfo) => {
    test.skip(
      !(process.env.E2E_BASE_URL ?? '').includes('onrender.com'),
      'the CoinGecko per-IP limit is specific to the deployed non-prod services',
    );

    const res = await request.get('/api/ath');
    const status = res.status();
    const body = await res.text().catch(() => '');

    testInfo.annotations.push({
      type: 'known-issue',
      description:
        `/api/ath returned ${status} on ${process.env.E2E_BASE_URL}. RECORDED, NOT GATED - ` +
        'CoinGecko rate-limits per IP and each Render service has its own, so this differs ' +
        'between qa, staging and prod and changes without any deploy. Measured 2026-08-10: ' +
        'qa 502, staging 200, prod 200. A 502 here means cachedStale() had no last-good value ' +
        'to serve on that instance - see lib/apiCache.ts, which was written for this route.',
    });

    /* The real assertion, and it holds on every service: a refused upstream must
     * produce the documented failure, not an unhandled one. 500 would mean the
     * error escaped apiError(); anything else means the contract moved. */
    expect([200, 502],
      `/api/ath returned ${status}, which is neither success nor the documented ` +
      `"Upstream unavailable" 502. Body: ${body.slice(0, 120)}\n\n` +
      'A 500 means the CoinGecko failure escaped its handler rather than being mapped. ' +
      'A 429 forwarded verbatim would mean we are passing an upstream rate limit straight ' +
      'through to the user. Both are defects; the 502 is not.',
    ).toContain(status);
  });
});
