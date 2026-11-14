/* Tick list 2 (#2292), group 3: live read-only surfaces. Expectations come from the tracker rows.
 *   S1  19.1   /api/ath answers 200 with a list (it was a 502 for as long as its cold cache stayed cold)
 *   S2  34.1   no visible "Grok" anywhere a user can read it: text, aria-label, title, placeholder, alt, on seven routes; the Ask AI button is named "Ask AI"
 *   S3  24.1 / 25.2 / 26.1 / 27.4   /arena has the stable handles: data-testid scanner-trigger, and after opening, scanner-row-<coin> rows
 *   S4  73.1   (account A, signed in, read only) a coin outside the price-alert set shows the reason beside a DISABLED Set Alert button; a covered coin (btc) shows an enabled button and no reason
 * A cell that finds nothing to measure fails. */
import { test, expect, type Browser } from '@playwright/test';
import { gotoGuarded } from './_shared';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

async function open(browser: Browser, width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  await ctx.routeWebSocket(/binance\.com/, () => { /* silent */ });
  return ctx;
}

test('S1. /api/ath answers 200 with data', async ({ request }) => {
  const res = await request.get('/api/ath'); const body = await res.text();
  console.log(`[S1] status=${res.status()} bytes=${body.length} head=${body.slice(0, 120)}`);
  expect(res.status(), '/api/ath is not 200').toBe(200);
  const j = JSON.parse(body) as unknown;
  expect(j && typeof j === 'object' && Object.keys(j as object).length > 0, 'the answer is empty').toBe(true);
});

for (const path of ['/', '/arena', '/dashboard', '/markets', '/alerts', '/upgrade', '/faq']) {
  test(`S2. ${path}: no visible "Grok"`, async ({ browser }) => {
    test.setTimeout(100_000);
    const ctx = await open(browser); const page = await ctx.newPage();
    try {
      await gotoGuarded(page, path); await page.waitForTimeout(9_000);
      const r = await page.evaluate(() => {
        const hits: string[] = [];
        const re = /grok/i;
        if (re.test(document.body.innerText)) hits.push('text: ' + (document.body.innerText.match(/.{0,30}grok.{0,30}/i) || [''])[0]);
        document.querySelectorAll('[aria-label],[title],[placeholder],img[alt]').forEach(e => { for (const a of ['aria-label', 'title', 'placeholder', 'alt']) { const v = e.getAttribute(a); if (v && re.test(v)) hits.push(`${a}: ${v.slice(0, 60)}`); } });
        const fab = document.querySelector('[data-testid="grok-launcher"]') as HTMLElement | null;
        return { hits, fabLabel: fab ? (fab.getAttribute('aria-label') || fab.textContent || '').trim() : null, len: document.body.innerText.length };
      });
      console.log(`[S2] ${path} len=${r.len} fab=${JSON.stringify(r.fabLabel)} hits=${JSON.stringify(r.hits)}`);
      expect(r.len, `${path} did not render`).toBeGreaterThan(300);
      expect(r.hits, `a user can read "Grok" on ${path}`).toEqual([]);
      if (r.fabLabel !== null) expect(r.fabLabel).toMatch(/Ask AI|Open AI chat/);
    } finally { await ctx.close(); }
  });
}

test('S3. /arena: scanner-trigger and scanner-row-<coin> handles exist', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await open(browser); const page = await ctx.newPage();
  try {
    await gotoGuarded(page, '/arena'); await page.waitForTimeout(10_000);
    const trig = page.getByTestId('scanner-trigger'); await expect(trig, 'no scanner-trigger on /arena').toBeVisible({ timeout: 60_000 });
    if (!(await page.locator('.scanner-flyout').isVisible().catch(() => false))) await trig.locator('div').first().click();
    await page.locator('.scanner-flyout').waitFor({ state: 'visible', timeout: 20_000 });
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="scanner-row-"]')).map(r => (r.getAttribute('data-testid') || '').replace('scanner-row-', '')));
    console.log(`[S3] rows=${rows.length} sample=${JSON.stringify(rows.slice(0, 6))}`);
    expect(rows.length, 'no scanner-row-<coin> rows').toBeGreaterThan(5);
    expect(rows, 'btc is not a row').toContain('btc');
  } finally { await ctx.close(); }
});

for (const [coin, covered] of [['wld', false], ['btc', true]] as Array<[string, boolean]>) {
  test(`S4. /arena?coin=${coin} signed in: Set Alert ${covered ? 'enabled, no reason' : 'disabled with the reason beside it'}`, async ({ browser }) => {
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);
    test.setTimeout(150_000);
    const ctx = await signedInContext(browser, 'a'); const page = await ctx.newPage();
    try {
      await gotoSignedIn(page, `/arena?coin=${coin}&tf=1h`); await page.waitForTimeout(12_000);
      const r = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => /set alert/i.test((b.textContent || '').trim())) as HTMLButtonElement | undefined;
        const note = document.querySelector('[data-testid="alert-main-coins-only"]') as HTMLElement | null;
        return { btn: btn ? { disabled: btn.disabled, title: btn.title } : null, note: note ? (note.textContent || '').trim() : null };
      });
      console.log(`[S4] ${coin} ${JSON.stringify(r)}`);
      expect(r.btn, 'no Set Alert button for a signed-in account: nothing measured').not.toBeNull();
      if (covered) { expect(r.btn!.disabled).toBe(false); expect(r.note).toBeNull(); }
      else { expect(r.btn!.disabled, 'Set Alert is enabled on a coin outside the price-alert set').toBe(true); expect(r.note, 'the reason is not shown beside the disabled button').toBe('Price alerts cover the main coins only.'); }
    } finally { await ctx.close(); }
  });
}
