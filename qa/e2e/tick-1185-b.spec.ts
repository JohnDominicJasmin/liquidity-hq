/* #1185 TICK CELLS, part B (signed in as the Free fixture "b", throw-away): upsell count per page (box 255) and the refused-save flash on /settings (box 144).
 * Writes are stubbed locally (the PATCH is answered 400 in the browser), nothing reaches the shared database, the paid-AI fence is on, no credential is typed. */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { entitlementsUnresolved } from './_shared';
import { openPage, stubSettingsWrites, type Theme } from './_v1185';

const T = (id: string, msg: string) => console.log(`[TICK] ${id} ${msg}`);
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name === 'mobile', 'viewports are set per cell'); test.skip(!AUTH_READY, AUTH_SKIP_REASON); });

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

const PAGES: [string, number, Theme][] = [['/arena?coin=hype&tf=1h', 1280, 'dark'], ['/research', 1280, 'dark'], ['/alerts', 1280, 'dark'], ['/dashboard', 1280, 'dark'], ['/scanner', 1280, 'dark'], ['/liq', 1280, 'dark'], ['/journal', 1280, 'dark'],
  ['/briefing', 1280, 'dark'], ['/markets', 1280, 'dark'], ['/arena?coin=hype&tf=1h', 390, 'light'], ['/research', 390, 'light'], ['/alerts', 390, 'light'], ['/dashboard', 390, 'light']];
for (const [path, w, theme] of PAGES) {
  test(`B1 Free account, ${path} ${w} ${theme}: 3 or fewer upsell strings (box 255)`, async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await signedInContext(browser, 'b', { viewport: { width: w, height: w < 500 ? 844 : 900 } });
    await ctx.addInitScript((th: string) => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem('theme', th); } catch { /* private */ } }, theme);
    const page = await openPage(ctx); await stubSettingsWrites(page);
    try {
      await gotoSignedIn(page, path); await page.waitForTimeout(16_000);
      const unresolved = await entitlementsUnresolved(page);
      const list = await page.evaluate(upsell);
      T('B1', `${path} ${w} ${theme}: plan unresolved=${JSON.stringify(unresolved)} · ${list.length} upsell strings ${JSON.stringify(list)}`);
      expect.soft(unresolved, 'the plan read failed, so this is not the Free account view').toBeNull();
      expect.soft(list.length, `${path} ${w}: more than 3 upsell strings`).toBeLessThanOrEqual(3);
      await page.screenshot({ path: `qa/.shots/tick-b1-${path.replace(/[^a-z]/g, '')}-${w}-${theme}.png` }).catch(() => {});
    } finally { await ctx.close().catch(() => {}); }
  });
}

/* box 144: after a REFUSED save (400) and a reload, the field must not show the refused value, not even for a second */
test('B2 /settings: a refused save, then a reload: the refused value is never shown (box 144)', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await signedInContext(browser, 'b'); const page: Page = await ctx.newPage();
  const field = () => page.getByLabel('Account Size', { exact: true }).first();
  let patches = 0;
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    patches++; return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid value' }) });
  });
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
      const v = await page.evaluate(() => { const l = Array.from(document.querySelectorAll('label')).find((x) => (x.textContent || '').trim() === 'Account Size'); const id = l?.getAttribute('for'); const i = (id ? document.getElementById(id) : l?.querySelector('input')) as HTMLInputElement | null; return i ? i.value : null; }).catch(() => null);
      if (v != null && (seen.length === 0 || seen[seen.length - 1][1] !== v)) seen.push([Date.now() - t0, v]);
      await page.waitForTimeout(120);
    }
    T('B2', `original=${original} refused=${refused} patches=${patches} · values seen after the reload (ms, value): ${JSON.stringify(seen)}`);
    expect.soft(seen.length, 'UNMEASURED: the field never reappeared after the reload').toBeGreaterThan(0);
    expect.soft(seen.map((s) => s[1]), 'the REFUSED value was shown after the reload').not.toContain(refused);
    expect.soft(seen[seen.length - 1]?.[1], 'the saved (server) value is not what ends up shown').toBe(original);
  } finally { await ctx.close().catch(() => {}); }
});
