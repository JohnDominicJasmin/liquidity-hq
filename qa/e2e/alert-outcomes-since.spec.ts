/* #2276 (#1651): the Alert Track Record subtitle ends "since <month day>", the date of the OLDEST fire among the rows read (rows come newest first).
 * The card is hidden by the owner's flag SHOW_PERFORMANCE_STATS (NEXT_PUBLIC_SHOW_PERFORMANCE_STATS=1 at build time); this spec is only meaningful on a build with the flag on,
 * and says so (it skips otherwise, and a positive control fails if the card is not on the page at all).
 *   A1  three stubbed fires (newest 2026-11-10, oldest 2026-11-03): the subtitle reads "... since Nov 3"
 *   A2  no fires: the card is unchanged (no "since")
 * Fixture A signed in by session injection; the fires are stubbed at the REST layer (reads only, nothing written). */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

const fire = (d: string, i: number) => ({ rule_key: 'rsi_overbought', coin: 'btc', dir: 'short', label: 'RSI', fired_at: d, outcome_pct_24h: i % 2 ? 1.2 : -0.8, resolved_24h: true, outcome_pct_48h: null, resolved_48h: false });
async function arrange(page: Page, rows: unknown[]) {
  await page.route(/\/rest\/v1\/lhq_(dev_)?alert_fires/, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` }, body: JSON.stringify(rows) }));
}
const subtitle = (page: Page) => page.evaluate(() => { const el = Array.from(document.querySelectorAll('span')).find(e => /24h outcome/i.test(e.textContent || '')); return el ? (el.textContent || '').trim() : null; });

test.describe('#2276 alert track record window', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.describe.configure({ timeout: 150_000 });

  test('A1. the subtitle names the oldest fire read: "since Nov 3"', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a'); const page = await ctx.newPage();
    try {
      await arrange(page, [fire('2026-11-10T12:00:00Z', 1), fire('2026-11-06T12:00:00Z', 2), fire('2026-11-03T12:00:00Z', 3)]);
      await gotoSignedIn(page, '/alerts'); await page.waitForTimeout(8000);
      const s = await subtitle(page); console.log(`[A1] subtitle=${JSON.stringify(s)}`);
      expect(s, 'the Alert Track Record card is not on the page: this build has SHOW_PERFORMANCE_STATS off, nothing to measure').not.toBeNull();
      expect(s!).toMatch(/since Nov 3$/);
    } finally { await ctx.close(); }
  });

  test('A2. with no fires the subtitle is unchanged (no "since")', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a'); const page = await ctx.newPage();
    try {
      await arrange(page, []);
      await gotoSignedIn(page, '/alerts'); await page.waitForTimeout(8000);
      const s = await subtitle(page); console.log(`[A2] subtitle=${JSON.stringify(s)}`);
      if (s !== null) expect(s).not.toMatch(/since/i);
    } finally { await ctx.close(); }
  });
});
