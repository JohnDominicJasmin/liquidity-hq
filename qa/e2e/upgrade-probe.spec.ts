/* PROBE (not a gate): what the checkout slot on /upgrade holds over time, signed out and as the Free fixture. */
import { test } from '@playwright/test';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';

const dump = async (page: import('@playwright/test').Page, label: string) => {
  const d = await page.evaluate(() => ({
    ids: Array.from(document.querySelectorAll('[data-testid]')).map((e) => (e as HTMLElement).dataset.testid).filter((x) => /upgrade|checkout|plans|reveal/i.test(x || '')),
    buttons: Array.from(document.querySelectorAll('button')).map((b) => ((b as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30) + (b.disabled ? ' [disabled]' : '')).filter(Boolean).slice(0, 12),
    body: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 220),
  }));
  console.log(`[UPPROBE] ${label}: ${JSON.stringify(d)}`);
};

test('PROBE upgrade signed out', async ({ page }) => {
  test.setTimeout(120_000); await page.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); } catch { /* private */ } });
  await page.goto('/upgrade', { waitUntil: 'domcontentloaded' });
  for (const ms of [3_000, 10_000, 25_000]) { await page.waitForTimeout(ms); await dump(page, `out +${ms}`); }
});

test('PROBE upgrade free fixture', async ({ browser }) => {
  test.skip(!AUTH_READY, 'no fixtures'); test.setTimeout(150_000);
  const ctx = await signedInContext(browser, 'b'); const page = await ctx.newPage();
  try { await gotoSignedIn(page, '/upgrade'); for (const ms of [3_000, 10_000, 25_000]) { await page.waitForTimeout(ms); await dump(page, `free +${ms}`); } } finally { await ctx.close(); }
});
