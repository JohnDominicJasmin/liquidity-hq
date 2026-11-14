/* A PROBE, NOT A GATE: which elements shift on /arena? (release run 43595134120: perf.spec /arena CLS 0.189 > 0.1.)
 * Loads /arena (anonymous, the same way perf.spec does) several times with a layout-shift observer installed from document start, and prints for EVERY shift entry its value, time, and each source element
 * (tag, id, data-testid, first classes, text start, previous and current rectangle). It never fails on a number: the output is the evidence for Dev.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/cls-arena-probe.spec.ts -f project=desktop */
import { test } from '@playwright/test';
import { gotoGuarded } from './_shared';

type Src = { tag: string; id: string; testid: string; cls: string; text: string; prev: number[]; cur: number[] };
type Shift = { value: number; t: number; hadRecentInput: boolean; sources: Src[] };

test.describe('arena layout shift probe', () => {
  test.describe.configure({ timeout: 240_000 });
  test.beforeEach(({ }, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'one viewport is enough'); });

  for (let run = 1; run <= 6; run++) {
    test(`/arena shifts, load ${run}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await ctx.addInitScript(() => {
        const w = window as unknown as { __cls: unknown[] };
        w.__cls = [];
        const d = (n: Node | null) => {
          const el = n && n.nodeType === 1 ? (n as HTMLElement) : (n && n.parentElement) || null;
          if (!el) return { tag: '(gone)', id: '', testid: '', cls: '', text: '' };
          return { tag: el.tagName.toLowerCase(), id: el.id || '', testid: el.getAttribute('data-testid') || '', cls: (typeof el.className === 'string' ? el.className : '').split(/\s+/).slice(0, 3).join('.'), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) };
        };
        const r = (x: DOMRectReadOnly) => [Math.round(x.x), Math.round(x.y), Math.round(x.width), Math.round(x.height)];
        try {
          new PerformanceObserver((l) => {
            for (const e of l.getEntries() as unknown as Array<{ value: number; startTime: number; hadRecentInput: boolean; sources?: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> }>) {
              (w.__cls as unknown[]).push({ value: +e.value.toFixed(4), t: Math.round(e.startTime), hadRecentInput: e.hadRecentInput, sources: (e.sources || []).map((s) => ({ ...d(s.node), prev: r(s.previousRect), cur: r(s.currentRect) })) });
            }
          }).observe({ type: 'layout-shift', buffered: true });
        } catch { /* unsupported */ }
      });
      const page = await ctx.newPage();
      try {
        await gotoGuarded(page, '/arena'); await page.waitForTimeout(2500 + 1200);
        const shifts = await page.evaluate(() => (window as unknown as { __cls: Shift[] }).__cls);
        const total = +shifts.filter((s) => !s.hadRecentInput).reduce((a, s) => a + s.value, 0).toFixed(3);
        // eslint-disable-next-line no-console
        console.log(`[CLS] load ${run}: total ${total} over ${shifts.length} entries`);
        for (const s of shifts) {
          // eslint-disable-next-line no-console
          console.log(`[CLS]   +${s.value} at ${s.t}ms${s.hadRecentInput ? ' (recent input, not counted)' : ''}: ${s.sources.map((x) => `${x.tag}${x.id ? '#' + x.id : ''}${x.testid ? '[' + x.testid + ']' : ''}${x.cls ? '.' + x.cls : ''} "${x.text}" ${JSON.stringify(x.prev)}->${JSON.stringify(x.cur)}`).join(' | ') || '(no sources)'}`);
        }
      } finally { await ctx.close(); }
    });
  }
});
