/* QA on a deployed site (qa): the batch up to 735166c (#2818 to #2826, and the FET tag of #2812). Dispatch-only. Prints [C] lines; soft assertions. Signed-out screenshots go to qa/.shots under plain names for PM.
 * The quiet period is forced with the browser clock; the cut-off liquidation history is forced by failing the app's own history read. Nothing is written, no AI call (fenced). */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test.describe.configure({ timeout: 240_000 });
const SIZES = [390, 1280] as const, THEMES = ['dark', 'light'] as const;
async function anon(browser: Browser, width: number, theme: string, lang = 'en') {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
  await ctx.addInitScript(([t, l]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [theme, lang]);
  return ctx;
}
const text = (page: Page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));

for (const width of SIZES) for (const theme of THEMES) {
  test(`C44 trading hours in the quiet period, ${width} ${theme}`, async ({ browser }) => {
    const ctx = await anon(browser, width, theme); const page = await ctx.newPage();
    try {
      await installPaidAiFence(page);
      await page.clock.install({ time: new Date('2026-11-25T05:00:00Z') });
      await page.goto('/hours', { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(10_000);
      const t = await text(page);
      console.log(`[C] hours ${width} ${theme}: noWindows=${/No windows detected/i.test(t)} london=${/London Open/i.test(t)} quiet=${/.{0,20}(quiet|dead).{0,40}/i.exec(t)?.[0] ?? null} countdowns=${JSON.stringify(t.match(/\d+h \d+m(?: away)?/g)?.slice(0, 4) ?? null)} scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);
      expect.soft(t).not.toMatch(/No windows detected/i); expect.soft(t).toMatch(/London Open/i);
      await page.screenshot({ path: `qa/.shots/pr2823-hours-quiet-${width}-${theme}.png`, fullPage: true });
    } finally { await ctx.close().catch(() => {}); }
  });

  test(`C31 liquidation feed header with a failed history read, ${width} ${theme}`, async ({ browser }) => {
    const ctx = await anon(browser, width, theme); const page = await ctx.newPage(); let failed = 0;
    try {
      await installPaidAiFence(page);
      await page.route(/\/rest\/v1\/lhq(_dev)?_liq_events/, (r) => { failed++; return r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"qa: forced"}' }); });
      await page.goto('/liq', { waitUntil: 'domcontentloaded', timeout: 150_000 });
      const note = page.getByText(/24 h history incomplete/i).first();
      const seen = await note.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false);
      const stats = page.locator('.liqfeed-stats').first(); await stats.scrollIntoViewIfNeeded().catch(() => {});
      console.log(`[C] liq note ${width} ${theme}: shown=${seen} historyReadsFailed=${failed} line=${JSON.stringify(seen ? (await note.innerText()).replace(/\s+/g, ' ').slice(0, 160) : null)} scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);
      expect.soft(failed, 'CONTROL: the history read was not intercepted').toBeGreaterThan(0); expect.soft(seen).toBe(true);
      const box = seen ? note.locator('xpath=ancestor::*[.//*[contains(@class,"liqfeed-stats")]][1]') : stats;
      await box.screenshot({ path: `qa/.shots/pr2819-liq-history-note-${width}-${theme}.png` }).catch(async () => { await page.screenshot({ path: `qa/.shots/pr2819-liq-history-note-${width}-${theme}.png` }); });
    } finally { await ctx.close().catch(() => {}); }
  });

  test(`C31 chart Liq control title (Pro), ${width} ${theme}`, async ({ browser }) => {
    test.skip(!AUTH_READY, 'no fixtures on this host');
    const ctx = await signedInContext(browser, 'a', { viewport: { width, height: width < 500 ? 844 : 900 }, theme }); const page = await ctx.newPage();
    try {
      await installPaidAiFence(page);
      await page.route(/\/rest\/v1\/lhq(_dev)?_liq_events/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"qa: forced"}' }));
      await gotoSignedIn(page, '/arena?coin=btc'); await page.waitForTimeout(20_000);
      const titles = await page.locator('button.klc-tool-btn').filter({ hasText: /^\s*liq/i }).evaluateAll((b) => b.map((x) => (x as HTMLElement).title));
      console.log(`[C] chart liq title ${width} ${theme}: ${JSON.stringify(titles)}`);
      expect.soft(titles.join(' ')).toMatch(/24 h history incomplete/i);
    } finally { await ctx.close().catch(() => {}); }
  });
}

test('C65 Free: "Set alert" on the Arena opens the upgrade prompt, not the form', async ({ browser }) => {
  test.skip(!AUTH_READY, 'no fixtures on this host');
  for (const [who, name] of [['b', 'Free'], ['a', 'Pro']] as const) {
    const ctx = await signedInContext(browser, who, { viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
    try {
      await installPaidAiFence(page); await gotoSignedIn(page, '/arena?coin=btc'); await page.waitForTimeout(12_000);
      const btn = page.getByRole('button', { name: /^set alert/i }).first(); await btn.click({ timeout: 60_000 }); await page.waitForTimeout(2_500);
      const prompt = await page.getByTestId('locked-feature').or(page.locator('[role="dialog"]')).first().isVisible().catch(() => false);
      const form = await page.locator('input[type="number"]').filter({ visible: true }).count();
      console.log(`[C] set alert ${name}: prompt=${prompt} numberInputsVisible=${form}`);
      expect.soft(prompt, `${name} prompt`).toBe(name === 'Free');
    } finally { await ctx.close().catch(() => {}); }
  }
});

test('C67 signed out in Korean: the locked signal line on another coin', async ({ browser }) => {
  const ctx = await anon(browser, 1280, 'dark', 'ko'); const page = await ctx.newPage();
  try {
    await installPaidAiFence(page); await page.goto('/arena?coin=hype', { waitUntil: 'domcontentloaded', timeout: 150_000 });
    const box = page.getByTestId('signal-locked').first(); await box.waitFor({ state: 'visible', timeout: 90_000 }); await page.waitForTimeout(6_000);
    const t = (await box.innerText()).replace(/\s+/g, ' ');
    console.log(`[C] signed out ko lock: ${JSON.stringify(t)} href=${await box.getByTestId('signal-locked-link').getAttribute('href')}`);
    expect.soft(t).toMatch(/[가-힣]/); expect.soft(t).not.toMatch(/Sign up free/);
  } finally { await ctx.close().catch(() => {}); }
});

test('C57 cache headers on the deployed host, and C92 the Binance tag on /funding', async ({ browser }) => {
  const ctx = await anon(browser, 1280, 'dark'); const page = await ctx.newPage();
  try {
    await installPaidAiFence(page); const from = Date.now();
    await page.goto('/funding', { waitUntil: 'domcontentloaded', timeout: 150_000 });
    await page.locator('.frh-table tbody tr').first().waitFor({ state: 'visible', timeout: 150_000 });
    await page.getByTestId('funding-venue-binance').first().waitFor({ state: 'visible', timeout: 150_000 }).catch(() => {});
    const tagged = await page.locator('.frh-table tbody tr').evaluateAll((trs) => trs.filter((tr) => tr.querySelector('[data-testid="funding-venue-binance"]')).map((tr) => (tr.querySelector('td') as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
    console.log(`[C] funding: tagged Binance=${JSON.stringify(tagged)} after ${Math.round((Date.now() - from) / 1000)}s`);
    expect.soft(tagged.join(' ')).toMatch(/FET/);
    for (const path of ['/api/macro', '/api/market/snapshot', '/api/proxy?type=deribit-book', '/api/proxy?type=llama-stables']) {
      const h = await page.evaluate(async (p) => { const r = await fetch(p, { cache: 'no-store' }); return { status: r.status, cc: r.headers.get('cache-control') }; }, path);
      console.log(`[C] header ${path}: ${h.status} ${h.cc}`);
    }
  } finally { await ctx.close().catch(() => {}); }
});
