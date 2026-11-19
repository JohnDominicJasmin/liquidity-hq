/* RELEASE #2622 TRIAGE (tf-gating CONTROL, mobile: "read 1 timeframe rows, expected >= 4"). Facts only: signed in as the Pro fixture on /arena, at 390 and 1280, with the tf-gating spec's own pins (RSI route + 15m klines) and WITHOUT them (the deployed build's real data).
 * For each variant prints: the Multi-TF card's text, the timeframe rows the tf-gating selector finds (label, blur, colour), the number of rows the card renders, and which timeframe labels appear anywhere in the card. Nothing is asserted except that the card renders. Read-only. */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
async function pinBullish(page: Page) {
  await page.route('**/api/market/rsi**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rsi: { btc: { rsi5m: 75, rsi1h: 69, rsi4h: 38, rsiDaily: 51, rsiWeekly: 26, rsiMonthly: 29 } } }) }));
  await page.route('**/api/market/klines**interval=15**', (route) => {
    const list = Array.from({ length: 100 }, (_, i) => { const c = 1000 + i; return [String(1_700_000_000_000 + i * 900_000), String(c - 1), String(c + 1), String(c - 2), String(c), '10', '10000']; }).reverse();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { list } }) });
  });
}
const readRows = (page: Page) => page.evaluate(() => {
  const out: Record<string, { blur: string; colour: string }> = {};
  for (const row of Array.from(document.querySelectorAll('div'))) {
    const kids = Array.from(row.children); if (kids.length < 3) continue;
    const label = (kids[0].textContent || '').trim(); if (!/^(5m|15m|1h|4h|1D|1W|1M)$/.test(label) || out[label]) continue;
    const value = kids[2] as HTMLElement, cs = getComputedStyle(value); let blur = cs.filter;
    for (let n: HTMLElement | null = value, i = 0; n && i < 3 && (!blur || blur === 'none'); n = n.parentElement, i++) blur = getComputedStyle(n).filter;
    out[label] = { blur: blur || 'none', colour: cs.color };
  }
  return out;
});
const cardInfo = (page: Page) => page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.edge-card')).filter((c) => /MULTI-TIMEFRAME ALIGNMENT/i.test((c as HTMLElement).innerText || '')) as HTMLElement[];
  const c = cards[0]; if (!c) return null;
  const grids = Array.from(c.querySelectorAll('div')).filter((d) => getComputedStyle(d).display === 'grid' && d.children.length === 4);
  return { text: (c.innerText || '').replace(/\s+/g, ' ').slice(0, 400), gridRows: grids.length, labels: grids.map((g) => (g.children[0].textContent || '').trim()) };
});

for (const width of [390, 1280]) for (const [pinned, coinUrl] of [[true, ''], [true, '?coin=btc'], [false, '']] as const) {
  test(`MTF probe ${width} ${pinned ? 'with the tf-gating pins' : 'real data'}${coinUrl ? ' ' + coinUrl : ''}`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await signedInContext(browser, 'a'); const page = await ctx.newPage(); await page.setViewportSize({ width, height: width < 600 ? 844 : 900 }); await installPaidAiFence(page);
    await page.addInitScript(() => { try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    try {
      if (pinned) await pinBullish(page);
      await gotoSignedIn(page, `/arena${coinUrl}`); await page.waitForTimeout(9_000);
      const info = await cardInfo(page); expect(info, 'the Multi-TF card did not render').not.toBeNull();
      const rows = await readRows(page);
      console.log(`[MTF] ${width} ${pinned ? 'pinned' : 'real'}${coinUrl}: selector rows ${JSON.stringify(rows)} · card grid rows ${info!.gridRows} labels ${JSON.stringify(info!.labels)} · text "${info!.text.slice(0, 260)}"`);
      await page.screenshot({ path: `qa/.shots/mtf-${width}-${pinned ? 'pinned' : 'real'}${coinUrl ? '-btc' : ''}.png` }).catch(() => {});
    } finally { await ctx.close().catch(() => {}); }
  });
}
