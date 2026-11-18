/* PROBE for the toolbar late-label fix (Dev branch fix/arena-toolbar-late-label-shift): /arena in Russian at 360 px as the Pro fixture (language ru in the settings row), SIX loads.
 * Per load: the chart toolbar (.klc-toolbar) height, number of ROWS (distinct tops of its direct controls), the Draw-Structure group (.klc-ds-wrap) width, sampled at 0.4 s, 1.6 s and 5 s after load, and the page's layout-shift total with the source nodes of any shift over 0.01.
 * It asserts nothing: it reports so the row count (2 or 3) and the group widths are measured, not assumed. */
import { test } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
const OBSERVER = () => {
  const w = window as unknown as { __cls: Array<{ v: number; t: number; src: string[] }> }; w.__cls = [];
  const r = (x: DOMRectReadOnly) => [Math.round(x.x), Math.round(x.y), Math.round(x.width), Math.round(x.height)].join(',');
  try { new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as Array<{ value: number; startTime: number; hadRecentInput: boolean; sources?: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> }>) { if (e.hadRecentInput) continue; w.__cls.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime), src: (e.sources || []).map((s) => { const el = s.node && s.node.nodeType === 1 ? (s.node as HTMLElement) : (s.node && s.node.parentElement) || null; return `${el ? el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 2).join('.') : '(gone)'} [${r(s.previousRect)}]->[${r(s.currentRect)}]`; }) }); } }).observe({ type: 'layout-shift', buffered: true }); } catch { /* unsupported */ }
};
const toolbar = () => {
  const tb = document.querySelector('.klc-toolbar') as HTMLElement | null; if (!tb) return null; const kids = Array.from(tb.children).map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  const tops = [...new Set(kids.map((r) => Math.round(r.top / 4)))].length; const ds = document.querySelector('.klc-ds-wrap') as HTMLElement | null;
  return { h: Math.round(tb.getBoundingClientRect().height), rows: tops, ds: ds ? Math.round(ds.getBoundingClientRect().width) : null, dsText: ds ? (ds.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30) : null, how: (Array.from(tb.querySelectorAll('span, a')).map((e) => (e.textContent || '').trim()).find((t) => /страниц|work/i.test(t)) || '').slice(0, 30) };
};

for (const who of ['a', 'b'] as const) test(`toolbar rows and late-label shift, ru 360, ${who === 'a' ? 'Pro' : 'Free'}, six loads`, async ({ browser }) => {
  test.setTimeout(600_000);
  for (let i = 1; i <= 6; i++) {
    const ctx = await signedInContext(browser, who, { viewport: { width: 360, height: 800 } }); await ctx.addInitScript(OBSERVER); const page = await ctx.newPage(); await installPaidAiFence(page);
    await page.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'ru'); localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => { if (route.request().method() !== 'GET') return route.fallback(); const res = await route.fetch(); const b = await res.json().catch(() => null); if (b == null) return route.fulfill({ response: res }); const patch = (r: Record<string, unknown>) => ({ ...r, language: 'ru', strategy_selection: null, strategy_params: null, arena_strategy: null }); return route.fulfill({ response: res, body: JSON.stringify(Array.isArray(b) ? b.map(patch) : patch(b as Record<string, unknown>)) }); });
    try {
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); const samples: unknown[] = [];
      for (const ms of [400, 1200, 3400]) { await page.waitForTimeout(ms); samples.push(await page.evaluate(toolbar)); }
      await page.waitForTimeout(4_000); const cls = await page.evaluate(() => (window as unknown as { __cls: Array<{ v: number; t: number; src: string[] }> }).__cls); const total = +cls.reduce((a, s) => a + s.v, 0).toFixed(3);
      console.log(`[TOOLBAR] ${who} load ${i}: CLS ${total}; toolbar at ~0.4s/1.6s/5s ${JSON.stringify(samples)}`);
      for (const s of cls.filter((x) => x.v >= 0.01)) console.log(`[TOOLBAR] ${who} load ${i} shift +${s.v} at ${s.t}ms: ${s.src.join(' | ')}`);
      if (i === 1) { await page.screenshot({ path: `qa/.shots/header-ru-360-${who}.png`, clip: { x: 0, y: 0, width: 360, height: 420 }, timeout: 20_000 }).catch(() => {}); }
      if (i === 1) { await page.screenshot({ path: `qa/.shots/toolbar-ru-360-${who}.png`, clip: { x: 0, y: 380, width: 360, height: 340 }, timeout: 20_000 }).catch(() => {}); }
    } finally { await ctx.close(); }
  }
});
