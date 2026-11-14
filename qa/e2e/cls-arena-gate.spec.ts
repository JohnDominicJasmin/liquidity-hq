/* THE /arena LAYOUT-SHIFT GATE, run against a DEPLOYED site (the owner's rule for the release: CLS over 0.1 in either state = HOLD, no "better than live" exception).
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/cls-arena-gate.spec.ts -f base_url=https://liquidity-hq-qa.onrender.com -f project=desktop
 * Three states x two widths (1280 and 390), SIX fresh loads each, a layout-shift observer from document start (entries with hadRecentInput excluded, like perf.spec):
 *   OUT      signed out
 *   IN       signed in as fixture A, no saved strategy
 *   IN+SAVED signed in as fixture A with a saved strategy (the call box mounts on load: "the box appears (one shift) when a saved strategy loads")
 * Each load's total is printed with every shift entry's source elements. The cell FAILS when the WORST of the six loads is over 0.1 (the worst, not the average: the owner's rule is about any load).
 * Nothing is written: settings writes are stubbed; the READ is the real row (patched only for the saved strategy). CI stand-in data does not apply here: this is the real network on the deployed site. */
import { test, expect, type Browser } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { gotoGuarded } from './_shared';

const BUDGET = 0.1; const LOADS = 6;
type Src = { tag: string; cls: string; testid: string; text: string; prev: number[]; cur: number[] };
type Shift = { value: number; t: number; hadRecentInput: boolean; sources: Src[] };

const OBSERVER = () => {
  const w = window as unknown as { __cls: unknown[] }; w.__cls = [];
  const d = (n: Node | null) => { const el = n && n.nodeType === 1 ? (n as HTMLElement) : (n && n.parentElement) || null; if (!el) return { tag: '(gone)', cls: '', testid: '', text: '' }; return { tag: el.tagName.toLowerCase(), cls: (typeof el.className === 'string' ? el.className : '').split(/\s+/).slice(0, 2).join('.'), testid: el.getAttribute('data-testid') || '', text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28) }; };
  const r = (x: DOMRectReadOnly) => [Math.round(x.x), Math.round(x.y), Math.round(x.width), Math.round(x.height)];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as Array<{ value: number; startTime: number; hadRecentInput: boolean; sources?: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> }>) (w.__cls as unknown[]).push({ value: +e.value.toFixed(4), t: Math.round(e.startTime), hadRecentInput: e.hadRecentInput, sources: (e.sources || []).map((s) => ({ ...d(s.node), prev: r(s.previousRect), cur: r(s.currentRect) })) }); }).observe({ type: 'layout-shift', buffered: true }); } catch { /* unsupported */ }
};

async function load(browser: Browser, state: 'OUT' | 'IN' | 'IN+SAVED', width: number) {
  const height = width < 500 ? 844 : 900;
  if (state === 'OUT') {
    const ctx = await browser.newContext({ viewport: { width, height } }); await ctx.addInitScript(OBSERVER); const page = await ctx.newPage();
    try { await gotoGuarded(page, '/arena'); await page.waitForTimeout(9_000); return await page.evaluate(() => (window as unknown as { __cls: Shift[] }).__cls); } finally { await ctx.close(); }
  }
  const ctx = await signedInContext(browser, 'a'); await ctx.addInitScript(OBSERVER); const page = await ctx.newPage(); await page.setViewportSize({ width, height });
  await page.route(/\/api\/settings(\?|$)/, async route => { const q = route.request(); if (q.method() === 'GET') return route.fallback(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: Object.keys((q.postDataJSON() ?? {}) as object).filter(k => k !== 'knownAsOf'), rejected: [], settings: null }) }); });
  if (state === 'IN+SAVED') await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async route => {
    if (route.request().method() !== 'GET') return route.fallback(); const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res });
    const patch = (r: Record<string, unknown>) => ({ ...r, arena_strategy: 'ema_stack' }); return route.fulfill({ response: res, json: Array.isArray(body) ? body.map(patch) : patch(body as Record<string, unknown>) });
  });
  try { await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.waitForTimeout(9_000); return await page.evaluate(() => (window as unknown as { __cls: Shift[] }).__cls); } finally { await ctx.close(); }
}

test.describe('arena CLS gate (deployed site)', () => {
  test.describe.configure({ timeout: 600_000, retries: 0 });
  for (const state of ['OUT', 'IN', 'IN+SAVED'] as const) for (const width of [1280, 390]) test(`${state} at ${width}: the worst of ${LOADS} loads is at most ${BUDGET}`, async ({ browser }) => {
    test.skip(state !== 'OUT' && !AUTH_READY, AUTH_SKIP_REASON);
    const totals: number[] = []; const detail: string[] = [];
    for (let i = 1; i <= LOADS; i++) {
      const shifts = await load(browser, state, width); const total = +shifts.filter(s => !s.hadRecentInput).reduce((a, s) => a + s.value, 0).toFixed(3); totals.push(total);
      console.log(`[CLSGATE] ${state} ${width} load ${i}: ${total} over ${shifts.length} entries`);
      for (const s of shifts.filter(x => !x.hadRecentInput && x.value >= 0.005)) { const line = `+${s.value} at ${s.t}ms: ${s.sources.map(x => `${x.tag}${x.testid ? '[' + x.testid + ']' : ''}${x.cls ? '.' + x.cls : ''} "${x.text}" ${JSON.stringify(x.prev)}->${JSON.stringify(x.cur)}`).join(' | ') || '(no sources)'}`; console.log(`[CLSGATE]   ${line}`); if (total > BUDGET) detail.push(line.slice(0, 220)); }
    }
    const worst = Math.max(...totals); console.log(`[CLSGATE] ${state} ${width} SUMMARY loads=${JSON.stringify(totals)} worst=${worst} budget=${BUDGET}`);
    expect(worst, `/arena ${state} at ${width}: worst CLS ${worst} of ${JSON.stringify(totals)} is over ${BUDGET}. Entries of the failing loads:\n${detail.join('\n')}`).toBeLessThanOrEqual(BUDGET);
  });
});
