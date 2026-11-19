/* RU LAYOUT-SHIFT SIGN-OFF PROBE, READ-ONLY (signed out, no account, nothing written): /arena in Russian at 360 px, TWELVE fresh loads, the layout-shift entries of every load with their source nodes (outerHTML start + previous / current rect) printed for any load over 0.1.
 * Built to compare a deployed STAGING build with PRODUCTION when the signed-in cell (fixtures exist on the DEV project only) cannot run on production.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f base_url=<site> -f project=desktop -f "spec=qa/e2e/cls-ru-signed-out.spec.ts"
 * It FAILS when the worst load is over 0.1 (the owner's rule is about any load). */
import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';

type Src = { tag: string; html: string; prev: number[]; cur: number[] };
type Shift = { value: number; t: number; hadRecentInput: boolean; sources: Src[] };
const OBSERVER = () => {
  const w = window as unknown as { __cls: unknown[] }; w.__cls = [];
  const r = (x: DOMRectReadOnly) => [Math.round(x.x), Math.round(x.y), Math.round(x.width), Math.round(x.height)];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as unknown as Array<{ value: number; startTime: number; hadRecentInput: boolean; sources?: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> }>) {
        (w.__cls as unknown[]).push({ value: +e.value.toFixed(4), t: Math.round(e.startTime), hadRecentInput: e.hadRecentInput,
          sources: (e.sources || []).map((s) => { const el = s.node && s.node.nodeType === 1 ? (s.node as HTMLElement) : (s.node && s.node.parentElement) || null; return { tag: el ? el.tagName.toLowerCase() : '(gone)', html: el ? el.outerHTML.replace(/\s+/g, ' ').slice(0, 120) : '', prev: r(s.previousRect), cur: r(s.currentRect) }; }) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* unsupported */ }
};

test('RU 360 signed out: 12 loads, worst CLS at most 0.1, sources named', async ({ browser }) => {
  test.setTimeout(900_000); const totals: number[] = []; const detail: string[] = [];
  for (let i = 1; i <= 12; i++) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } }); await ctx.addInitScript(OBSERVER);
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'ru'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/arena'); await page.waitForTimeout(9_000);
      const shifts = await page.evaluate(() => (window as unknown as { __cls: Shift[] }).__cls); const total = +shifts.filter((s) => !s.hadRecentInput).reduce((a, s) => a + s.value, 0).toFixed(3); totals.push(total);
      console.log(`[CLSRU] load ${i}: ${total} over ${shifts.length} entries`);
      if (total > 0.1) for (const s of shifts.filter((x) => !x.hadRecentInput && x.value >= 0.005)) { const line = `load ${i} +${s.value} at ${s.t}ms: ${s.sources.map((x) => `<${x.tag}> "${x.html}" [${x.prev.join(',')}]->[${x.cur.join(',')}]`).join(' | ')}`; detail.push(line); console.log(`[CLSRU] ${line}`); }
    } finally { await ctx.close(); }
  }
  const worst = Math.max(...totals); console.log(`[CLSRU] SUMMARY loads=${JSON.stringify(totals)} worst=${worst}`);
  expect(worst, `RU 360 signed out: worst CLS ${worst} of ${JSON.stringify(totals)}\n${detail.join('\n')}`).toBeLessThanOrEqual(0.1);
});
