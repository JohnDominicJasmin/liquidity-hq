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

const BACKFILL_HTTP = /\/api\/market\/klines\?[^"]*limit=500/;

/* WHICH BRANCH THE CHART TAKES, MEASURED (run 43293183391): on /arena the chart opened NO @kline_ Binance socket; its live feed is
   the BYBIT branch of KLineProChart (wss://stream.bybit.com/v5/public/linear, host alternating to stream.bytick.com on every
   reconnect). That socket is told apart from the other Bybit socket the page opens (the liquidation feed) by what the page SENDS
   on it: { op: 'subscribe', args: ['kline.<interval>.<symbol>'] }. The backfill is fetchBybitKlinesRetry:
   /api/market/klines?source=bybit&symbol=..&interval=..&limit=500. */
const ivMs = (iv: string) => {
  if (/^\d+$/.test(iv)) return parseInt(iv, 10) * 60_000;
  return ({ D: 86_400_000, W: 604_800_000, M: 2_592_000_000 } as Record<string, number>)[iv] ?? 60_000;
};

type Connect = { t: number; url: string; topic: string };

/** A fake Bybit server for the chart's kline socket: answers the subscribe, then streams one frame a second. */
async function routeBybit(page: import('@playwright/test').Page, onKline: (c: Connect, close: () => void) => void, otherFeeds: string[]) {
  await page.routeWebSocket(/stream\.(bybit|bytick)\.com/, (ws) => {
    const url = ws.url();
    let subscribed = false;
    ws.onMessage((m) => {
      const text = typeof m === 'string' ? m : m.toString();
      if (/"op":"ping"/.test(text)) { try { ws.send(JSON.stringify({ op: 'pong' })); } catch { /* closed */ } return; }
      const topic = text.match(/"(kline\.[^"]+)"/)?.[1];
      if (subscribed || !/"op":"subscribe"/.test(text) || !topic) { if (!topic && !subscribed) otherFeeds.push(url); return; }
      subscribed = true;
      try { ws.send(JSON.stringify({ op: 'subscribe', success: true })); } catch { /* closed */ }
      const iv = topic.split('.')[1] ?? '1';
      const emit = () => {
        const start = Math.floor(Date.now() / ivMs(iv)) * ivMs(iv);
        try {
          ws.send(JSON.stringify({ topic, type: 'snapshot', ts: Date.now(), data: [{
            start, end: start + ivMs(iv) - 1, interval: iv, open: '60000', close: '60010', high: '60020', low: '59990',
            volume: '10', turnover: '600000', confirm: false, timestamp: Date.now() }] }));
        } catch { /* closed */ }
      };
      emit();
      const timer = setInterval(emit, 1000);
      ws.onClose(() => clearInterval(timer));
      onKline({ t: Date.now(), url, topic }, () => { try { void ws.close({ code: 1000 }); } catch { /* gone */ } });
    });
  });
}

test.describe('chart backfills candles missed during an outage', () => {
  test('a reconnect after a dropped kline socket fetches the gap', async ({ page }) => {
    test.setTimeout(240_000);

    const backfills: Array<{ url: string; t: number }> = [];
    page.on('request', r => { if (BACKFILL_HTTP.test(r.url())) backfills.push({ url: r.url(), t: Date.now() }); });

    const klineConnects: Connect[] = [];
    const closers: Array<() => void> = [];
    const otherFeeds: string[] = [];
    await routeBybit(page, (c, close) => { klineConnects.push(c); closers.push(close); }, otherFeeds);

    await gotoGuarded(page, '/arena');
    await page.waitForTimeout(20_000);

    // eslint-disable-next-line no-console
    console.log(`[backfill] kline subscriptions=${klineConnects.length} (${klineConnects.map(c => c.topic + '@' + c.url.replace(/^wss:\/\//, '')).join(', ')}) other bybit sockets=${otherFeeds.length}`);
    expect(klineConnects.length,
      'the chart never subscribed to a Bybit kline topic through the route, so there is no kline socket to drop: it is on a feed this spec does not cover').toBeGreaterThan(0);

    const beforeKill = backfills.length;
    const connectsBefore = klineConnects.length;

    /* 2 - the server closes the kline socket. */
    const killedAt = Date.now();
    for (const close of closers.splice(0)) close();

    /* 3 - the chart reconnects by itself (backoff 1s, alternate host). Proven from the handler: a NEW kline subscription. */
    await expect.poll(() => klineConnects.filter(c => c.t > killedAt).length, {
      timeout: 60_000, intervals: [1_000],
      message: 'the chart never re-subscribed to a kline topic after the server closed its socket - the close did not reach the app, or the reconnect is broken',
    }).toBeGreaterThan(0);

    /* 4 - the gap backfill follows the reconnect. */
    await expect.poll(() => backfills.filter(b => b.t > killedAt).length, {
      timeout: 45_000, intervals: [1_000],
      message: `the chart reconnected (${klineConnects.length - connectsBefore} new kline subscription(s)) but no backfill fetch followed. The bars closed during the gap are never requested: #313 as reported. Expected /api/market/klines with limit=500.`,
    }).toBeGreaterThan(0);

    // eslint-disable-next-line no-console
    console.log(`[backfill] requests before the kill=${beforeKill} after=${backfills.filter(b => b.t > killedAt).length} first=${backfills.find(b => b.t > killedAt)?.url.slice(0, 160)}`);
  });

  test('CONTROL: no drop means no backfill', async ({ page }) => {
    test.setTimeout(180_000);

    const backfills: string[] = [];
    page.on('request', r => { if (BACKFILL_HTTP.test(r.url())) backfills.push(r.url()); });
    let connects = 0;
    await routeBybit(page, () => { connects += 1; }, []);

    await gotoGuarded(page, '/arena');
    await page.waitForTimeout(20_000);
    const settled = backfills.length;
    const connectsSettled = connects;
    expect(connectsSettled, 'no kline subscription opened, so this control would pass for any build').toBeGreaterThan(0);

    await page.waitForTimeout(60_000);       // same kind of elapsed time, the socket is never closed

    expect(connects, 'the chart re-subscribed although the server never closed the socket').toBe(connectsSettled);
    expect(backfills.length,
      `${backfills.length - settled} backfill fetch(es) fired with no reconnect. The backfill is supposed to be triggered by recovery, not by a timer - re-polling history on a schedule is the waste the KLineProChart comment says it avoids.`)
      .toEqual(settled);
  });
});
