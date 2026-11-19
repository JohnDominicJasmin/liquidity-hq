/* LAYOUT-SHIFT FACTS FOR DEV (#2602 / the CLS hold): the FULL source lists AND a per-frame DOM diff, because LayoutShift.sources only lists nodes that MOVED: a node that was inserted or grew above them is not in it.
 *   LS-A  the landing (/) at 390 and 1280, dark and light: every shift entry (value, time) with all sources (tag.class "text" rect before -> after), and the elements whose box GREW or APPEARED (height change >= 8 px, or a new box >= 8 px tall) between two frames, with the time. Normal speed, 4 loads; and 4x CPU + 4G, 3 loads.
 *   LS-B  /arena (en, 390) SAVED-WARM as the CLS gate seeds it (cached settings with a saved strategy, signed in as the Pro fixture): 16 fresh loads, to catch the 1-in-6 load. For every load over 0.1: all sources and every grower/appearance.
 * Informational: it prints facts and fails only if a load is over 0.1 AFTER printing (so the facts always arrive). Nothing is written. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

const OBS = () => {
  const w = window as unknown as { __ls: unknown[]; __grow: unknown[]; __t0: number };
  w.__ls = []; w.__grow = []; w.__t0 = performance.now();
  const rect = (el: Element) => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
  const desc = (n: Node | null) => { const el = n && n.nodeType === 1 ? (n as HTMLElement) : (n && n.parentElement) || null; if (!el) return '(gone)'; const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).slice(0, 3).join('.'); return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : ''} "${(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`; };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as Array<{ value: number; startTime: number; hadRecentInput: boolean; sources?: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> }>) w.__ls.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime), input: e.hadRecentInput, src: (e.sources || []).map((s) => `${desc(s.node)} [${Math.round(s.previousRect.x)},${Math.round(s.previousRect.y)},${Math.round(s.previousRect.width)},${Math.round(s.previousRect.height)}]->[${Math.round(s.currentRect.x)},${Math.round(s.currentRect.y)},${Math.round(s.currentRect.width)},${Math.round(s.currentRect.height)}]`) }); }).observe({ type: 'layout-shift', buffered: true }); } catch { /* unsupported */ }
  let last = new Map<Element, number[]>();
  const tick = () => {
    const now = new Map<Element, number[]>(); const t = Math.round(performance.now());
    if (document.body) for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = rect(el); if (r[3] < 8 || r[2] < 8) continue; now.set(el, r);
      const p = last.get(el);
      if (!p) { if (last.size > 0 && r[3] >= 8) (w.__grow as unknown[]).push({ t, kind: 'appeared', el: desc(el), rect: r }); }
      else if (Math.abs(r[3] - p[3]) >= 8) (w.__grow as unknown[]).push({ t, kind: r[3] > p[3] ? 'grew' : 'shrank', el: desc(el), from: p, to: r });
    }
    last = now; if (t < 14_000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
type LS = { v: number; t: number; input: boolean; src: string[] };
type Grow = { t: number; kind: string; el: string; rect?: number[]; from?: number[]; to?: number[] };
const collect = (page: Page) => page.evaluate(() => ({ ls: (window as unknown as { __ls: LS[] }).__ls, grow: (window as unknown as { __grow: Grow[] }).__grow }));
const report = (tag: string, ls: LS[], grow: Grow[]) => {
  const total = +ls.filter((s) => !s.input).reduce((a, s) => a + s.v, 0).toFixed(3);
  console.log(`[LS] ${tag} TOTAL ${total}`);
  for (const s of ls) console.log(`[LS] ${tag}   shift +${s.v} at ${s.t}ms: ${s.src.join(' | ')}`);
  const big = grow.filter((g) => g.kind !== 'shrank').sort((a, b) => a.t - b.t).slice(0, 40);
  for (const g of big) console.log(`[LS] ${tag}   ${g.kind} at ${g.t}ms: ${g.el} ${g.from ? JSON.stringify(g.from) + '->' + JSON.stringify(g.to) : JSON.stringify(g.rect)}`);
  return total;
};

for (const [width, theme] of [[390, 'dark'], [390, 'light'], [1280, 'dark']] as const) {
  test(`LS-A landing ${width} ${theme}: every shift, every source, every grower`, async ({ browser }) => {
    test.setTimeout(600_000); let worst = 0;
    for (let i = 1; i <= 4; i++) {
      const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
      await ctx.addInitScript(OBS); await ctx.addInitScript(([t]) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [theme]);
      const page = await ctx.newPage(); await installPaidAiFence(page);
      try { await page.goto('/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(14_000); const { ls, grow } = await collect(page); worst = Math.max(worst, report(`landing ${width} ${theme} load ${i}`, ls, grow)); } finally { await ctx.close(); }
    }
    for (let i = 1; i <= 3; i++) {
      const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
      await ctx.addInitScript(OBS); await ctx.addInitScript(([t]) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [theme]);
      const page = await ctx.newPage(); await installPaidAiFence(page);
      try {
        const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
        await page.goto('/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(20_000); const { ls, grow } = await collect(page); worst = Math.max(worst, report(`landing ${width} ${theme} THROTTLED load ${i}`, ls, grow));
      } finally { await ctx.close(); }
    }
    expect(worst, `worst landing CLS at ${width} ${theme}`).toBeLessThanOrEqual(0.1);
  });
}

async function warm(browser: Browser) {
  const ctx = await signedInContext(browser, 'a'); await ctx.addInitScript(OBS); const page = await ctx.newPage(); await installPaidAiFence(page); await page.setViewportSize({ width: 390, height: 844 });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_settings_v1', JSON.stringify({ arena_strategy: 'ema_stack' })); localStorage.setItem('lhq_lang_v1', 'en'); } catch { /* private */ } });
  await page.route(/\/api\/settings(\?|$)/, async (route) => { const q = route.request(); if (q.method() === 'GET') return route.fallback(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: Object.keys((q.postDataJSON() ?? {}) as object).filter((k) => k !== 'knownAsOf'), rejected: [] }) }); });
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => { if (route.request().method() !== 'GET') return route.fallback(); const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res }); const patch = (r: Record<string, unknown>) => ({ ...r, arena_strategy: 'ema_stack' }); return route.fulfill({ response: res, json: Array.isArray(body) ? body.map(patch) : patch(body as Record<string, unknown>) }); });
  return { ctx, page };
}
test('LS-B /arena en 390 SAVED-WARM: 16 loads, the full facts of every load over 0.1', async ({ browser }) => {
  test.setTimeout(900_000); test.skip(!AUTH_READY, AUTH_SKIP_REASON); const totals: number[] = [];
  for (let i = 1; i <= 16; i++) {
    const { ctx, page } = await warm(browser);
    try {
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.waitForTimeout(12_000); const { ls, grow } = await collect(page);
      const total = +ls.filter((s) => !s.input).reduce((a, s) => a + s.v, 0).toFixed(3); totals.push(total);
      if (total > 0.1) report(`arena warm 390 load ${i}`, ls, grow); else console.log(`[LS] arena warm 390 load ${i}: ${total} (ok)`);
    } finally { await ctx.close(); }
  }
  console.log(`[LS] arena warm 390 totals ${JSON.stringify(totals)}`);
  expect(Math.max(...totals), 'worst of 16 loads').toBeLessThanOrEqual(0.1);
});
