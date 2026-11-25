/* QA #1651 owner item 35 on a DEPLOYED site, signed out, read-only: what the calendar page and the pages that warn about events show from the stored copy. GETs only; the AI is fenced. Prints [F35] lines. */
import { test } from '@playwright/test';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test('F35 calendar rows and event warnings', async ({ browser }) => {
  test.setTimeout(420_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'UTC' });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage();
  try {
    await installPaidAiFence(page);
    for (const path of ['/econ-calendar', '/dashboard', '/arena', '/news']) {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.waitForTimeout(25_000);
      const text = await page.evaluate(() => (document.body.innerText || '').replace(/[ \t]+/g, ' '));
      const flat = text.replace(/\s+/g, ' ');
      const warn = [...flat.matchAll(/.{0,70}(imminent|releasing now|within 30 min|happening now|upcoming:|next high-impact event|macro risk|just passed).{0,90}/gi)].map((m) => m[0]);
      console.log(`[F35] ${new Date().toISOString()} ${path}: warnings=${warn.length ? JSON.stringify(warn.slice(0, 6)) : 'none'} estimatedWords=${(flat.match(/\bestimated\b|~\d{1,2}:\d\d/gi) ?? []).length}`);
      if (path === '/econ-calendar') {
        console.log(`[F35] calendar text: ${JSON.stringify(flat.slice(0, 1500))}`);
        const weekend = flat.match(/\b(Sat|Sun|Saturday|Sunday)\b[^A-Za-z]{0,4}(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?[^A-Za-z]{0,6}/g);
        console.log(`[F35] weekend day names on the page: ${JSON.stringify(weekend?.slice(0, 10) ?? null)}`);
      }
    }
  } finally { await ctx.close().catch(() => {}); }
});
