/* RELEASE CELLS (the group after v2026.11.17), run on the qa build after Dev promotes. Nothing is written, paid AI is fenced, every server answer these cells depend on is stubbed or a read.
 *   gh workflow run ci.yml --ref test/group-run-specs -f e2e=true -f base_url=https://liquidity-hq-qa.onrender.com -f project=desktop -f spec=qa/e2e/release-cells-2026-11-18.spec.ts
 *   K1  #2483 landing LIVE READ clock: shows the visitor's HH:MM (24 h), MOVES when time moves (the page clock is faked, then jumped an hour; the 30 s timer must fire), and is BLANK while the price read has failed
 *   S1  #2481 Settings > Telegram: a linked chat on a lapsed plan (status stub { configured, paused }) says "Paused · Pro needed" and keeps the Manage link; a plain { configured } says "Configured"
 *   M1  #2485 macro "Fri close": the browser is in Manila, the time is a Sunday, the quote's own time is Friday 16:00 New York: the stamp must say "Fri" (the MARKET's day), not Manila's "Sat"
 *   D1  #2487 Briefing: a CoinMarketCap global read that carries the 24 h dominance change prints "<trend> · 24h" beside BTC dominance
 *   C1  #2480 Correlation: the Least Correlated Pairs hint states a fact ("nearest zero over this range") and no longer says "potential diversification"; if the old text shows, the label row has not been applied to this database (reported as that, not as a layout verdict)
 * Each cell prints [CELL] lines so the run log is the evidence. */
import { test, expect, type Page } from '@playwright/test';
import { gotoGuarded } from './_shared';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence, assertNoUnstubbedPaidAi } from './_no-paid-ai';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const PRICE_HOSTS = /(binance\.com|bybit\.com|binance\.vision|coingecko\.com)/;

async function blockPriceFeeds(page: Page) {
  await page.route((u) => PRICE_HOSTS.test(u.hostname), (r) => r.abort());
  await page.route(/\/api\/proxy\?/, (r) => r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"stand-in: down"}' }));
  await page.routeWebSocket(/.*/, (ws) => ws.close());
}

/* the clock span is the right-hand sibling of the "Live read ·" title inside the panel header */
const clockText = (page: Page) => page.evaluate(() => {
  const title = Array.from(document.querySelectorAll('span')).find((s) => /live read\s*·/i.test(s.textContent || '')); if (!title) return null;
  const sib = Array.from(title.parentElement?.querySelectorAll('span') ?? []).filter((s) => s !== title && (s as HTMLElement).style.marginLeft === 'auto')[0];
  return sib ? (sib.textContent || '').trim() : null;
});

test.describe('#2483 the landing hero clock', () => {
  test.describe.configure({ timeout: 150_000 });
  test('K1a it shows HH:MM in 24 h, MOVES when an hour passes, in a Manila browser', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Manila', locale: 'en-US' }); const page = await ctx.newPage();
    try {
      await page.clock.install({ time: new Date('2026-11-17T09:55:00Z') });   // 17:55 in Manila
      await page.goto('/', { waitUntil: 'domcontentloaded' }); await page.clock.resume();
      await page.locator('.lp-hero-h1').first().waitFor({ state: 'visible', timeout: 90_000 });
      await expect.poll(() => clockText(page), { timeout: 30_000, message: 'the LIVE READ clock never appeared' }).toMatch(HHMM);
      const first = await clockText(page);
      await page.clock.fastForward('01:00:00');   // an hour passes; the 30 s timer is due and fires
      await expect.poll(() => clockText(page), { timeout: 15_000, message: 'the clock did not move after an hour: it is only read when the store re-renders' }).not.toBe(first);
      const second = await clockText(page);
      console.log(`[CELL] K1a clock before=${first} after an hour=${second}`);
      expect(first!.startsWith('17:') || first!.startsWith('18:')).toBe(true); expect(second!.slice(0, 2)).toBe(String((Number(first!.slice(0, 2)) + 1) % 24).padStart(2, '0'));
    } finally { await ctx.close(); }
  });

  test('K1b with every price feed failing the clock is BLANK (a ticking stamp over a dead feed reads as live)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' }); const page = await ctx.newPage();
    try {
      await blockPriceFeeds(page);
      await page.goto('/', { waitUntil: 'domcontentloaded' }); await page.locator('.lp-hero-h1').first().waitFor({ state: 'visible', timeout: 90_000 });
      await page.waitForTimeout(20_000);
      const t = await clockText(page); console.log(`[CELL] K1b clock with prices failing=${JSON.stringify(t)}`);
      expect(t, 'the LIVE READ panel was not found').not.toBeNull(); expect(t, 'a time is stamped over a failed price read').toBe('');
    } finally { await ctx.close(); }
  });
});

test.describe('#2481 Settings > Telegram status for a lapsed plan', () => {
  test.describe.configure({ timeout: 150_000 });
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  for (const [name, body, want, notWant] of [
    ['S1a lapsed plan: paused', { configured: true, paused: true }, /Paused · Pro needed/, /^Configured$/],
    ['S1b active plan: configured', { configured: true }, /^Configured$/, /Paused/],
  ] as const) {
    test(name, async ({ browser }) => {
      const ctx = await signedInContext(browser, 'a'); const page = await ctx.newPage(); await installPaidAiFence(page);
      try {
        await page.route(/\/api\/telegram\/status/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
        await gotoSignedIn(page, '/settings');
        const sec = page.locator('section, div').filter({ hasText: /telegram/i }).filter({ has: page.locator('a[href="/alerts"]') }).last();
        await expect(sec.getByText(want).first(), `the Telegram status does not read ${want}`).toBeVisible({ timeout: 30_000 });
        await expect(sec.getByText(notWant)).toHaveCount(0);
        await expect(sec.locator('a[href="/alerts"]'), 'a linked chat must still reach Manage alerts').toContainText(/manage alerts/i);
        console.log(`[CELL] ${name}: status text matched ${want}`);
        assertNoUnstubbedPaidAi(page, name);
      } finally { await ctx.close(); }
    });
  }
});

test.describe('#2485 the macro close stamp uses the MARKET\'s day', () => {
  test.describe.configure({ timeout: 150_000 });
  test('M1 Sunday in Manila, Friday 16:00 New York close: the stamp says "Fri close"', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Manila', locale: 'en-US' }); const page = await ctx.newPage();
    try {
      await page.clock.install({ time: new Date('2026-11-15T12:00:00Z') });   // Sunday 20:00 in Manila
      const fri = Date.UTC(2026, 10, 13, 21, 0);                               // Friday 16:00 New York (21:00Z), which is SATURDAY 05:00 in Manila
      const q = (price: number) => ({ price, chg: 0.3, asOf: fri });
      await page.route(/\/api\/macro(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ oil: q(71.2), dxy: q(104.1), spx: q(5800), gold: q(2650), jpy: { price: 150, chg: 0.1 }, tnx: { price: 4.2, chg: 0.2 }, real10y: { status: 'unknown' } }) }));
      await gotoGuarded(page, '/correlation'); await page.clock.resume();
      const stamps = page.locator('[data-testid="macro-stamp"]');
      await expect(stamps.first(), 'no "close" stamp on the macro strip for a two-day-old quote').toBeVisible({ timeout: 60_000 });
      const texts = await stamps.allTextContents(); console.log(`[CELL] M1 stamps=${JSON.stringify(texts)} (browser in Manila, quote = Friday 16:00 New York)`);
      for (const t of texts) expect(t.trim(), `the stamp names the VIEWER's day, not the market's: "${t}"`).toBe('Fri close');
    } finally { await ctx.close(); }
  });
});

test.describe('#2487 Briefing dominance window', () => {
  test.describe.configure({ timeout: 150_000 });
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test('D1 a 24 h dominance change prints the "24h" window beside the trend', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a'); const page = await ctx.newPage(); await installPaidAiFence(page);
    try {
      await page.route(/\/api\/cmc\?type=global/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { btc_dominance: 58.4, eth_dominance: 12.1, btc_dominance_24h_percentage_change: 0.6 } }) }));
      await gotoSignedIn(page, '/briefing');
      const item = page.locator('.mb-macro-item').filter({ has: page.locator('.mb-macro-val', { hasText: /58\.4%/ }) }).first();
      await expect(item, 'the BTC dominance item with the stubbed 58.4% never appeared').toBeVisible({ timeout: 60_000 });
      const sub = (await item.locator('.mb-macro-sub').first().textContent())?.trim() ?? ''; console.log(`[CELL] D1 dominance sub="${sub}"`);
      expect(sub, 'the trend must name its window').toMatch(/· 24h$/); expect(sub).toMatch(/Alts weak/);
      assertNoUnstubbedPaidAi(page, 'D1');
    } finally { await ctx.close(); }
  });
});

test.describe('#2480 Correlation hint wording', () => {
  test.describe.configure({ timeout: 150_000 });
  test('C1 the Least Correlated Pairs hint states a fact', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' }); const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/correlation');
      const head = page.getByText(/least correlated pairs/i).first(); await head.waitFor({ state: 'visible', timeout: 90_000 });
      const block = head.locator('xpath=ancestor-or-self::*[self::div or self::section][1]'); const text = (await block.innerText()).replace(/\s+/g, ' ');
      console.log(`[CELL] C1 hint block="${text.slice(0, 160)}"`);
      if (/potential diversification/i.test(text)) throw new Error('LABEL ROW NOT APPLIED to this database: the stored en row still says "potential diversification" (it overrides the new shipped default). Not a layout verdict.');
      expect(text).toMatch(/nearest zero over this range/i);
    } finally { await ctx.close(); }
  });
});
