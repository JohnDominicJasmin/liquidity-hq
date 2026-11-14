/* WHICH NODE IS INSERTED ABOVE THE CHART WHEN A SIGNED-IN VISITOR LOADS /arena? (cls-arena-gate.spec.ts: signed in at 390 = 0.16-0.34, arena-ws pushed 91 px; at 1280 pushed 53 px.)
 * Signed in as fixture A on the DEPLOYED site (base_url), analytics consent pre-answered so the cookie bar is out of the picture; at 390 and 1280, three loads each. Prints every node inserted into the page after 1 s whose box ends
 * above the chart workspace's top (tag, classes, test id, text, height, top, parent, time) and every layout shift with its sources. Reads only (settings writes stubbed). */
import { test } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

test.describe('signed-in /arena insert probe', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON); test.describe.configure({ timeout: 300_000, retries: 0 });
  for (const width of [390, 1280]) test(`inserts above the chart at ${width}`, async ({ browser }) => {
    for (let run = 1; run <= 3; run++) {
      const ctx = await signedInContext(browser, 'a');
      await ctx.addInitScript(() => {
        try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem('lhq_lang_v1', 'en'); } catch { /* private */ }
        const w = window as unknown as { __added: unknown[]; __cls: unknown[] }; w.__added = []; w.__cls = []; const t0 = performance.now();
        const d = (n: Node | null) => { const el = n && n.nodeType === 1 ? (n as HTMLElement) : (n && n.parentElement) || null; if (!el) return { tag: '(gone)', cls: '', testid: '', text: '' }; return { tag: el.tagName.toLowerCase(), cls: (typeof el.className === 'string' ? el.className : '').split(/\s+/).slice(0, 3).join('.'), testid: el.getAttribute('data-testid') || '', text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) }; };
        new MutationObserver((muts) => {
          if (performance.now() - t0 < 1000) return; const ws = document.querySelector('.arena-ws') as HTMLElement | null; const wsTop = ws ? ws.getBoundingClientRect().top + scrollY : 99999;
          for (const m of muts) for (const n of Array.from(m.addedNodes)) { if (n.nodeType !== 1) continue; const el = n as HTMLElement; const b = el.getBoundingClientRect(); if (b.height < 10 || el.closest('svg,.gchat-panel,.gchat-fab')) continue; if (b.top + scrollY < wsTop + 4) (w.__added as unknown[]).push({ t: Math.round(performance.now() - t0), what: d(el), h: Math.round(b.height), top: Math.round(b.top + scrollY), parent: d(el.parentElement).tag + '.' + d(el.parentElement).cls }); }
        }).observe(document, { childList: true, subtree: true });
        const r = (x: DOMRectReadOnly) => [Math.round(x.x), Math.round(x.y), Math.round(x.width), Math.round(x.height)];
        new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as Array<{ value: number; startTime: number; hadRecentInput: boolean; sources?: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> }>) (w.__cls as unknown[]).push({ v: +e.value.toFixed(4), t: Math.round(e.startTime), s: (e.sources || []).map((s) => ({ ...d(s.node), p: r(s.previousRect), c: r(s.currentRect) })) }); }).observe({ type: 'layout-shift', buffered: true });
      });
      const page = await ctx.newPage(); await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await page.route(/\/api\/settings(\?|$)/, async route => { const q = route.request(); if (q.method() === 'GET') return route.fallback(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: [], rejected: [], settings: null }) }); });
      try {
        await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.waitForTimeout(10_000);
        const r = await page.evaluate(() => ({ added: (window as unknown as { __added: unknown[] }).__added, cls: (window as unknown as { __cls: unknown[] }).__cls }));
        console.log(`[INS] ${width} load ${run} ADDED ${JSON.stringify(r.added).slice(0, 2500)}`);
        console.log(`[INS] ${width} load ${run} SHIFTS ${JSON.stringify((r.cls as Array<{ v: number; t: number; s: Array<Record<string, unknown>> }>).filter(x => x.v >= 0.01).map(x => ({ v: x.v, t: x.t, s: x.s.slice(0, 4).map(y => `${y.tag}.${y.cls}[${y.testid}] "${y.text}" ${JSON.stringify(y.p)}->${JSON.stringify(y.c)}`) }))).slice(0, 2500)}`);
      } finally { await ctx.close(); }
    }
  });
});
