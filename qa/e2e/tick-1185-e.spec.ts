/* #1185 TICK CELLS, part E (signed in as the Free fixture "b", throw-away): the refused-save flash on /settings (box 144) and the upsell count at phone width (box 255).
 * The PATCH is answered 400 in the browser, so nothing reaches the shared database; paid-AI fence on; no credential typed. */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { entitlementsUnresolved } from './_shared';
import { openPage, stubSettingsWrites } from './_v1185';

const T = (id: string, msg: string) => console.log(`[TICK] ${id} ${msg}`);
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name === 'mobile', 'viewports are set per cell'); test.skip(!AUTH_READY, AUTH_SKIP_REASON); });

test('E1 /settings: a refused save, then a reload: the refused value is never shown (box 144)', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await signedInContext(browser, 'b'); const page: Page = await ctx.newPage();
  const field = () => page.getByLabel('Account Size', { exact: true }).first();
  let patches = 0;
  await page.route('**/api/settings', async (route) => { if (route.request().method() !== 'PATCH') return route.continue(); patches++; return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid value' }) }); });
  try {
    await gotoSignedIn(page, '/settings');
    await expect(field(), 'Account Size never rendered: nothing measured').toBeVisible({ timeout: 25_000 });
    const original = await field().inputValue(); const refused = String((Number(original) || 10_000) + 333);
    await field().fill(refused); await field().blur();
    await expect.poll(() => patches, { message: 'the save never left: the refusal was not exercised', timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(6_000);
    await page.unroute('**/api/settings');
    await page.reload({ waitUntil: 'commit' });
    const seen: [number, string][] = []; const t0 = Date.now();
    while (Date.now() - t0 < 15_000) {
      const v = await field().inputValue({ timeout: 150 }).catch(() => null);
      if (v != null && (seen.length === 0 || seen[seen.length - 1][1] !== v)) seen.push([Date.now() - t0, v]);
      await page.waitForTimeout(60);
    }
    T('E1', `original=${original} refused=${refused} patches=${patches} · values seen after the reload (ms, value): ${JSON.stringify(seen)}`);
    expect.soft(seen.length, 'UNMEASURED: the field never reappeared after the reload').toBeGreaterThan(0);
    expect.soft(seen.map((s) => s[1]), 'the REFUSED value was shown after the reload').not.toContain(refused);
    expect.soft(seen[seen.length - 1]?.[1], 'the saved (server) value is not what ends up shown').toBe(original);
  } finally { await ctx.close().catch(() => {}); }
});

const upsell = () => {
  const re = /\b(upgrade|unlock with pro|pro feature|pro)\b/i;
  const vis = (e: Element) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const out: string[] = []; const seen = new Set<string>();
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) || el.closest('svg') || el.closest('.sr-only')) continue;
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
    if (own && re.test(own) && vis(el)) { const k = own + '|' + el.tagName; if (!seen.has(k)) { seen.add(k); out.push(own.slice(0, 70)); } }
  }
  return out;
};
for (const [path, w, theme] of [['/scanner', 390, 'light'], ['/liq', 390, 'light'], ['/journal', 390, 'light'], ['/briefing', 390, 'light'], ['/markets', 390, 'light'], ['/arena?coin=hype&tf=1h', 390, 'dark'], ['/arena?coin=hype&tf=1h', 768, 'light']] as [string, number, string][]) {
  test(`E2 Free account, ${path} ${w} ${theme}: upsell strings (box 255)`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await signedInContext(browser, 'b', { viewport: { width: w, height: w < 500 ? 844 : 900 } });
    await ctx.addInitScript((th: string) => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem('theme', th); } catch { /* private */ } }, theme);
    const page = await openPage(ctx); await stubSettingsWrites(page);
    try {
      await gotoSignedIn(page, path); await page.waitForTimeout(16_000);
      const unresolved = await entitlementsUnresolved(page); const list = await page.evaluate(upsell);
      T('E2', `${path} ${w} ${theme}: plan unresolved=${JSON.stringify(unresolved)} · ${list.length} upsell strings ${JSON.stringify(list)}`);
      expect.soft(unresolved, 'plan read failed').toBeNull();
      expect.soft(list.length, `${path} ${w}: more than 3 upsell strings`).toBeLessThanOrEqual(3);
    } finally { await ctx.close().catch(() => {}); }
  });
}
