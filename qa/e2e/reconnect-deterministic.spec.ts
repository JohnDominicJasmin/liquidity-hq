import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';
import { synthCombinedFrame } from '../syntheticMarket.mjs';

/* #1260 sibling to reconnect-cdp.spec.ts. That file's instrument - CDP
 * `Network.emulateNetworkConditions` - only produces an unclean socket close
 * on about 1 run in 4 (measured 2026-08-13, reconfirmed as a 4th consecutive
 * miss 2026-09-16). That makes it useless as a routine gate, even though a
 * real transport-level drop is the strongest possible signal when it does
 * fire - reconnect-cdp.spec.ts is kept for that reason, not replaced here.
 *
 * `context.routeWebSocket` (Playwright 1.62.1, this repo's pinned version)
 * intercepts every `new WebSocket(...)` the page makes before it reaches
 * the network at all, so THIS test controls the close deterministically
 * instead of hoping the browser's transport layer cooperates.
 *
 * Why a route-level close is a valid stand-in for a real drop, not a
 * weaker one: `components/MarketProvider.tsx:235` -
 *     ws.onclose = () => { retriesRef.current++; ... }
 * - takes no event parameter at all. It never reads `wasClean` or the close
 * code, so it cannot distinguish this test's deliberate close from a real
 * unclean transport drop. Any close drives the identical retry path.
 *
 * WHAT THIS PROVES AND WHAT IT DOESN'T. It proves the reconnect MECHANISM
 * works end-to-end - quick retries exhaust, the app keeps trying, a real
 * message flows once a connection is finally let through. It does NOT
 * prove Binance-side drops always look like a close to this browser's
 * WebSocket implementation - that question belongs to reconnect-cdp.spec.ts
 * and, per its own conclusion, to a human with real devtools when that
 * skips too.
 */

test.describe('ticker WebSocket recovers from a deterministic outage', () => {
  test('every connection attempt is closed for 35s, then a real message arrives within 90s', async ({ page, context }) => {
    const OUTAGE_MS = 35_000; // > the 5-quick-retry sequence's 30s total (2+4+6+8+10s)
    const RECOVERY_BUDGET_MS = 90_000; // matches #1260's widened wait in reconnect-cdp.spec.ts

    const startedAt = Date.now();
    let attemptsDuringOutage = 0;
    let attemptsAfterOutage = 0;
    let firstMessageAfterOutageAt: number | null = null;

    // Count messages the PAGE's sockets actually receive after the outage, so "recovered" means the
    // app resumed reading, not merely that we sent something.
    await page.addInitScript(() => {
      (window as unknown as { __rx: number }).__rx = 0;
      const N = window.WebSocket;
      class W extends N { constructor(u: string | URL, pr?: string | string[]) { super(u, pr); this.addEventListener('message', () => { (window as unknown as { __rx: number }).__rx++; }); } }
      window.WebSocket = W as unknown as typeof WebSocket;
    });

    await context.routeWebSocket(/stream\.binance\.com/, ws => {
      const elapsed = Date.now() - startedAt;
      if (elapsed < OUTAGE_MS) {
        attemptsDuringOutage++;
        // No server connection attempted - closing immediately is the
        // outage. The code/reason don't matter (onclose above ignores both).
        void ws.close();
        return;
      }
      attemptsAfterOutage++;
      /* SYNTHETIC, NOT BINANCE (PM ruling 2026-11-12). The old branch called connectToServer() and
         waited for a real Binance frame - which a US GitHub runner cannot reach, so recovery could
         never be observed there. Serve generated @ticker frames from the shared generator instead:
         the app's reconnect path is identical, and nothing depends on the venue. */
      const streams = (() => { try { return new URL(ws.url()).searchParams.get('streams') ?? ''; } catch { return ''; } })();
      const syms = streams.split('/').filter(x => x.includes('@ticker')).map(x => x.split('@')[0].toUpperCase());
      const emit = () => { for (const sym of (syms.length ? syms : ['BTCUSDT'])) { try { ws.send(synthCombinedFrame(sym)); } catch { /* closed */ } } };
      emit();
      const timer = setInterval(emit, 1000);
      ws.onClose(() => clearInterval(timer));
    });

    await gotoGuarded(page, '/arena');

    /* INSTRUMENT CHECK - the same guard reconnect-cdp.spec.ts uses, adapted:
       if the page never even attempted a ticker connection during the
       outage window, nothing about recovery has been exercised. Waiting the
       full outage window first, rather than polling, because the assertion
       genuinely cannot be true any earlier - the app is expected to be
       fully cut off for this whole span by design. */
    await page.waitForTimeout(OUTAGE_MS + 1_000);
    expect(attemptsDuringOutage,
      'the page never attempted a ticker WebSocket connection during the simulated outage - ' +
      'either the route pattern did not match what MarketProvider actually opens, or the ticker ' +
      'never starts. Not a finding about reconnection either way.').toBeGreaterThan(0);

    /* THE CLAIM. Poll rather than one fixed wait, so a fast recovery doesn't
       cost the full budget and a slow one still gets the whole window. */
    await expect.poll(async () => {
      const rx = await page.evaluate(() => (window as unknown as { __rx: number }).__rx);
      if (rx > 0 && firstMessageAfterOutageAt === null && attemptsAfterOutage > 0) firstMessageAfterOutageAt = Date.now();
      return firstMessageAfterOutageAt !== null;
    }, {
      message: `no message arrived on any ticker socket within ${RECOVERY_BUDGET_MS}ms of the ` +
        `outage lifting (connection attempts after outage: ${attemptsAfterOutage}). Either the ` +
        `retry loop never reopened a socket, or one opened but the app never resumed reading it.`,
      timeout: RECOVERY_BUDGET_MS,
      intervals: [1_000],
    }).toBe(true);

    // eslint-disable-next-line no-console
    console.log(`[reconnect-deterministic] attempts during outage=${attemptsDuringOutage} ` +
      `after=${attemptsAfterOutage} recovered in ` +
      `${(firstMessageAfterOutageAt as unknown as number) - (startedAt + OUTAGE_MS)}ms after outage lifted`);
  });
});
