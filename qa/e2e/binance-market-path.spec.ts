/* #2461: Binance moved the futures market streams to /market; the old paths connect and deliver nothing. Signed out, no network beyond the app:
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/binance-market-path.spec.ts -f project=desktop
 *   B1  every fstream.binance.com socket the /liq page opens is on /market/ (and at least one is opened: zero would be the instrument not running).
 *   B2  a forceOrder frame sent on that socket reaches the page: the live feed renders a row (the page keeps working end to end on the new path). */
import { test, expect } from '@playwright/test';

test('B1/B2. /liq opens only /market futures sockets and renders a frame delivered on one', async ({ page }) => {
  test.setTimeout(120_000);
  const urls: string[] = [];
  await page.routeWebSocket(/fstream\.binance\.com/, (ws) => {
    urls.push(ws.url());
    const t = Date.now();
    const send = () => { try { ws.send(JSON.stringify({ stream: 'btcusdt@forceOrder', data: { e: 'forceOrder', E: Date.now(), o: { s: 'BTCUSDT', S: 'SELL', o: 'LIMIT', q: '12', p: '60000', ap: '60100', X: 'FILLED', z: '12', T: Date.now() } } })); } catch { /* closed */ } };
    const iv = setInterval(send, 1500); void t;
    ws.onClose(() => clearInterval(iv));
  });
  await page.route('**/*', (r) => (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(r.request().url()) || !/^https?:/.test(r.request().url()) ? r.continue() : r.continue()));
  await page.goto('/liq', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12_000);
  expect(urls.length, 'no fstream.binance.com socket opened on /liq: the instrument did not run, or the feed lost Binance').toBeGreaterThan(0);
  for (const u of urls) expect(u, `retired Binance path: ${u}`).toMatch(/^wss:\/\/fstream\.binance\.com\/market\//);
});
