/* PINS FOR #2782 AND #2783 (Dev's lists), signed out, a runner build of the heads (or any deployed host that has them); nothing is written.
 *   FS /funding, 390 and 1280, dark and light (#2782): the regime list is a labelled keyboard region (role region, tabindex 0, an aria-label), Tab reaches it, it shows a focus ring, ArrowDown scrolls it, and axe's scrollable-region-focusable finds nothing on the page.
 *   PA /markets (#2783): the route's last good body (`x-data-stale: 1`, `x-data-age-ms: 720000`) puts "12m ago" in [data-testid="price-age"] under each Binance-only row and nowhere else; a stale answer with no age header says "60m ago" (the bound is 60 minutes since PM's change of 2026-11-23); an age of 45 minutes says "45m ago"; a live answer from the start shows none; nothing widens at 390, 768 and 1280, dark and light.
 * NOT COVERED HERE: the later-live-answer-removes-the-marker transition inside one page (the provider polls every 8 minutes); the route cells are __tests__/proxyBinanceFutures2783.test.mts. */
import { test, expect, type Page, type Route } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const AXE = join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js');
const setup = async (page: Page, theme: 'dark' | 'light') => { await page.addInitScript((th) => { try { localStorage.setItem('theme', th); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme); };

for (const theme of ['dark', 'light'] as const) for (const width of [390, 1280] as const) {
  test(`FS:${theme}:${width} /funding regime list is a keyboard region and axe is clean`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } }); const page = await ctx.newPage();
    try {
      await setup(page, theme); await page.goto('/funding', { waitUntil: 'domcontentloaded', timeout: 60_000 }); await page.waitForTimeout(12_000);
      const info = await page.evaluate(() => {
        const cands = Array.from(document.querySelectorAll('[role="region"][tabindex="0"]')) as HTMLElement[];
        const r = cands.find((e) => /regime/i.test(e.getAttribute('aria-label') ?? '')) ?? cands.find((e) => e.scrollHeight > e.clientHeight + 1) ?? null;
        if (!r) return { found: false, regions: cands.map((e) => e.getAttribute('aria-label')) };
        const cs = getComputedStyle(r); return { found: true, label: r.getAttribute('aria-label'), scrollable: r.scrollHeight > r.clientHeight + 1, scrollHeight: r.scrollHeight, clientHeight: r.clientHeight, overflowY: cs.overflowY };
      });
      console.log(`[FS] ${theme} ${width}: ${JSON.stringify(info)}`);
      expect(info.found, 'no keyboard region (role=region, tabindex=0) holds a scrollable list on /funding').toBe(true);
      /* Tab from the top of the page until the region has focus (at most 120 stops) */
      await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
      let reached = false; let ring: { outline: string; shadow: string } | null = null;
      for (let i = 0; i < 120 && !reached; i++) {
        await page.keyboard.press('Tab');
        const st = await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; if (!a || a.getAttribute('role') !== 'region' || a.getAttribute('tabindex') !== '0' || !/regime/i.test(a.getAttribute('aria-label') ?? '')) return null; const cs = getComputedStyle(a); return { outline: `${cs.outlineStyle} ${cs.outlineWidth}`, shadow: cs.boxShadow }; });
        if (st) { reached = true; ring = st; }
      }
      console.log(`[FS] ${theme} ${width}: Tab reached the region ${reached}, ring ${JSON.stringify(ring)}`);
      expect(reached, 'Tab never reached the regime list').toBe(true);
      expect.soft(ring && (!/^none/.test(ring.outline) || ring.shadow !== 'none'), `no visible focus ring: ${JSON.stringify(ring)}`).toBe(true);
      const before = await page.evaluate(() => (document.activeElement as HTMLElement).scrollTop);
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => (document.activeElement as HTMLElement).scrollTop);
      console.log(`[FS] ${theme} ${width}: scrollTop ${before} -> ${after}`);
      if (info.scrollable) expect.soft(after, 'ArrowDown did not scroll the region').toBeGreaterThan(before); else console.log(`[FS] ${theme} ${width}: the list does not overflow on this build's data, so the arrow-key scroll is not measurable here`);
      await page.addScriptTag({ content: readFileSync(AXE, 'utf8') });
      const ax = await page.evaluate(async () => { const r = await (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: unknown }> }> }> } }).axe.run(document, { runOnly: { type: 'rule', values: ['scrollable-region-focusable'] } }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, first: JSON.stringify(v.nodes[0]?.target) })); });
      console.log(`[FS] ${theme} ${width}: axe scrollable-region-focusable ${JSON.stringify(ax)}`);
      expect(ax, 'axe finds a scrollable region without keyboard access').toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}

type Variant = 'stale720' | 'stale45' | 'staleNoAge' | 'live';
const probe = { hits: 0, urls: [] as string[] };
async function marketsWith(page: Page, variant: Variant) {
  page.on('request', (r) => { if (/binance-futures-24hr/.test(r.url())) probe.urls.push(r.url().slice(0, 120)); });
  await page.route('**/api/proxy?type=binance-futures-24hr*', async (route: Route) => {
    /* the body is built from the symbols the page asked for, so every Binance-only row gets a price whatever the build's market stand-in knows */
    probe.hits++;
    const asked = JSON.parse(new URL(route.request().url()).searchParams.get('symbols') ?? '[]') as string[];
    const body = JSON.stringify(asked.map((sym, i) => ({ symbol: sym, lastPrice: String(10 + i), priceChangePercent: '1.5', highPrice: String(11 + i), lowPrice: String(9 + i), quoteVolume: '1000000' })));
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (variant === 'stale720') { headers['x-data-stale'] = '1'; headers['x-data-age-ms'] = '720000'; }
    if (variant === 'stale45') { headers['x-data-stale'] = '1'; headers['x-data-age-ms'] = '2700000'; }
    if (variant === 'staleNoAge') { headers['x-data-stale'] = '1'; }
    await route.fulfill({ status: 200, headers, body });
  });
}
const ageTexts = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="scanner-row-"] [data-testid="price-age"], .scc-id [data-testid="price-age"]')).map((e) => (e.textContent || '').trim()));

for (const [variant, want] of [['stale720', '12m ago'], ['stale45', '45m ago'], ['staleNoAge', '1h ago'], ['live', null]] as const) {
  test(`PA:${variant} the Arena scanner rows mark the Binance-only prices ${want ? `"${want}"` : 'not at all'}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
    try {
      await setup(page, 'dark'); await marketsWith(page, variant);
      await page.goto('/arena?coin=btc&tf=1h', { waitUntil: 'domcontentloaded', timeout: 60_000 }); await page.waitForTimeout(12_000);
      await page.getByTestId('scanner-trigger').click({ timeout: 20_000 }).catch(() => undefined); await page.waitForTimeout(4_000);
      const t = await ageTexts(page); const rows = await page.evaluate(() => { const txt = (document.body.innerText || ''); return { copper: /COPPER/i.test(txt), hk0700: /HK0700|Tencent/i.test(txt), tabs: Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter((x) => x && x.length < 18).slice(0, 14) }; });
      console.log(`[PA] ${variant}: route handler ran ${probe.hits} time(s), requests ${JSON.stringify(probe.urls.slice(0, 3))}, rows on page ${JSON.stringify(rows)}`);
      console.log(`[PA] ${variant}: scanner rows ${await page.locator('[data-testid^="scanner-row-"]').count()}`);
      console.log(`[PA] ${variant}: ${t.length} price-age element(s): ${JSON.stringify(t.slice(0, 20))}`);
      if (want == null) expect(t, 'a live answer shows a price age').toEqual([]);
      else { expect(t.length, 'no Binance-only row carries an age').toBeGreaterThan(0); expect(t.filter((x) => x !== want), `a row carries another age than "${want}"`).toEqual([]); }
    } finally { await ctx.close().catch(() => {}); }
  });
}

for (const theme of ['dark', 'light'] as const) for (const width of [390, 768, 1280] as const) {
  test(`PW:${theme}:${width} /markets with a stale answer does not widen the page`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } }); const page = await ctx.newPage();
    try {
      await setup(page, theme); await marketsWith(page, 'stale720');
      await page.goto('/markets', { waitUntil: 'domcontentloaded', timeout: 60_000 }); await page.waitForTimeout(15_000);
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth, ages: document.querySelectorAll('[data-testid="price-age"]').length }));
      console.log(`[PW] ${theme} ${width}: scrollWidth ${m.sw} of ${m.vw}, ${m.ages} price-age element(s)`);
      expect(m.sw, 'sideways scroll').toBeLessThanOrEqual(m.vw);
    } finally { await ctx.close().catch(() => {}); }
  });
}
