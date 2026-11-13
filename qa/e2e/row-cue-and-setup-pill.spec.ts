/* #2271 (selected coin row marked beyond colour) and #2272 (collapsed Setup pill beside the Ask AI button on desktop).
 *   R1  #2271 /arena coin list signed out: exactly ONE row has aria-current="true" (the selected coin), it moves when another coin is chosen, the selected row has a 3 px
 *       solid start border that is not transparent, every other row has a 3 px TRANSPARENT one, and no row's symbol moves (same x for every row)
 *   P1  #2272 the collapsed pill rule: an element with the pill's classes is injected (the real pill needs an unfinished onboarding state) and measured against the Ask AI
 *       button at 1200 and 1280 (level within 8 px, entirely left of the button, not overlapping it) and at 390 (unchanged: the phone rule wins, bottom stays above the nav)
 *   S   shots of the injected pill on /arena at 1280 light and dark, and the landing page / at 1280 and 390 in light and dark (the file is a gate file: PM renders the landing)
 * Signed out, nothing written or billed. A cell that finds nothing to measure fails. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { gotoGuarded } from './_shared';

mkdirSync('qa/.shots', { recursive: true });
async function open(browser: Browser, path: string, width: number, theme: 'dark' | 'light' = 'dark', height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
  const page = await ctx.newPage(); await gotoGuarded(page, path); await page.waitForTimeout(12_000);
  return { ctx, page };
}
const openList = async (page: Page) => {
  const trig = page.getByTestId('scanner-trigger'); await trig.waitFor({ state: 'visible', timeout: 60_000 });
  if (!(await page.locator('.scanner-flyout').isVisible().catch(() => false))) await trig.locator('div').first().click();
  await page.locator('.scanner-flyout').waitFor({ state: 'visible', timeout: 20_000 });
};
const rowsInfo = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="scanner-row-"]')).map(r => {
  const cs = getComputedStyle(r); const sym = (r.querySelector('span, div') as HTMLElement | null);
  return { id: (r.getAttribute('data-testid') || '').replace('scanner-row-', ''), cur: r.getAttribute('aria-current'), bw: cs.borderInlineStartWidth, bs: cs.borderInlineStartStyle, bc: cs.borderInlineStartColor, left: Math.round((sym ?? r).getBoundingClientRect().left) };
}));

test.describe('#2271 selected row cue', () => {
  test.describe.configure({ timeout: 150_000 });
  test('R1. exactly one row is aria-current, it moves, the bar shows on it only, nothing shifts', async ({ browser }) => {
    const { ctx, page } = await open(browser, '/arena?coin=btc&tf=1h', 1280);
    try {
      await openList(page);
      const a = await rowsInfo(page); const curA = a.filter(r => r.cur === 'true').map(r => r.id);
      console.log(`[R1] before: current=${JSON.stringify(curA)} n=${a.length} sample=${JSON.stringify(a.slice(0, 3))}`);
      expect(a.length, 'no rows in the list: nothing measured').toBeGreaterThan(5);
      expect(curA, 'exactly one row must be aria-current').toEqual(['btc']);
      const selA = a.find(r => r.id === 'btc')!; const others = a.filter(r => r.id !== 'btc');
      expect(selA.bw, 'the selected row has a 3px start border').toBe('3px'); expect(selA.bs).toBe('solid'); expect(selA.bc, 'and it is not transparent').not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      expect(others.every(r => r.bw === '3px' && /rgba\(0, 0, 0, 0\)|transparent/.test(r.bc)), 'every other row has a transparent 3px border').toBe(true);
      expect(new Set(a.map(r => r.left)).size, 'a row content starts at a different x (a row shifted)').toBe(1);
      await page.locator('[data-testid="scanner-row-eth"]').first().click(); await page.waitForTimeout(1500);
      if (!(await page.locator('.scanner-flyout').isVisible().catch(() => false))) await openList(page);
      const b = await rowsInfo(page); const curB = b.filter(r => r.cur === 'true').map(r => r.id);
      console.log(`[R1] after choosing ETH: current=${JSON.stringify(curB)}`);
      expect(curB, 'aria-current must move to the newly chosen coin').toEqual(['eth']);
    } finally { await ctx.close(); }
  });
});

const PILL = `(() => { const d = document.createElement('div'); d.className = 'ob-checklist ob-checklist-mini'; d.id = 'qa-pill'; d.textContent = 'Setup 2/5'; d.style.cssText = 'position:fixed;padding:8px 12px;font-size:12px;z-index:50;background:#222;color:#fff'; document.body.appendChild(d); })()`;
test.describe('#2272 Setup pill position', () => {
  test.describe.configure({ timeout: 150_000 });
  for (const [width, desktop] of [[1200, true], [1280, true], [390, false]] as Array<[number, boolean]>) {
    test(`P1. collapsed pill at ${width}: ${desktop ? 'level with the Ask AI button, left of it, not overlapping' : 'unchanged on phones'}`, async ({ browser }) => {
      const { ctx, page } = await open(browser, '/arena', width);
      try {
        await page.evaluate(PILL); await page.waitForTimeout(500);
        const m = await page.evaluate(() => {
          const pill = document.getElementById('qa-pill')!.getBoundingClientRect(); const fabEl = document.querySelector('[data-testid="grok-launcher"]') as HTMLElement | null; const fab = fabEl?.getBoundingClientRect();
          const cs = getComputedStyle(document.getElementById('qa-pill')!);
          return { pill: { l: Math.round(pill.left), r: Math.round(pill.right), t: Math.round(pill.top), b: Math.round(pill.bottom) }, fab: fab ? { l: Math.round(fab.left), r: Math.round(fab.right), t: Math.round(fab.top), b: Math.round(fab.bottom) } : null, bottom: cs.bottom, right: cs.right, vh: window.innerHeight, vw: window.innerWidth };
        });
        console.log(`[P1] ${width} ${JSON.stringify(m)}`);
        expect(m.fab, 'no Ask AI button on the page: nothing to compare against').not.toBeNull();
        if (desktop) {
          const pc = (m.pill.t + m.pill.b) / 2, fc = (m.fab!.t + m.fab!.b) / 2;
          expect(Math.abs(pc - fc), `the pill is not level with the Ask AI button (centres ${pc} vs ${fc})`).toBeLessThanOrEqual(8);
          expect(m.pill.r, 'the pill is not entirely left of the Ask AI button').toBeLessThanOrEqual(m.fab!.l);
        } else {
          expect(parseFloat(m.bottom), 'on phones the pill keeps clear of the bottom nav (it was not moved to bottom:38px)').toBeGreaterThan(60);
        }
      } finally { await ctx.close(); }
    });
  }
});

test.describe('#2272 shots', () => {
  test.describe.configure({ timeout: 150_000 });
  for (const th of ['dark', 'light'] as const) {
    test(`S. arena with the injected pill at 1280 ${th}`, async ({ browser }) => { const { ctx, page } = await open(browser, '/arena', 1280, th); try { await page.evaluate(PILL); await page.waitForTimeout(500); await page.screenshot({ path: `qa/.shots/pill-arena-1280-${th}.png` }); } finally { await ctx.close(); } });
    for (const w of [1280, 390]) test(`S. landing / at ${w} ${th}`, async ({ browser }) => { const { ctx, page } = await open(browser, '/', w, th); try { await page.screenshot({ path: `qa/.shots/land-${w}-${th}.png`, fullPage: true }); } finally { await ctx.close(); } });
  }
});
