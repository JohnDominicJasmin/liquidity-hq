/* QA on qa 2d2677f: #2842 (changelog), #2847 (65 in the copy), #2848 (chart focus ring, with PM's screenshots), #2849 (the named coin drop-down). Dispatch-only; prints [E] lines. */
import { test, expect, type Browser } from '@playwright/test';
import { join } from 'node:path';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test.describe.configure({ timeout: 240_000 });
async function anon(browser: Browser, width: number, theme: string, lang = 'en') {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
  await ctx.addInitScript(([t, l]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [theme, lang]);
  return ctx;
}

test('E0 version and changelog', async ({ browser, request }) => {
  const v = await (await request.get('/api/version', { timeout: 150_000 })).json() as { commit: string };
  const ctx = await anon(browser, 1280, 'dark'); const page = await ctx.newPage();
  try {
    await installPaidAiFence(page); await page.goto('/changelog', { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(8_000);
    const top = await page.evaluate(() => { const first = document.querySelector('main ul, main ol'); const block = first?.closest('section, article, div'); return { head: (block as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').slice(0, 120) ?? null, lines: Array.from(first?.querySelectorAll('li') ?? []).map((l) => (l as HTMLElement).innerText.trim()) }; });
    console.log(`[E] version ${v.commit}; changelog top: ${JSON.stringify(top.head)} lines=${top.lines.length} first=${JSON.stringify(top.lines[0] ?? null)} last=${JSON.stringify(top.lines.at(-1) ?? null)}`);
    expect.soft(top.lines.length).toBe(10); expect.soft(top.head ?? '').toMatch(/27 November 2026|2026-11-27|November 27, 2026/);
  } finally { await ctx.close().catch(() => {}); }
});

for (const lang of ['en', 'ko'] as const) {
  test(`E47 the squeeze score in the copy, ${lang}`, async ({ browser }) => {
    const ctx = await anon(browser, 1280, 'dark', lang); const page = await ctx.newPage();
    try {
      await installPaidAiFence(page);
      for (const path of ['/help', '/about', '/scanner']) {
        await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(9_000);
        let t = await page.evaluate(() => document.body.textContent?.replace(/\s+/g, ' ') ?? '');
        if (path === '/help') { /* answers are only in the page once opened */
          t = ''; const q = page.locator('main button[aria-expanded]'); const n = await q.count();
          for (let i = 0; i < n; i++) { await q.nth(i).click().catch(() => {}); await page.waitForTimeout(150); const now = await page.evaluate(() => document.querySelector('main')?.textContent?.replace(/\s+/g, ' ') ?? ''); if (!t.includes(now)) t += ' ' + now; }
          console.log(`[E] ${lang} /help: opened ${n} questions`);
        }
        const hits = [...t.matchAll(/.{0,50}(?<![\d.])(65|70)(\+| or (?:above|higher)| 이상).{0,20}/g)].map((m) => m[0]);
        console.log(`[E] ${lang} ${path}: ${hits.length ? JSON.stringify(hits.slice(0, 3)) : 'no score sentence found'}`);
        expect.soft(hits.join(' '), `${lang} ${path}`).toMatch(/65/); expect.soft(hits.join(' '), `${lang} ${path}`).not.toMatch(/70(\+| or | 이상)/);
      }
    } finally { await ctx.close().catch(() => {}); }
  });
}

for (const width of [390, 1280] as const) for (const theme of ['dark', 'light'] as const) {
  test(`E48 the chart's keyboard focus, ${width} ${theme}`, async ({ browser }) => {
    const ctx = await anon(browser, width, theme); const page = await ctx.newPage();
    try {
      await installPaidAiFence(page); await page.goto('/arena', { waitUntil: 'domcontentloaded', timeout: 150_000 });
      const host = page.locator('.klc-canvas').first(); await host.waitFor({ state: 'visible', timeout: 90_000 }); await page.waitForTimeout(15_000);
      let reached = false; for (let i = 0; i < 120 && !reached; i++) { await page.keyboard.press('Tab'); reached = await host.evaluate((h) => !!h.querySelector(':focus')); }
      await page.waitForTimeout(600);
      const ring = await host.evaluate((h) => { const a = getComputedStyle(h, '::after'); return a.content !== 'none' ? `${a.borderTopWidth} ${a.borderTopStyle} ${a.borderTopColor}` : null; });
      console.log(`[E] chart focus ${width} ${theme}: reached=${reached} ring=${ring}`);
      expect.soft(ring ?? '').toMatch(/^2px solid/);
      await host.scrollIntoViewIfNeeded(); await page.screenshot({ path: `qa/.shots/pr2848-chart-focus-qa-${width}-${theme}.png` });
    } finally { await ctx.close().catch(() => {}); }
  });
}

test('E49 the Settings coin drop-down is named', async ({ browser }) => {
  test.skip(!AUTH_READY, 'no fixtures on this host');
  for (const [width, theme] of [[1280, 'dark'], [390, 'light']] as const) {
    const ctx = await signedInContext(browser, 'a', { viewport: { width, height: 900 }, theme }); const page = await ctx.newPage();
    try {
      await installPaidAiFence(page); await gotoSignedIn(page, '/settings'); await page.waitForTimeout(15_000);
      const names = await page.locator('[role="combobox"].cms-trigger').evaluateAll((e) => e.map((x) => x.getAttribute('aria-label')));
      await page.addScriptTag({ path: join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js') });
      const v = await page.evaluate(async () => { const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: Array<{ id: string; nodes: unknown[] }> }> } }).axe; const r = await ax.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }); return r.violations.map((x) => `${x.id} x${x.nodes.length}`); });
      console.log(`[E] settings ${width} ${theme}: comboboxNames=${JSON.stringify(names)} axe=${v.length ? v.join(', ') : 'clean'}`);
      expect.soft(names.every(Boolean) && names.length > 0).toBe(true); expect.soft(v).toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  }
});
