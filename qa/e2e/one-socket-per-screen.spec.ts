import { test, expect } from '@playwright/test';
import { CONVERTED_ROUTES } from './_design-tokens';

/* ONE SOCKET PER SCREEN — the assertion criterion 30 was supposed to make.
 *
 * The landing spec's criterion 30 reads "the mobile tree is ABSENT at desktop,
 * tested by node count rather than computed display". Dev implemented the two
 * layouts as ONE shared tree plus media queries instead of two markup trees,
 * and flagged the deviation themselves before anyone found it.
 *
 * Their implementation satisfies the intent. But it makes the criterion
 * VACUOUS: there is only ever one `[data-layout]` root, so "the other tree is
 * absent" cannot be false, and the check passes for a reason unrelated to what
 * it was protecting.
 *
 * WHAT IT WAS PROTECTING. A hidden subtree still MOUNTS. Arena rendered both
 * layouts with one hidden per breakpoint and ran two live chart instances with
 * two candle subscriptions — the owner saw two charts before either session
 * did. The cost is not duplicate markup, it is duplicate NETWORK.
 *
 * So this asserts the resource directly. Node counts are a proxy for it, and a
 * proxy that can be satisfied by an implementation detail is worse than no
 * check, because it reports green for the wrong reason.
 */

/** Routes whose designs specify a desktop/mobile split. */
const SPLIT_ROUTES = CONVERTED_ROUTES;

/* Counted with an INIT SCRIPT, not from the DOM.
 *
 * A WebSocket is invisible to `document.querySelectorAll` — there is no element
 * to find, which is why criterion 30 reached for node counts in the first place.
 * `addInitScript` runs before any page script, so the constructor is wrapped
 * before the app can call it and nothing is missed during hydration.
 *
 * Wrapping rather than blocking: the sockets still connect. A test that also
 * severs the connection would change what the page renders and stop measuring
 * the page under test. */
/* PEAK CONCURRENCY, NOT CONSTRUCTION COUNT — and the difference is the whole
 * value of this check.
 *
 * My first version counted `new WebSocket` calls. Run across seven routes it
 * reported `/liq` opening `fstream.binance.com/stream` twice, and I nearly
 * filed that. **A reconnect also constructs a socket**, so a count cannot tell
 * a duplicated subscription from a dropped connection retrying — and the app
 * reconnects deliberately, with backoff, by design.
 *
 * Tracking open/close and taking the peak distinguishes them: a retry is
 * open→close→open with a peak of 1, a leak is open→open with a peak of 2. On
 * `/liq` the peak is 2 and both are still open at the end of the run, which is
 * a leak and not a retry. That measurement is the defect report; the count
 * would have been a guess wearing a number. */
async function socketPeaks(page: import('@playwright/test').Page, url: string) {
  await page.addInitScript(() => {
    const w = window as unknown as { __ev: [string, string][] };
    w.__ev = [];
    const Native = window.WebSocket;
    class Counted extends Native {
      constructor(u: string | URL, protocols?: string | string[]) {
        super(u, protocols);
        /* THE FULL URL IS THE KEY, and dropping the query string is the bug
         * this check shipped with for one revision.
         *
         * `wss://fstream.binance.com/stream?streams=…@forceOrder` and
         * `…?streams=…@aggTrade` are DIFFERENT subscriptions on the same host
         * and path. The query string is what names a Binance stream, so
         * `split('?')[0]` collapsed every distinct subscription on a host into
         * one key — and reported `/liq` as holding a duplicate when it was
         * simply the first screen to want two streams.
         *
         * I had already refused to file on construction count, because a
         * reconnect also constructs. That was the right instinct on the wrong
         * axis: concurrency was never the flaw, IDENTITY was. */
        const key = String(u);
        w.__ev.push(['open', key]);
        this.addEventListener('close', () => w.__ev.push(['close', key]));
      }
    }
    window.WebSocket = Counted as unknown as typeof WebSocket;
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);   // the provider staggers its connections
  return page.evaluate(() => {
    const ev = (window as unknown as { __ev: [string, string][] }).__ev;
    const live: Record<string, number> = {}, peak: Record<string, number> = {};
    for (const [kind, u] of ev) {
      live[u] = (live[u] ?? 0) + (kind === 'open' ? 1 : -1);
      peak[u] = Math.max(peak[u] ?? 0, live[u]);
    }
    return peak;
  });
}

test.describe('one socket per screen', () => {
  /* THE CONTROL, AND IT DECIDES WHETHER ANY NUMBER BELOW MEANS ANYTHING.
   *
   * Every assertion here is "no more than one socket per stream". If the
   * wrapper never installed — a CSP change, an init-script ordering change, a
   * rename — every route reports ZERO sockets and every assertion passes while
   * measuring nothing.
   *
   * Zero is the answer this check is most likely to give for the wrong reason,
   * so it is the one that has to be disproved first. A screen that opens no
   * socket at all is not evidence of correctness; it is evidence the instrument
   * did not run. */
  test('CONTROL: the counter observes sockets at all', async ({ page }) => {
    test.setTimeout(90_000);
    const peaks = await socketPeaks(page, '/dashboard');
    expect(Object.keys(peaks).length,
      'the WebSocket wrapper recorded nothing on /dashboard, a screen known to ' +
      'stream market data. The init script did not install, and every assertion ' +
      'below would pass at 0 while measuring nothing.',
    ).toBeGreaterThan(0);
  });

  for (const route of SPLIT_ROUTES) {
    test(`${route} opens at most one socket per stream`, async ({ page }) => {
      test.setTimeout(120_000);
      const peaks = await socketPeaks(page, `${route}?design=terminal`);

      /* Grouped by stream, not totalled.
       *
       * Two DIFFERENT streams on one screen is normal — `/liq` legitimately
       * wants forceOrder AND aggTrade on the same host. The defect is the SAME
       * stream held twice, which is what a duplicated tree produces.
       *
       * UNPROVEN, and labelled so deliberately. This check has never failed
       * against a real defect. It failed once against `/liq` and that was my
       * own key bug, not a leak — see the note on the key above. Until it goes
       * red on something real it is wiring, exactly like the entitlement gate,
       * and a green run here means "no stream is held twice", not "the screen
       * is correct". */
      const doubled = Object.entries(peaks).filter(([, n]) => n > 1);
      expect(doubled,
        `${route} holds the same stream open more than once: ` +
        `${doubled.map(([u, n]) => `${n} concurrent ${u}`).join(', ')}. ` +
        'Two trees are mounted, or a component subscribed twice — the markup ' +
        'may look correct either way, because a hidden subtree still mounts.',
      ).toEqual([]);
    });
  }
});
