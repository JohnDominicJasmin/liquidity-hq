import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';

/* Does the chart BACKFILL the candles it missed after its kline socket drops and reconnects? (#313, dev's #358; #2132)
 *
 * REWRITTEN 2026-11-13. The first version counted the chart's sockets with a `window.WebSocket` wrapper added by
 * `addInitScript` while also routing them with `page.routeWebSocket`, and SKIPPED when the wrapper saw none ("Binance blocks
 * cloud egress"). On the gate (run 43264183678) it skipped, so #2132 was unproven. The real reason the wrapper saw none is the
 * one measured on reconnect-cdp (runs 43250355802, 43257440819, 43259920950, probe 43253718616): with `routeWebSocket`
 * installed, routed sockets never reach an init-script wrapper. A spec built on it measured the harness, not the app.
 *
 * WHAT IS OBSERVABLE: the ROUTE HANDLER runs once per socket the page opens, so it is the record of connect and reconnect;
 * and the backfill itself is an HTTP request the page makes, seen by `page.on('request')`.
 *
 * THE ROUTED SERVER IS FAKE, so nothing depends on Binance being reachable: it answers the chart's kline socket with one
 * synthetic kline frame a second (the chart sets `lastBarTsRef` from a frame, and `backfillGap` returns at once while that is
 * unset - "nothing streamed yet"). The server then CLOSES the socket. Since #1572 the chart treats ANY close, clean or not, as a
 * dead feed and reconnects with backoff (`ws.onclose` in KLineProChart.tsx), so the old premise "a clean close is ignored" is
 * gone and no `online` event is needed; `reconnected` flips on the second open, which fires the backfill at `ws.onopen`.
 *
 *     1  chart opens a kline socket (handler call #1), server streams frames
 *     2  server closes it
 *     3  chart reconnects (handler call #2)  <- reconnect proven from the handler
 *     4  a /api/market/klines ... limit=500 request (or the Bybit klines equivalent) follows - the backfill
 *
 * THE CONTROL stays: with no close, no backfill. Without it a build that refetched history on a timer would satisfy the cell
 * while doing nothing about outages. */

const BACKFILL_HTTP = /\/api\/market\/klines\?[^"]*limit=500|type=bybit-kline[^"]*limit=500|v5\/market\/kline[^"]*limit=500/;
const KLINE_SOCKET = /@kline_/i;

const ivMs = (iv: string) => {
  const n = parseInt(iv, 10) || 1;
  return n * ({ m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[iv.slice(-1)] ?? 60_000);
};

test.describe('chart backfills candles missed during an outage', () => {
  test('a reconnect after a dropped kline socket fetches the gap', async ({ page }) => {
    test.setTimeout(240_000);

    const backfills: Array<{ url: string; t: number }> = [];
    page.on('request', r => { if (BACKFILL_HTTP.test(r.url())) backfills.push({ url: r.url(), t: Date.now() }); });

    const klineConnects: Array<{ url: string; t: number }> = [];
    const otherFeeds: string[] = [];
    const live: Array<{ close: () => void }> = [];
    await page.routeWebSocket(/@kline_|stream\.binance\.com|fstream\.binance\.com|stream\.(bybit|bytick)\.com/, (ws) => {
      const url = ws.url();
      if (!KLINE_SOCKET.test(url)) { otherFeeds.push(url.replace(/\?.*/, '')); return; }   // held open and silent
      klineConnects.push({ url, t: Date.now() });
      const iv = url.match(/@kline_(\w+)/)?.[1] ?? '1m';
      const entry = { close: () => { try { void ws.close({ code: 1000 }); } catch { /* gone */ } } };
      live.push(entry);
      const emit = () => {
        const open = Math.floor(Date.now() / ivMs(iv)) * ivMs(iv);
        try {
          ws.send(JSON.stringify({ e: 'kline', k: { t: open, T: open + ivMs(iv) - 1, s: 'BTCUSDT', i: iv, o: '60000', c: '60010', h: '60020', l: '59990', v: '10', x: false } }));
        } catch { /* closed */ }
      };
      emit();
      const timer = setInterval(emit, 1000);
      ws.onClose(() => { clearInterval(timer); const at = live.indexOf(entry); if (at >= 0) live.splice(at, 1); });
    });

    await gotoGuarded(page, '/arena');
    await page.waitForTimeout(20_000);

    /* INSTRUMENT CHECK, as a FAILURE with the evidence, not a skip: the chart must have opened a kline socket through the
       route. If it did not, the chart is on a feed this spec does not cover (Bybit) and the message says which sockets it did open. */
    // eslint-disable-next-line no-console
    console.log(`[backfill] kline sockets=${klineConnects.length} (${klineConnects.map(c => c.url.replace(/^wss:\/\//, '')).join(', ')}) other feeds=${JSON.stringify([...new Set(otherFeeds)])}`);
    expect(klineConnects.length,
      `the chart opened no Binance kline socket through the route. Other sockets it opened: ${JSON.stringify([...new Set(otherFeeds)])}. ` +
      'If this is a Bybit-only chart on this build, this spec does not cover that branch - say so rather than skipping.').toBeGreaterThan(0);

    const beforeKill = backfills.length;
    const connectsBefore = klineConnects.length;

    /* 2 - the server closes every live kline socket. */
    for (const s of [...live]) s.close();
    const killedAt = Date.now();

    /* 3 - the chart reconnects by itself (backoff 1s first). Proven from the handler, not from the page. */
    await expect.poll(() => klineConnects.filter(c => c.t > killedAt).length, {
      timeout: 60_000, intervals: [1_000],
      message: 'the chart never reopened its kline socket after the server closed it - the close did not reach the app, or the reconnect is broken',
    }).toBeGreaterThan(0);

    /* 4 - the gap backfill follows the reconnect. */
    await expect.poll(() => backfills.filter(b => b.t > killedAt).length, {
      timeout: 45_000, intervals: [1_000],
      message: `the chart reconnected (${klineConnects.length - connectsBefore} new kline socket(s)) but no backfill fetch followed. The bars closed during the gap are never requested: #313 as reported. Expected a klines request with limit=500.`,
    }).toBeGreaterThan(0);

    // eslint-disable-next-line no-console
    console.log(`[backfill] requests before the kill=${beforeKill} after=${backfills.filter(b => b.t > killedAt).length} first=${backfills.find(b => b.t > killedAt)?.url.slice(0, 160)}`);
  });

  test('CONTROL: no drop means no backfill', async ({ page }) => {
    test.setTimeout(180_000);

    const backfills: string[] = [];
    page.on('request', r => { if (BACKFILL_HTTP.test(r.url())) backfills.push(r.url()); });
    let connects = 0;
    await page.routeWebSocket(/@kline_/i, (ws) => {
      connects += 1;
      const iv = ws.url().match(/@kline_(\w+)/)?.[1] ?? '1m';
      const emit = () => {
        const open = Math.floor(Date.now() / ivMs(iv)) * ivMs(iv);
        try { ws.send(JSON.stringify({ e: 'kline', k: { t: open, T: open + ivMs(iv) - 1, s: 'BTCUSDT', i: iv, o: '60000', c: '60010', h: '60020', l: '59990', v: '10', x: false } })); } catch { /* closed */ }
      };
      emit();
      const timer = setInterval(emit, 1000);
      ws.onClose(() => clearInterval(timer));
    });

    await gotoGuarded(page, '/arena');
    await page.waitForTimeout(20_000);
    const settled = backfills.length;
    const connectsSettled = connects;
    expect(connectsSettled, 'no kline socket opened, so this control would pass for any build').toBeGreaterThan(0);

    await page.waitForTimeout(60_000);       // same kind of elapsed time, the socket is never closed

    expect(connects, 'the chart reconnected although the server never closed the socket').toBe(connectsSettled);
    expect(backfills.length,
      `${backfills.length - settled} backfill fetch(es) fired with no reconnect. The backfill is supposed to be triggered by recovery, ` +
      `not by a timer - re-polling history on a schedule is the waste the KLineProChart comment says it avoids.`)
      .toEqual(settled);
  });
});
