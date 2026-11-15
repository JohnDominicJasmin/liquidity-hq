/* PAGE LOAD SPEED AND "NOT STUCK IN LOADING", every page, on a build under test (owner order 2026-11-15: "check all pages... loading the page must be fast... not stuck in loading").
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/page-load.spec.ts -f base_url=https://liquidity-hq-staging.onrender.com -f project=desktop
 * For every page x width (360, 1280) x state (signed out, signed in as fixture A) x visit (FIRST = fresh context, RELOAD = same context, warm HTTP cache), 15 s of observation per visit:
 *   ttfb       navigation responseStart (ms)
 *   lcp        the last largest-contentful-paint entry (ms) and the element
 *   resolved   the last moment ANY element still showed a loading state (ms; 0 = none ever seen). Loading state = a visible element that is aria-busy, a skeleton / spinner / loading class, a progressbar,
 *              or short text that says Loading / Scanning / Searching / Fetching / Analysing / Reading / Setting up / Connecting / Preparing (checked every 200 ms)
 *   STUCK      loading elements still visible at 15 s, with tag.class and text
 *   console errors, page errors, failed requests (status and path), the main document's status
 * BUDGET: LCP <= 2500 ms, resolved <= 8000 ms, nothing stuck at 15 s. A cell prints its line ([PAGELOAD]) and breaks a budget with a SOFT assertion, so every cell reports.
 * Staging and qa are on a free plan and spin down: the first request is a wake-up, said so in the run log. Production is NOT a target for this spec from CI (the production guard refuses without E2E_ALLOW_PRODUCTION, which this
 * spec does not set and must not). Nothing is written: signed-in visits only read (the app's own timezone sync PATCH on a signed-in visit is the app's, same as every other signed-in spec). */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext } from './_auth';

const PAGES = ['/', '/upgrade', '/arena', '/dashboard', '/markets', '/scanner', '/news', '/briefing', '/research', '/hours', '/playbook', '/liq', '/funding', '/correlation', '/econ-calendar', '/alerts', '/journal', '/settings', '/learn', '/faq', '/changelog', '/status', '/about', '/login', '/privacy', '/terms', '/disclaimer', '/refund'];
const OBSERVE_MS = 15_000; const LCP_BUDGET = 2_500; const RESOLVE_BUDGET = 8_000;

const WATCH = () => {
  const w = window as unknown as { __pl: { lcp: { t: number; el: string } | null; ticks: Array<{ t: number; keys: string[] }> } }; w.__pl = { lcp: null, ticks: [] };
  const d = (el: Element) => { const e = el as HTMLElement; const c = (typeof e.className === 'string' ? e.className : '').split(/\s+/).filter(Boolean).slice(0, 2).join('.'); const tx = (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40); return `${e.tagName.toLowerCase()}${c ? '.' + c : ''}${tx ? ' "' + tx + '"' : ''}`; };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as Array<{ startTime: number; element?: Element | null }>) w.__pl.lcp = { t: Math.round(e.startTime), el: e.element ? d(e.element) : '(none)' }; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* unsupported */ }
  const TXT = /^(loading|scanning|searching|fetching|analy[sz]ing|reading|setting up|connecting|preparing|checking)\b[^.]{0,40}$/i;
  const CLS = '[aria-busy="true"], [class*="skel"], [class*="spinner"], [class*="loading"], [role="progressbar"]';
  const visible = (e: Element) => { const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity || '1') > 0.05 && r.bottom > 0 && r.top < innerHeight * 3; };
  const t0 = performance.now();
  setInterval(() => {
    const keys = new Set<string>();
    document.querySelectorAll(CLS).forEach((e) => { if (visible(e) && !e.closest('[aria-hidden="true"][class*="drawer"]')) keys.add(d(e)); });
    document.querySelectorAll('body *').forEach((e) => { if (e.children.length === 0 && (e.textContent || '').length < 60 && TXT.test((e.textContent || '').trim()) && visible(e)) keys.add(d(e)); });
    w.__pl.ticks.push({ t: Math.round(performance.now() - t0), keys: Array.from(keys).slice(0, 8) });
  }, 200);
};

type Cell = { ttfb: number; lcp: number | null; lcpEl: string; resolved: number; stuck: string[]; errors: string[]; failed: string[]; status: number | null };
async function visit(page: Page, path: string, reload: boolean): Promise<Cell> {
  const errors: string[] = []; const failed: string[] = []; let status: number | null = null;
  const onC = (m: { type: () => string; text: () => string }) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); }; const onE = (e: Error) => errors.push(`pageerror: ${e.message.slice(0, 120)}`);
  const onF = (r: { url: () => string; failure: () => { errorText: string } | null }) => failed.push(`${new URL(r.url()).pathname} ${r.failure()?.errorText ?? ''}`.slice(0, 100));
  const onR = (r: { status: () => number; url: () => string; request: () => { isNavigationRequest: () => boolean } }) => { if (r.request().isNavigationRequest() && status === null) status = r.status(); if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`.slice(0, 100)); };
  page.on('console', onC); page.on('pageerror', onE); page.on('requestfailed', onF); page.on('response', onR as never);
  try {
    if (reload) await page.reload({ waitUntil: 'commit' }); else await page.goto(path, { waitUntil: 'commit' });
    await page.waitForTimeout(OBSERVE_MS);
    const r = await page.evaluate(() => {
      const w = window as unknown as { __pl: { lcp: { t: number; el: string } | null; ticks: Array<{ t: number; keys: string[] }> } }; const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const withLoad = w.__pl.ticks.filter((x) => x.keys.length > 0); const last = w.__pl.ticks[w.__pl.ticks.length - 1];
      return { ttfb: nav ? Math.round(nav.responseStart) : -1, lcp: w.__pl.lcp, resolved: withLoad.length ? withLoad[withLoad.length - 1].t : 0, stuck: last ? last.keys : [] };
    });
    return { ttfb: r.ttfb, lcp: r.lcp ? r.lcp.t : null, lcpEl: r.lcp ? r.lcp.el : '', resolved: r.resolved, stuck: r.stuck, errors: [...new Set(errors)].slice(0, 4), failed: [...new Set(failed)].slice(0, 6), status };
  } finally { page.off('console', onC); page.off('pageerror', onE); page.off('requestfailed', onF); page.off('response', onR as never); }
}

test.describe('page load', () => {
  test.describe.configure({ timeout: 200_000, retries: 0 });
  test.beforeAll(async ({ request }) => { /* WAKE-UP: staging / qa spin down on the free plan; the first request pays the cold start, so it is made here and not measured */ const t = Date.now(); await request.get('/api/version', { timeout: 90_000 }).catch(() => null); console.log(`[PAGELOAD] wake-up request took ${Date.now() - t} ms (not measured)`); });
  for (const path of PAGES) for (const auth of ['out', 'in'] as const) test(`${path} ${auth}`, async ({ browser }) => {
    test.skip(auth === 'in' && !AUTH_READY, AUTH_SKIP_REASON);
    for (const width of [360, 1280]) {
      const ctx: BrowserContext = auth === 'in' ? await signedInContext(browser, 'a') : await browser.newContext();
      await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }); await ctx.addInitScript(WATCH);
      const page = await ctx.newPage(); await page.setViewportSize({ width, height: width < 500 ? 800 : 900 });
      try {
        for (const [name, reload] of [['FIRST', false], ['RELOAD', true]] as const) {
          const c = await visit(page, path, reload);
          const bad = [c.lcp !== null && c.lcp > LCP_BUDGET ? `LCP ${c.lcp}` : '', c.resolved > RESOLVE_BUDGET ? `LOADING ${c.resolved}` : '', c.stuck.length ? 'STUCK' : ''].filter(Boolean);
          console.log(`[PAGELOAD] ${JSON.stringify({ path, auth, width, visit: name, status: c.status, ttfb: c.ttfb, lcp: c.lcp, lcpEl: c.lcpEl, resolved: c.resolved, stuck: c.stuck, errors: c.errors, failed: c.failed, verdict: bad.length ? 'FAIL ' + bad.join(',') : 'ok' })}`);
          expect.soft(bad, `${path} ${auth} ${width} ${name}: ${bad.join(', ')} ${c.stuck.join(' | ')}`).toEqual([]);
        }
      } finally { await ctx.close(); }
    }
  });
});
