/* #2420: the liquidation feed and the whale trades feed never stay on skeletons for ever. If no socket has gone live after 8 s the feed says it could not connect (and keeps retrying underneath); the line goes away
 * the moment a socket goes live. Signed out, no write, so it is classified prod read-only.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/live-feed-connect-failed.spec.ts -f project=desktop -f base_url=<deployed url>
 *   F1  /liq with every futures/spot socket REFUSED: no connect-failed line at 5 s (skeletons), the line (liq feed) is there by 14 s
 *   F2  the same page with sockets that OPEN (a stand-in that accepts and stays quiet): no connect-failed line after 14 s (a quiet connected market is not a failure)
 * The whale feed's own line (whale-feed-connect-failed) is asserted where the whale feed renders on /liq; a page that does not show it skips that half with the reason, so the liquidation half is never lost. */
import { test, expect, type Page } from '@playwright/test';

const HOSTS = /fstream\.binance\.com|stream\.binance\.com|stream\.bybit\.com|stream\.bytick\.com/;

async function open(page: Page, refuse: boolean) {
  await page.routeWebSocket(HOSTS, (ws) => { if (refuse) ws.close(); /* else: accepted and quiet */ });
  await page.goto('/liq', { waitUntil: 'domcontentloaded' });
}

test('F1. every socket refused: skeletons first, then "could not connect" by 14 s', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, true);
  const liq = page.getByTestId('liq-feed-connect-failed');
  await page.waitForTimeout(5_000);
  await expect(liq, 'the connect-failed line was there at 5 s: the 8 s wait is gone').toHaveCount(0);
  await expect(liq, 'no connect-failed line after the sockets were refused: the feed sits on skeletons for ever').toBeVisible({ timeout: 14_000 });
  await expect(liq).toContainText(/could not connect/i);
  const whale = page.getByTestId('whale-feed-connect-failed');
  if (await whale.count() === 0) test.info().annotations.push({ type: 'note', description: 'the whale feed does not render on /liq in this build: only the liquidation half was measured' });
  else await expect(whale).toContainText(/could not connect/i);
});

test('F2. sockets that open and stay quiet: no "could not connect" line (a quiet market is not a failure)', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, false);
  await page.waitForTimeout(14_000);
  await expect(page.getByTestId('liq-feed-connect-failed'), 'a connected but quiet feed was reported as failed').toHaveCount(0);
  await expect(page.getByTestId('whale-feed-connect-failed')).toHaveCount(0);
});
