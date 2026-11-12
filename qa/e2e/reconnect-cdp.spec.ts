import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';
import { synthCombinedFrame } from '../syntheticMarket.mjs';

/* #306 / #309: after a real socket drop, does EACH feed the page had open come back?
 *
 * REWRITTEN 2026-11-12 (PM ruling, harness-five): CDP offline fired on about 1 run in 4 and needs a real
 * Binance socket a US runner cannot open. `context.routeWebSocket` is the fixture server the old file asked
 * for: it serves generated frames, then kills every live socket with code 1006 and refuses new ones for a
 * window, so the drop happens on EVERY run and nothing depends on the venue.
 *
 * REWRITTEN AGAIN 2026-11-13 - WHAT THE PAGE CAN AND CANNOT SEE. The first rewrite judged recovery from a
 * `window.WebSocket` wrapper in the page. Runs 43250355802, 43257440819 and 43259920950 measured that this
 * cannot work: with `routeWebSocket` installed, the routed sockets never reach a wrapper added by
 * `addInitScript` (5 routed sockets were live, and the page's own log listed only Supabase). Playwright's
 * route layer replaces the constructor for routed URLs. `page.on('websocket')` is blind to them too
 * (probe 43253718616, PROBE 4). So a close or an open "seen by the page" is not observable for these
 * sockets, and a test built on it measures the harness, not the app.
 *
 * WHAT IS OBSERVABLE, AND IS THE REAL CLAIM: the ROUTE HANDLER. It runs once per socket the page tries to
 * open, so a new handler call after the outage lifts IS the page reconnecting. That is judged PER FEED
 * (host + path), not per URL: MarketProvider's Bybit liquidation feed reconnects to the alternate host
 * stream.bytick.com by design, so every Bybit host counts as one feed. Recovery is judged per feed, never by
 * a total count, so one feed coming back cannot hide another that stayed dead (#306 is the chart's). */

type Attempt = { feed: string; t: number; refused: boolean };

const feedOf = (raw: string): string => {
  try {
    const u = new URL(raw);
    if (/(^|\.)(bybit|bytick)\.com$/.test(u.hostname)) return 'bybit-linear';
    return `${u.hostname}${u.pathname.replace(/\/$/, '')}${u.searchParams.has('streams') ? '?streams' : ''}`;
  } catch { return raw; }
};

test.describe('chart reconnects after a socket drop', () => {
  test('every feed the page had open reopens after the outage lifts', async ({ page, context }) => {
    const OUTAGE_MS = 12_000;
    const RECOVERY_BUDGET_MS = 90_000; // the quick-retry sequence alone takes ~30s to exhaust (#1260)

    let blocked = false;
    const attempts: Attempt[] = [];
    /* An array, not a Set: the read-only guard (qa/prod-readonly.ts) treats any `.delete(` as a write verb,
       and this spec is on the production-readonly allowlist - it only drives a routed socket. */
    const live: Array<{ close: (o?: { code?: number }) => void; feed: string }> = [];

    await context.routeWebSocket(/stream\.binance\.com|fstream\.binance\.com|stream\.(bybit|bytick)\.com/, (ws) => {
      const feed = feedOf(ws.url());
      attempts.push({ feed, t: Date.now(), refused: blocked });
      if (blocked) { void ws.close({ code: 1006 }); return; }
      const entry = { close: (o?: { code?: number }) => ws.close(o), feed };
      live.push(entry);
      const gone = () => { const at = live.indexOf(entry); if (at >= 0) live.splice(at, 1); };
      if (/bybit|bytick/.test(ws.url())) { ws.onClose(gone); return; }   // held open and silent: the claim is the reopen
      const streams = (() => { try { return new URL(ws.url()).searchParams.get('streams') ?? ''; } catch { return ''; } })();
      const syms = streams.split('/').filter(x => x.includes('@ticker')).map(x => x.split('@')[0].toUpperCase());
      const emit = () => { for (const sym of (syms.length ? syms : ['BTCUSDT'])) { try { ws.send(synthCombinedFrame(sym)); } catch { /* closed */ } } };
      emit();
      const timer = setInterval(emit, 1000);
      ws.onClose(() => { clearInterval(timer); gone(); });
    });

    await gotoGuarded(page, '/arena');
    await page.waitForTimeout(15_000); // let the page establish its feed

    /* INSTRUMENT CHECK: the page opened sockets through the route at all, otherwise there is nothing to drop
       and the route pattern no longer matches what MarketProvider opens - a harness break, not a finding. */
    const feedsBefore = [...new Set(live.map(l => l.feed))];
    // eslint-disable-next-line no-console
    console.log(`[reconnect-cdp] feeds live before the drop: ${JSON.stringify(feedsBefore)} (${live.length} sockets)`);
    expect(feedsBefore.length, 'the page opened no routed socket - the route pattern no longer matches what MarketProvider opens').toBeGreaterThan(0);

    /* THE DROP: kill every live socket with 1006 and refuse new attempts for the outage window. */
    blocked = true;
    const killedAt = Date.now();
    for (const ws of [...live]) { try { ws.close({ code: 1006 }); } catch { /* already gone */ } }
    await page.waitForTimeout(OUTAGE_MS);
    const retriesDuringOutage = attempts.filter(a => a.refused && a.t >= killedAt);
    // eslint-disable-next-line no-console
    console.log(`[reconnect-cdp] reconnect attempts refused during the outage: ${JSON.stringify(Object.fromEntries(feedsBefore.map(f => [f, retriesDuringOutage.filter(a => a.feed === f).length])))}`);

    /* Outage lifts. */
    blocked = false;
    const liftedAt = Date.now();
    const reopenedFeeds = () => feedsBefore.filter(f => attempts.some(a => a.feed === f && !a.refused && a.t >= liftedAt));

    /* PER FEED: every feed that was live must be re-opened. Poll so a fast recovery does not cost the budget. */
    await expect.poll(() => reopenedFeeds().length, {
      timeout: RECOVERY_BUDGET_MS,
      intervals: [1_000],
      message: 'not every feed the page had open reopened after the outage lifted',
    }).toBe(feedsBefore.length);

    const stillDown = feedsBefore.filter(f => !reopenedFeeds().includes(f));
    // eslint-disable-next-line no-console
    console.log(`[reconnect-cdp] feeds=${feedsBefore.length} reopened=${reopenedFeeds().length} still down=[${stillDown.join(', ')}]`);
    expect(stillDown, `${stillDown.length} of ${feedsBefore.length} feed(s) never came back: ${stillDown.join(', ')}.`).toEqual([]);
  });
});
