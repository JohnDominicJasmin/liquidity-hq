/* HOW LONG IS "Checking your plan…" VISIBLE on /arena (decides #2414). Signed in as the DEV fixtures (Pro = A, Free = B): six fresh loads each, normal network, a MutationObserver from document start stamps the first and last moment the text is in the DOM (anywhere on the page). Prints the per-load window and the median. Asserts nothing. */
import { test } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
test.skip(!AUTH_READY, AUTH_SKIP_REASON);

const OBSERVER = () => {
  const w = window as unknown as { __pc: { first: number | null; last: number | null; seen: number } }; w.__pc = { first: null, last: null, seen: 0 };
  const probe = () => { const has = (document.body?.innerText || '').includes('Checking your plan'); const t = Math.round(performance.now()); if (has) { if (w.__pc.first == null) w.__pc.first = t; w.__pc.last = t; w.__pc.seen++; } };
  const mo = new MutationObserver(probe); const start = () => { try { mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true }); } catch { /* none */ } };
  start(); setInterval(probe, 20);
};
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)) : null; };

for (const who of ['a', 'b'] as const) {
  test(`PC:${who === 'a' ? 'pro' : 'free'}: the plan-check window on /arena, six loads`, async ({ browser }) => {
    test.setTimeout(300_000); const wins: number[] = []; const rows: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const ctx = await signedInContext(browser, who, { viewport: { width: 1280, height: 900 } }); await ctx.addInitScript(OBSERVER);
      await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
      const page = await ctx.newPage();
      try {
        await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.waitForTimeout(12_000);
        const r = await page.evaluate(() => (window as unknown as { __pc: { first: number | null; last: number | null; seen: number } }).__pc);
        const win = r.first == null || r.last == null ? 0 : r.last - r.first + 20; wins.push(win); rows.push(`#${i}: first ${r.first}ms last ${r.last}ms window ${win}ms (seen ${r.seen})`);
      } finally { await ctx.close(); }
    }
    console.log(`[PLANCHK] ${who === 'a' ? 'pro' : 'free'} windows ${JSON.stringify(wins)} median ${median(wins)} ms | ${rows.join(' | ')}`);
  });
}
