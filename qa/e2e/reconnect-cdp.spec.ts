import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';

/* Does the chart RECONNECT after a real network drop? (#306, dev's #309)
 *
 * Dev burned five attempts on this and correctly refused to report any of them.
 * The one that matters:
 *
 *     ctx.setOffline(true)   ->  sockets stayed OPEN, nothing to reconnect
 *     route.close(1006)      ->  the page received NO close event at all
 *
 * 1006 is reserved - browsers generate it internally and it cannot be sent - so
 * that attempt measured a drop that never happened. Playwright neither threw nor
 * delivered anything, which is the worst shape a failed instrument can take.
 *
 * THIS TRIES THE ONE MECHANISM ON DEV'S LIST THAT WAS NOT TRIED: CDP
 * `Network.emulateNetworkConditions` with `offline: true`. It is a different
 * layer from `context.setOffline` - it drives the same switch DevTools' own
 * offline checkbox does, below the request interception `setOffline` uses, so it
 * can tear down a live socket that `setOffline` leaves open.
 *
 * WHY THE INSTRUMENT IS CHECKED BEFORE THE PROPERTY. Every failed attempt on
 * #306 produced a plausible reading from an instrument that had not worked. So
 * this asserts, in order:
 *
 *     1. a socket opened at all          (else the run is vacuous)
 *     2. a close arrived, wasClean false (else no drop happened to recover from)
 *     3. a NEW socket opened after       (the actual claim)
 *
 * Step 2 is the guard. `wasClean: false` is also the fix's own trigger - the
 * code deliberately ignores clean closes - so a clean close would make the app
 * CORRECT to do nothing, and calling that a failure is exactly the false finding
 * dev avoided.
 *
 * A NEGATIVE RESULT HERE IS STILL A RESULT. If CDP cannot drop the socket
 * either, this file records that with the counts, and #306 goes to a human with
 * devtools - dev's option 3 - rather than staying open on an untried idea.
 */

type WsEvent = { url: string; kind: 'open' | 'close'; wasClean?: boolean; code?: number; t: number };

test.describe('chart reconnects after a real transport drop', () => {
  test('CDP offline tears the socket down and the chart comes back', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP is Chromium-only');

    /* Record every socket the page opens and every close it actually receives.
       Wrapping the constructor rather than routing means this observes what the
       PAGE saw - the exact thing that was missing when route.close(1006) looked
       like a working drop. */
    await page.addInitScript(() => {
      (window as unknown as { __ws: WsEvent[] }).__ws = [];
      const Native = window.WebSocket;
      class Wrapped extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          const log = (window as unknown as { __ws: WsEvent[] }).__ws;
          const u = String(url);
          this.addEventListener('open', () => log.push({ url: u, kind: 'open', t: Date.now() }));
          this.addEventListener('close', (e) => log.push({
            url: u, kind: 'close', wasClean: (e as CloseEvent).wasClean,
            code: (e as CloseEvent).code, t: Date.now(),
          }));
        }
      }
      window.WebSocket = Wrapped as unknown as typeof WebSocket;
    });

    await gotoGuarded(page, '/arena');
    await page.waitForTimeout(15_000);            // let the chart establish its feed

    const read = () => page.evaluate(() => (window as unknown as { __ws: WsEvent[] }).__ws ?? []);
    const before = await read();
    const opensBefore = before.filter(e => e.kind === 'open').length;

    /* INSTRUMENT CHECK 1. Binance is reachable from this machine or it is not.
       Two of dev's five attempts were void because the page never opened a
       socket, so "no socket after" said nothing. */
    expect(opensBefore,
      'the page never opened a WebSocket - Binance is unreachable from here, so this run ' +
      'cannot say anything about reconnection. Not a finding.').toBeGreaterThan(0);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
    });
    await page.waitForTimeout(12_000);

    const during = await read();
    const closes = during.filter(e => e.kind === 'close');

    /* INSTRUMENT CHECK 2 - the guard dev's attempt 5 lacked.
     *
     * SKIP, NOT FAIL, and the distinction is the whole point of this file. When
     * CDP does not drop the socket, nothing about the app has been measured -
     * calling that a failure would put a permanently red test in the suite and
     * teach everyone to ignore it, which is worse than having no test.
     *
     * Measured 2026-08-13 against qa: the drop fired on 1 run in 4.
     *
     *     run 1   4 sockets, 4 unclean closes, reconnected
     *     run 2   4 sockets, 0 closes
     *     run 3   4 sockets, 0 closes
     *     run 4   4 sockets, 0 closes
     *
     * So this usually skips. That is honest rather than useful, and it is here
     * because a 1-in-4 real measurement still beats an untried idea sitting in
     * an issue - see the note at the bottom. */
    const unclean = closes.filter(c => c.wasClean === false);
    test.skip(unclean.length === 0,
      `CDP offline did not produce an unclean close this run (sockets: ${opensBefore}, ` +
      `closes: ${closes.length}). NOTHING WAS MEASURED about the reconnect - this is the ` +
      `instrument not firing, not the fix failing.`);

    /* Back online, and the claim itself. */
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
    await page.waitForTimeout(20_000);            // backoff needs room

    const after = await read();
    const opensAfter = after.filter(e => e.kind === 'open').length;

    /* PER-URL, NOT A TOTAL COUNT. The first version of this test asserted
       `opensAfter > opensBefore` and passed on 3 -> 4: four sockets closed
       uncleanly and exactly one reopened. A total count cannot tell you WHICH
       one, and #306 is specifically "the arena CHART stays frozen" - so a
       different socket recovering while the chart stayed dead would satisfy it
       perfectly. That is the same shape as every void attempt on this issue. */
    const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };
    const dropped = [...new Set(unclean.map(c => c.url))];
    const dropAt = new Map(unclean.map(c => [c.url, c.t]));
    const recovered = dropped.filter(u =>
      after.some(e => e.kind === 'open' && e.url === u && e.t > (dropAt.get(u) ?? 0)));
    const stillDown = dropped.filter(u => !recovered.includes(u));

    // eslint-disable-next-line no-console
    console.log(`[reconnect] opens before=${opensBefore} closes=${closes.length} ` +
      `(unclean ${unclean.length}) opens after=${opensAfter} | ` +
      `dropped urls=${dropped.length} recovered=${recovered.length} ` +
      `still down=[${stillDown.map(host).join(', ')}]`);

    expect(stillDown,
      `${stillDown.length} of ${dropped.length} socket(s) that dropped uncleanly never came ` +
      `back in the 20s after the network returned: ${stillDown.map(host).join(', ')}. A total ` +
      `open count would have hidden this - one socket reconnecting is not the same as the one ` +
      `the user is looking at reconnecting, and #306 is about the CHART specifically.`)
      .toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS AND IS NOT, so nobody reads a green run as a sign-off.
 *
 * IT DOES NOT VERIFY #309. It fired once in four attempts. That one run showed
 * 4 unclean closes and a reopen, which is encouraging and is NOT verification -
 * and in that run the per-URL check below did not yet exist, so it was a total
 * open count, which cannot say WHICH socket came back. #306 is specifically
 * about the arena chart, so that distinction is the whole question.
 *
 * WHAT IT DOES SETTLE: dev's option 1 - "CDP Network.enable + a real transport
 * kill" - is not a dependable route. It works occasionally for reasons this run
 * could not isolate. Ruling it out is worth recording, because the alternative
 * is dev spending an afternoon on it too.
 *
 * WHAT IS LEFT: dev's option 2 (a fixture WS server the spec can hard-kill,
 * clean but a bigger change than the fix) or option 3 (a human with devtools
 * and thirty seconds). Option 3 remains the cheapest, and the failing state is
 * obvious to look at - the chart freezes at the last bar and the status dot
 * stays on "connecting".
 *
 * WHY KEEP A TEST THAT USUALLY SKIPS. It costs one run and it cannot mislead:
 * it either measures the property properly or announces that it measured
 * nothing. The failure mode this whole issue has produced five times is an
 * instrument that appears to work and does not, and every guard above exists to
 * make that state loud instead of plausible.
 * ───────────────────────────────────────────────────────────────────────────── */
