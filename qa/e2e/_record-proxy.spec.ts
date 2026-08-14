import { test } from '@playwright/test';
import { fixtureKey } from './_fixtures';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/* RECORDER, not a test. Skipped unless RECORD_FIXTURES=1.
 *
 * WHY THIS EXISTS. `_fixtures.ts` intercepted 21 patterns, and 14 of them were
 * exchange hostnames — `fapi.binance.com`, `api.bybit.com`, `deribit.com`.
 * **The browser never requests those.** This app calls its own
 * `/api/proxy?type=…` and the proxy calls the exchange server-side, so
 * `page.route()` never sees a single one of them. They were written from the
 * server code, where those URLs are real.
 *
 * The consequence was worse than no fixtures. The four `/api/*` patterns that
 * COULD match were served from disk while all 13 proxy types went to the live
 * network — a partial intercept, so every visual sweep that pins market data
 * (`layout`, `contrast`, `a11y`, `text-under-control`, `clock`,
 * `design-structure`) has been scoring a page whose data was half recorded and
 * half whatever the market was doing. Dev found it while I was blaming the
 * Arena evidence grid; the grid was starving because `MarketProvider` never
 * populated, not because of anything in `lib/arenaEvidence.ts`.
 *
 * THE SHAPES ARE NOT MINE TO INVENT. This records what the proxy actually
 * returns rather than hand-authoring a payload from reading the route — the
 * same reason the header of `_fixtures.ts` gives for intercepting at the
 * third-party boundary. A fixture I typed from the source is an assertion that
 * my reading of the source is right, and this session has three entries in
 * HANDOVER §14 that are exactly that mistake.
 *
 * Run: RECORD_FIXTURES=1 npx playwright test qa/e2e/_record-proxy.spec.ts --project=desktop
 */

const DIR = join(process.cwd(), 'qa', 'fixtures', 'proxy');

/* IT IS NOT 13 ENDPOINTS, IT IS OVER 40. The first pass of this recorder
 * matched `/api/proxy` and `/api/market/snapshot` only, and the server log
 * immediately showed `[cmc] type=global` going straight past it. Enumerating
 * the browser's fetch targets found 40+ distinct `/api/*` paths, so keying on
 * the two I already knew about would have rebuilt the same partial intercept
 * one layer down.
 *
 * So this records EVERY successful JSON `/api/*` GET, keyed by path plus its
 * `type` parameter where one exists. */
const SKIP = /\/api\/(auth|ops|admin|grok|alert-outcomes|alert-prefs|hypotheses)/;

/* Not fixtures: `auth`/`ops`/`admin` are session-scoped and could capture
 * account data into a checked-in file; `grok` is a paid LLM call; the rest are
 * user-owned writes. Public market data only. */

const ROUTES = ['/', '/arena', '/dashboard', '/markets', '/funding'];

test('record every proxy type the browser actually requests', async ({ page }) => {
  test.skip(process.env.RECORD_FIXTURES !== '1', 'recorder — set RECORD_FIXTURES=1');
  test.setTimeout(300_000);

  mkdirSync(DIR, { recursive: true });

  /* BLOCK THE WEBSOCKET, DELIBERATELY — this is the run's most important line.
   *
   * Coin prices do NOT arrive over HTTP. `MarketProvider.tsx:90` opens
   * `wss://stream.binance.com:9443/stream?streams=…` and fills `store.coins`
   * from its frames; `/api/proxy?type=binance-24hr` at line 169 is `restPoll()`,
   * a FALLBACK that only runs when that socket fails.
   *
   * So the primary market data source has never been under fixture control at
   * all — `page.route` cannot see a WebSocket — and neither has the fallback,
   * because `binance-24hr` is not in `PROXY_FIXTURES`. Every run that calls
   * itself fixtured has been taking live coin data or none.
   *
   * That is the whole of #439. The Arena evidence grid is a pure function over
   * `CoinData`; with the socket blocked in CI and the fallback unintercepted,
   * `store.coins` stays empty and the grid renders nothing — which is exactly
   * the shape I measured and misattributed to `lib/arenaEvidence.ts`.
   *
   * Blocking it here is not a distortion of the recording. **A blocked socket IS
   * what CI sees**, so the fallback is the path that actually runs there, and it
   * is the one worth having on disk. Recording the socket's frames is the
   * separate second half, tracked in #439. */
  await page.routeWebSocket(/stream\.binance\.com/, ws => ws.close());

  const seen = new Map<string, { url: string; status: number; body: unknown }>();

  page.on('response', async (res) => {
    const url = res.url();
    const u = new URL(url);
    if (!u.pathname.startsWith('/api/')) return;
    if (SKIP.test(u.pathname)) return;
    if (!res.ok() || res.request().method() !== 'GET') {
      // eslint-disable-next-line no-console
      console.log(`NOT-RECORDED ${res.status()} ${res.request().method()} ${u.pathname}${u.search.slice(0, 60)}`);
      return;
    }
    const key = fixtureKey(u);
    if (seen.has(key)) return;
    try {
      seen.set(key, { url, status: res.status(), body: await res.json() });
    } catch { /* non-JSON — not a fixture we can serve */ }
  });

  for (const route of ROUTES) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    // The provider staggers its fetches; a fixed settle beats networkidle here
    // because the ticker polls forever and networkidle never arrives.
    await page.waitForTimeout(12_000);
  }

  /* THE FALLBACK NEEDS PATIENCE, NOT JUST A BLOCKED SOCKET.
   *
   * `restPoll()` does not run the moment the socket dies. `MarketProvider.tsx`
   * retries two URLs with backoff and only switches to `'Live · backup feed'`
   * after five failed reconnects, so a 12s settle blocks the socket and records
   * nothing — which is precisely what the first two attempts of this recorder
   * did, and why `binance-24hr` was missing from a run that had already made it
   * impossible to satisfy any other way.
   *
   * Waiting on the status string rather than a fixed sleep, so this records the
   * fallback the moment it actually engages and says so plainly if it never
   * does. A silent timeout here would leave the most important fixture missing
   * while the run still reported success. */
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page
    .getByText(/backup feed/i)
    .waitFor({ timeout: 120_000 })
    .catch(() => {
      // eslint-disable-next-line no-console
      console.log('FALLBACK NEVER ENGAGED — binance-24hr not recorded, and #439 stays open');
    });
  await page.waitForTimeout(8_000);

  for (const [key, rec] of seen) {
    writeFileSync(
      join(DIR, `${key}.json`),
      JSON.stringify({ _url: rec.url, _status: rec.status, _recorded: 'see git log', body: rec.body }, null, 2),
    );
  }

  // eslint-disable-next-line no-console
  console.log(`RECORDED ${seen.size}: ${[...seen.keys()].sort().join(' ')}`);
});
