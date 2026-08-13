import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';

/* Do the candles that closed during an outage get BACKFILLED? (#313, dev's #358)
 *
 * #306 established that the chart RESUMES after a network drop - verified by the
 * owner on a real phone, after six automated attempts failed silently. This is
 * the other half: the bars that elapsed WHILE the socket was down.
 *
 * WHY THIS DOES NOT DROP THE NETWORK. Six mechanisms were tried on #306 and all
 * six failed quietly:
 *
 *     context.setOffline        sockets stayed OPEN
 *     route.close(1006)         1006 is reserved - no close event delivered
 *     CDP offline               fired 1 run in 4
 *     routeWebSocket + close    delivers, but wasClean:TRUE - measured here
 *
 * That last one is the trap for this spec specifically. `KLineProChart:1273`:
 *
 *     if (cancelled || e.wasClean) return;   // a clean close is us, not the network
 *
 * A deliberate close is always clean, so the reconnect - and therefore the
 * backfill - is unreachable that way. A spec that closed the socket and found no
 * backfill would be reporting the guard working, not a defect.
 *
 * SO IT USES THE APP'S OWN RECOVERY PATH - IN TWO STEPS, AND THE ORDER MATTERS.
 *
 * `KLineProChart:1291`:
 *
 *     const onOnline = () => {
 *       if (live && live.readyState === WebSocket.OPEN) return;   // <- THIS
 *       connect();
 *     };
 *
 * The first version of this spec dispatched `online` while the socket was still
 * healthy. The handler returned immediately, nothing reconnected, no backfill
 * fired - and it reported "the bars are never requested", which would have been
 * a false defect against working code.
 *
 * So the socket has to be GONE first. A routed `server.close()` delivers a CLEAN
 * close, which :1273 deliberately ignores (no auto-reconnect) - leaving exactly
 * the state `onOnline` exists for. Then `online` reconnects, `reconnected` flips
 * true on the new open, and the backfill fires at :1268.
 *
 *     1  close the socket      clean, so nothing auto-reconnects
 *     2  let candles elapse    a real gap to fill
 *     3  dispatch `online`     the app's own recovery path
 */

const KLINES_BACKFILL = /\/api\/market\/klines\?[^"]*limit=500/;

test.describe('chart backfills candles missed during an outage', () => {
  test('a reconnect after elapsed candles fetches them', async ({ page }) => {
    test.setTimeout(300_000);

    const backfills: string[] = [];
    page.on('request', r => {
      if (KLINES_BACKFILL.test(r.url())) backfills.push(r.url());
    });

    /* Observe the kline socket so the run can prove it connected at all - the
       vacuous case that voided two of dev's attempts on #306. */
    await page.addInitScript(() => {
      (window as unknown as { __k: unknown[] }).__k = [];
      const N = window.WebSocket;
      class W extends N {
        constructor(u: string | URL, p?: string | string[]) {
          super(u, p);
          if (!/kline/i.test(String(u))) return;
          const log = (window as unknown as { __k: unknown[] }).__k;
          this.addEventListener('open', () => log.push({ k: 'open', t: Date.now() }));
        }
      }
      window.WebSocket = W as unknown as typeof WebSocket;
    });

    /* Route the kline socket so it can be closed on demand. */
    let closeSocket: (() => void) | null = null;
    await page.routeWebSocket(/kline/i, ws => {
      const server = ws.connectToServer();
      server.onMessage(m => ws.send(m));
      ws.onMessage(m => server.send(m));
      closeSocket = () => { try { server.close(); } catch { /* already gone */ } };
    });

    await gotoGuarded(page, '/arena');
    await page.waitForTimeout(20_000);

    const opensBefore = (await page.evaluate(
      () => ((window as unknown as { __k: unknown[] }).__k ?? []).length));
    expect(opensBefore,
      'the chart never opened a kline socket - Binance is unreachable from here, so this run ' +
      'cannot say anything about backfilling. Not a finding.').toBeGreaterThan(0);

    const beforeGap = backfills.length;

    /* 1 - kill the socket. Clean, so :1273 ignores it and nothing auto-reconnects. */
    expect(closeSocket, 'the kline socket was never routed - nothing to close').not.toBeNull();
    closeSocket!();
    await page.waitForTimeout(3000);

    /* 2 - let real candles elapse. 1m is the chart default, so ~2 minutes puts
       at least one full closed bar inside the gap. */
    await page.waitForTimeout(130_000);

    /* 3 - the app's own recovery path, now that the socket is actually gone. */
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(25_000);

    const gained = backfills.length - beforeGap;
    // eslint-disable-next-line no-console
    console.log(`[backfill] kline opens=${opensBefore} backfill requests before=${beforeGap} after=${backfills.length}`);

    expect(gained,
      `no backfill fetch fired after the reconnect. The chart resumes live updates but the ` +
      `bars that closed during the gap are never requested - which is #313 as reported. ` +
      `Expected a /api/market/klines request with limit=500.`)
      .toBeGreaterThan(0);
  });

  test('CONTROL: no reconnect means no backfill', async ({ page }) => {
    /* Without this, a build that refetched history on a timer would satisfy the
       test above while doing nothing about outages. The backfill must be caused
       by the reconnect, not by the passage of time. */
    test.setTimeout(240_000);

    const backfills: string[] = [];
    page.on('request', r => { if (KLINES_BACKFILL.test(r.url())) backfills.push(r.url()); });

    await gotoGuarded(page, '/arena');
    await page.waitForTimeout(20_000);
    const settled = backfills.length;

    await page.waitForTimeout(150_000);       // same elapsed time, NO online event

    expect(backfills.length,
      `${backfills.length - settled} backfill fetch(es) fired with no reconnect. The backfill ` +
      `is supposed to be triggered by recovery, not by a timer - re-polling history on a ` +
      `schedule is the waste dev's comment at KLineProChart:1063 says it deliberately avoids.`)
      .toEqual(settled);
  });
});
