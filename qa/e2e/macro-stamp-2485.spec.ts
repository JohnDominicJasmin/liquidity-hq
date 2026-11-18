/* #2485 MACRO "close" STAMP: the macro routes answered by a TRANSFORM of the real response whose asOf fields are set to an old time (3 days ago) or to now.
 *   MS1  old quotes: the Macro Correlations strip (/correlation) shows at least one macro-stamp reading "<weekday> close"; /briefing Macro Pulse DXY shows one
 *   MS2  fresh quotes (asOf = now): NO macro-stamp anywhere on those pages
 *   MS3  no asOf at all (an older payload): NO macro-stamp and no error text
 * English, signed out, 1280. Prints the stamps it found. */
import { test, expect, type Page } from '@playwright/test';

type J = Record<string, unknown> | unknown[] | string | number | null;
const setAsOf = (o: J, ms: number | null): void => {
  if (o && typeof o === 'object') {
    if (!Array.isArray(o) && 'asOf' in o) { const v = (o as Record<string, unknown>).asOf; if (v && typeof v === 'object') for (const k of Object.keys(v as object)) (v as Record<string, unknown>)[k] = ms; else (o as Record<string, unknown>).asOf = ms; }
    for (const k of Object.keys(o as object)) setAsOf((o as Record<string, J>)[k], ms);
  }
};
async function open(page: Page, path: string, mode: 'old' | 'fresh' | 'none') {
  await page.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  await page.route(/\/api\/(macro|macro-context)(\?|$)/, async (route) => {
    const res = await route.fetch(); const j = await res.json().catch(() => null) as J; if (j == null) return route.fulfill({ response: res });
    if (mode === 'none') { const strip = (o: J): void => { if (o && typeof o === 'object') { if (!Array.isArray(o)) delete (o as Record<string, unknown>).asOf; for (const k of Object.keys(o as object)) strip((o as Record<string, J>)[k]); } }; strip(j); }
    else {
      const ms = mode === 'old' ? Date.now() - 3 * 24 * 3600 * 1000 : Date.now();
      /* the CI build has no Yahoo feed, so the quotes themselves are absent (a stamp needs a PRICE): give /api/macro four priced quotes with the chosen time, then set every asOf in whatever else the payload carries */
      if (/\/api\/macro(\?|$)/.test(route.request().url()) && j && typeof j === 'object' && !Array.isArray(j)) Object.assign(j, { dxy: { price: 104.25, chg: 0.12, asOf: ms }, spx: { price: 5890.4, chg: -0.31, asOf: ms }, gold: { price: 2710.5, chg: 0.44, asOf: ms }, oil: { price: 71.2, chg: -0.8, asOf: ms } });
      setAsOf(j, ms);
    }
    return route.fulfill({ response: res, body: JSON.stringify(j) });
  });
  await page.goto(path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(14_000);
  const seen = await page.evaluate(async () => { try { const r = await fetch('/api/macro', { cache: 'no-store' }); return JSON.stringify(await r.json()).slice(0, 260); } catch (e) { return String(e); } }); console.log(`[MACROSTAMP] ${path} ${mode} /api/macro as the page sees it: ${seen}`);
  return page.evaluate(() => ({ stamps: Array.from(document.querySelectorAll('[data-testid="macro-stamp"]')).map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()), err: /undefined|NaN|\[object/.test(document.body.innerText) }));
}
for (const path of ['/correlation', '/briefing', '/dashboard']) {
  test(`MS1/MS2/MS3:${path}`, async ({ browser }) => {
    test.setTimeout(240_000); const out: Record<string, { stamps: string[]; err: boolean }> = {};
    for (const mode of ['old', 'fresh', 'none'] as const) { const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); try { out[mode] = await open(page, path, mode); } finally { await ctx.close(); } }
    console.log(`[MACROSTAMP] ${path}: ${JSON.stringify(out)}`);
    expect(out.fresh.stamps, `a stamp shows on ${path} for a FRESH quote`).toEqual([]); expect(out.none.stamps, `a stamp shows on ${path} with no asOf`).toEqual([]); expect(out.none.err && !out.old.err, 'an error value is drawn when asOf is missing').toBe(false);
    if (path === '/correlation' || path === '/briefing') { expect(out.old.stamps.length, `no stamp on ${path} for a 3-day-old quote`).toBeGreaterThan(0); expect(out.old.stamps.some((s) => /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w* close/i.test(s)), `the stamp does not read "<weekday> close": ${JSON.stringify(out.old.stamps)}`).toBe(true); }
  });
}
