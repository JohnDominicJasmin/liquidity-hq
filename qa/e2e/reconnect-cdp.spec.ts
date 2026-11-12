import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';
import { synthCombinedFrame } from '../syntheticMarket.mjs';

/* #306 / #309: after a real socket drop, does EACH ticker socket the page had come back?
 *
 * REWRITTEN 2026-11-12 (PM ruling, harness-five). This file used CDP `Network.emulateNetworkConditions`
 * to cut the real network, which (a) only produced an unclean close on about 1 run in 4, so it usually
 * skipped, and (b) needs a real Binance socket to exist at all - which a GitHub runner in the US
 * cannot open, so it failed outright there. The file's own conclusion named the fix: "a fixture WS
 * server the spec can hard-kill". `context.routeWebSocket` is that server. It serves generated
 * frames (qa/syntheticMarket.mjs), then kills every live socket with code 1006 and refuses new ones
 * for a window, so the drop happens on EVERY run and nothing depends on the venue.
 *
 * WHAT IS KEPT FROM THE ORIGINAL, because it is the point: recovery is judged PER URL, not by a total
 * open count. The first version asserted `opensAfter > opensBefore` and passed on 3 -> 4 when four
 * sockets dropped and one reopened; #306 is "the arena CHART stays frozen", so a different socket
 * recovering while the chart's stayed dead would have satisfied it. */

type WsEvent = { url: string; kind: 'open' | 'close'; code?: number; t: number };

test.describe('chart reconnects after a socket drop', () => {
  test('every dropped ticker socket reopens after the outage lifts', async ({ page, context }) => {
    const OUTAGE_MS = 12_000;
    const RECOVERY_BUDGET_MS = 90_000; // the quick-retry sequence alone takes ~30s to exhaust (#1260)

    /* Record every socket the page opens and every close it receives - what the PAGE saw. */
    await page.addInitScript(() => {
      (window as unknown as { __ws: WsEvent[] }).__ws = [];
      const Native = window.WebSocket;
      class Wrapped extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          const log = (window as unknown as { __ws: WsEvent[] }).__ws;
          const u = String(url);
          this.addEventListener('open', () => log.push({ url: u, kind: 'open', t: Date.now() }));
          this.addEventListener('close', (e) => log.push({ url: u, kind: 'close', code: (e as CloseEvent).code, t: Date.now() }));
        }
      }
      window.WebSocket = Wrapped as unknown as typeof WebSocket;
    });

    let blocked = false;
    /* An array, not a Set: the read-only guard (qa/prod-readonly.ts) treats any `.delete(` as a write verb,
       and this spec is on the production-readonly allowlist - it only drives a routed socket. */
    const live: Array<{ close: (o?: { code?: number }) => void }> = [];
    /* BOTH VENUES. The probe on run 43247177035 showed the page's live sockets are Supabase realtime and
       BYBIT (wss://stream.bybit.com/v5/public/linear) - which opens for real from a runner - while the
       Binance sockets produced no page-side event at all. A route covering only Binance therefore
       killed nothing the page was using ("the drop did not reach the page"). Route Bybit too. A Bybit
       socket is held open and silent: the claim here is that every dropped socket REOPENS, not what it
       carries, and the Binance branch below still serves generated frames. */
    await context.routeWebSocket(/stream\.binance\.com|fstream\.binance\.com|stream\.bybit\.com/, (ws) => {
      if (blocked) { void ws.close({ code: 1006 }); return; }
      live.push(ws);
      if (/bybit/.test(ws.url())) { ws.onClose(() => { const at = live.indexOf(ws); if (at >= 0) live.splice(at, 1); }); return; }
      const streams = (() => { try { return new URL(ws.url()).searchParams.get('streams') ?? ''; } catch { return ''; } })();
      const syms = streams.split('/').filter(x => x.includes('@ticker')).map(x => x.split('@')[0].toUpperCase());
      const emit = () => { for (const sym of (syms.length ? syms : ['BTCUSDT'])) { try { ws.send(synthCombinedFrame(sym)); } catch { /* closed */ } } };
      emit();
      const timer = setInterval(emit, 1000);
      ws.onClose(() => { clearInterval(timer); const at = live.indexOf(ws); if (at >= 0) live.splice(at, 1); });
    });

    await gotoGuarded(page, '/arena');
    await page.waitForTimeout(15_000); // let the page establish its feed

    const read = () => page.evaluate(() => (window as unknown as { __ws: WsEvent[] }).__ws ?? []);
    const before = await read();
    expect(before.filter(e => e.kind === 'open').length,
      'the page never opened a ticker WebSocket against the routed (synthetic) server, so there is nothing to drop. ' +
      'The route pattern no longer matches what MarketProvider opens - a harness break, not a finding about reconnection.').toBeGreaterThan(0);

    /* THE DROP: kill every live socket with 1006 and refuse new ones for the outage window. */
    blocked = true;
    const killedAt = Date.now();
    for (const ws of [...live]) { try { ws.close({ code: 1006 }); } catch { /* already gone */ } }
    await page.waitForTimeout(OUTAGE_MS);

    const during = await read();
    const closes = during.filter(e => e.kind === 'close' && e.t >= killedAt - 1000);
    expect(closes.length, 'the drop did not reach the page: no socket close was observed during the outage').toBeGreaterThan(0);

    /* Outage lifts. */
    blocked = false;
    const dropped = [...new Set(closes.map(c => c.url))];
    const dropAt = new Map(closes.map(c => [c.url, c.t]));
    const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };
    const reopened = async () => {
      const now = await read();
      return dropped.filter(u => now.some(e => e.kind === 'open' && e.url === u && e.t > (dropAt.get(u) ?? 0)));
    };

    /* PER-URL: every socket that dropped must reopen. Poll so a fast recovery does not cost the budget. */
    await expect.poll(async () => (await reopened()).length, {
      timeout: RECOVERY_BUDGET_MS,
      intervals: [1_000],
      message: 'not every dropped ticker socket reopened after the outage lifted',
    }).toBe(dropped.length);

    const recovered = await reopened();
    const stillDown = dropped.filter(u => !recovered.includes(u));
    // eslint-disable-next-line no-console
    console.log(`[reconnect-cdp] dropped=${dropped.length} recovered=${recovered.length} still down=[${stillDown.map(host).join(', ')}]`);
    expect(stillDown, `${stillDown.length} of ${dropped.length} dropped socket(s) never came back: ${stillDown.map(host).join(', ')}. ` +
      'A total open count would have hidden this - #306 is about the CHART socket specifically.').toEqual([]);
  });
});
