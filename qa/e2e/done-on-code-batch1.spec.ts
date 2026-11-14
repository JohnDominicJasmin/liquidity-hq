/* QA's run for the DONE-on-code rows of the 2026-11-14 release tick list (#2292), on a live build. Expectations come from the tracker text, not from the code under test.
 *   L1  #1651 B9   the landing hero clock beside "LIVE READ · BTC" is the VISITOR's clock, client-only: the server HTML carries no time there, and after mount it shows the browser's
 *                  local time (checked in two timezones with a pinned clock so a stale server time cannot pass)
 *   L2  #1651 B12  a dead price feed on a cold load: with the socket closed at once the REST backup request starts within 12 s, not after the ~36 s retry ladder
 *   L3  #1185 B8   no "priority support" claim anywhere on /upgrade (and the page itself rendered)
 *   L4  #1185 C22  every OI edge-card value on /dashboard and in the Arena rail carries its full text in `title`
 * Signed out, reads only, nothing billed. A cell that finds nothing to measure fails. */
import { test, expect, type Browser } from '@playwright/test';
import { gotoGuarded } from './_shared';

async function ctxFor(browser: Browser, o: { tz?: string; width?: number } = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.width ?? 1280, height: 900 }, timezoneId: o.tz, locale: 'en-US' });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  return ctx;
}

test.describe('#1651 B9 landing clock', () => {
  test.describe.configure({ timeout: 120_000 });
  test('L1a. the server HTML has no time beside LIVE READ', async ({ request }) => {
    const res = await request.get('/'); const html = await res.text();
    const i = html.search(/LIVE READ/i);
    console.log(`[L1a] status=${res.status()} liveReadAt=${i} len=${html.length}`);
    expect(res.status()).toBe(200);
    expect(i, 'LIVE READ is not in the server HTML: nothing measured').toBeGreaterThan(-1);
    const near = html.slice(i, i + 900).replace(/<[^>]+>/g, ' ');
    expect(near, `a clock time sits in the server HTML next to LIVE READ: ${near.slice(0, 160)}`).not.toMatch(/\b\d{2}:\d{2}\b/);
  });
  for (const [tz, hh] of [['Asia/Manila', '18'], ['America/New_York', '05']] as Array<[string, string]>) {
    test(`L1b. after mount the clock is the visitor's local time (${tz})`, async ({ browser }) => {
      const ctx = await ctxFor(browser, { tz }); const page = await ctx.newPage();
      try {
        await page.clock.install({ time: new Date('2026-11-14T10:07:00Z') });   // 18:07 Manila, 05:07 New York
        await gotoGuarded(page, '/'); await page.waitForTimeout(6_000);
        const shown = await page.evaluate(() => {
          const t = Array.from(document.querySelectorAll('span')).find(s => /LIVE READ/i.test(s.textContent || '') && /BTC/i.test(s.textContent || ''));
          const sib = t ? (t.nextElementSibling as HTMLElement | null) : null;
          return { found: !!t, clock: sib ? (sib.textContent || '').trim() : null };
        });
        console.log(`[L1b] ${tz} ${JSON.stringify(shown)}`);
        expect(shown.found, 'the LIVE READ title span was not found').toBe(true);
        expect(shown.clock, 'the clock span is empty after mount').toMatch(/^\d{2}:\d{2}$/);
        expect(shown.clock!.startsWith(hh + ':'), `clock reads ${shown.clock} in ${tz}; the pinned instant is ${hh}:0x there`).toBe(true);
      } finally { await ctx.close(); }
    });
  }
});

test.describe('#1651 B12 dead feed cold load', () => {
  test.describe.configure({ timeout: 120_000 });
  test('L2. with the socket closed at once, the REST price backup starts within 12 s', async ({ browser }) => {
    const ctx = await ctxFor(browser); const page = await ctx.newPage();
    try {
      await ctx.routeWebSocket(/binance\.com|bybit\.com/, ws => { ws.close(); });
      const t0 = Date.now(); const seen: Array<{ ms: number; url: string }> = [];
      page.on('request', r => { const u = r.url(); if (/\/api\/proxy\?.*type=(binance-24hr|bybit-tickers|ticker)|api\.binance\.com\/api\/v3\/ticker\/24hr/.test(u)) seen.push({ ms: Date.now() - t0, url: u.replace(/^https?:\/\/[^/]+/, '').slice(0, 90) }); });
      await gotoGuarded(page, '/dashboard'); await page.waitForTimeout(40_000);
      console.log(`[L2] price-backup requests (first 4 of ${seen.length}): ${JSON.stringify(seen.slice(0, 4))}`);
      expect(seen.length, 'the page never asked for REST prices: nothing measured').toBeGreaterThan(0);
      expect(seen[0].ms, `the first REST price request came at ${seen[0].ms} ms (the old retry ladder took ~36 s)`).toBeLessThan(12_000 + 3_000);
    } finally { await ctx.close(); }
  });
});

test.describe('#1185 B8 no priority-support claim', () => {
  test.describe.configure({ timeout: 120_000 });
  test('L3. /upgrade renders its features and never says priority support', async ({ browser }) => {
    const ctx = await ctxFor(browser); const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/upgrade'); await page.waitForTimeout(8_000);
      const text = await page.evaluate(() => document.body.innerText);
      console.log(`[L3] /upgrade text length=${text.length} hasPro=${/\bPro\b/.test(text)} priority=${/priority support/i.test(text)}`);
      expect(text.length, '/upgrade did not render').toBeGreaterThan(400);
      expect(text, '/upgrade must show its Pro plan (positive control)').toMatch(/\bPro\b/);
      expect(text, 'the page still claims priority support').not.toMatch(/priority support/i);
    } finally { await ctx.close(); }
  });
});

test.describe('#1185 C22 OI edge-card title', () => {
  test.describe.configure({ timeout: 120_000 });
  for (const path of ['/dashboard', '/arena?coin=btc&tf=1h']) {
    test(`L4. ${path}: every edge-card value carries its full text in title`, async ({ browser }) => {
      const ctx = await ctxFor(browser); const page = await ctx.newPage();
      try {
        await ctx.routeWebSocket(/binance\.com/, () => { /* silent */ });
        await gotoGuarded(page, path); await page.waitForTimeout(16_000);
        const m = await page.evaluate(() => Array.from(document.querySelectorAll('.edge-card-value.is-label')).map(e => ({ txt: (e.textContent || '').trim(), title: e.getAttribute('title') })));
        console.log(`[L4] ${path} n=${m.length} ${JSON.stringify(m.slice(0, 6))}`);
        expect(m.length, `no edge-card label values on ${path}: nothing measured`).toBeGreaterThan(0);
        const bad = m.filter(x => x.txt && x.title !== x.txt);
        expect(bad, `edge-card values without their full text as title: ${JSON.stringify(bad)}`).toEqual([]);
      } finally { await ctx.close(); }
    });
  }
});
