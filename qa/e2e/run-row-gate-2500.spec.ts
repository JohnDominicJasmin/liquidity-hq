/* #2500 RUN-ROW GATE (owner-reported on production 2026-11-17: Free, HYPE: the Strategy panel's QUICK / DEEP were unlocked while the top Quick / Deep Research buttons were locked). The panel's run row must read the SAME gate as the top buttons.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true [-f base_url=<url>] -f project=desktop -f "spec=qa/e2e/run-row-gate-2500.spec.ts"
 *   RG1  Free on a locked coin (hype): top Quick, top Deep, panel QUICK and panel DEEP are ALL locked (lock icon, the locked style) and disabled, with the same tooltip as the top button of the same kind
 *   RG2  Free on BTC: all four are unlocked and enabled
 *   RG3  Free with the daily allowance used up (usage read stubbed quick 5/5, deep 2/2) on BTC: top and panel are both disabled for Quick and for Deep, and both are NOT shown locked (a spent allowance is not a coin lock)
 *   RG4  the plan being read (subscription read held): all four are disabled
 *   RG5  Pro on BTC and on HYPE: all four are unlocked and enabled
 * Each cell prints one [RUNGATE] line with the four buttons' state. The paid AI route is fenced and nothing is run. */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

type B = { found: boolean; disabled: boolean; locked: boolean; lockIcon: boolean; title: string };
const state = (page: Page) => page.evaluate(() => {
  const read = (el: HTMLElement | null): { found: boolean; disabled: boolean; locked: boolean; lockIcon: boolean; title: string } => (el ? { found: true, disabled: (el as HTMLButtonElement).disabled, locked: el.classList.contains('arena-deep-locked'), lockIcon: !!el.querySelector('svg'), title: el.getAttribute('title') ?? '' } : { found: false, disabled: false, locked: false, lockIcon: false, title: '' });
  const top = Array.from(document.querySelectorAll('button')).filter((b) => !b.closest('.strat-panel')) as HTMLElement[];
  const topQuick = document.querySelector('.arena-quick-btn') as HTMLElement | null, topDeep = top.find((b) => /deep research|deep dive|deep/i.test(b.innerText) && b.classList.contains('arena-fire-btn')) ?? null;
  const panel = Array.from(document.querySelectorAll('.strat-panel .strat-btn')) as HTMLElement[];
  const p = (t: string) => panel.find((b) => b.innerText.trim().replace(/\s+/g, '').toUpperCase() === t) ?? null;
  return { topQuick: read(topQuick), topDeep: read(topDeep), panelQuick: read(p('QUICK')), panelDeep: read(p('DEEP')) };
});

async function open(browser: Browser, who: 'a' | 'b', coin: string, o: { usage?: boolean; hold?: boolean } = {}) {
  const ctx = await signedInContext(browser, who, { viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage(); await installPaidAiFence(page);
  if (o.usage) await page.route(/\/api\/grok(\?|$)/, (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ usage: { quick_used: 5, quick_limit: 5, deep_used: 2, deep_limit: 2, chat_used: 0, chat_limit: 20, search_used: 0, search_limit: 2, briefing_used: 0, briefing_limit: 1 } }) }) : route.fallback()));
  const held: Array<import('@playwright/test').Route> = []; if (o.hold) await page.route('**/rest/v1/*user_subscriptions*', (route) => { held.push(route); });
  await gotoSignedIn(page, `/arena?coin=${coin}&tf=1h`); await page.locator('.strat-panel').first().waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(o.hold ? 6_000 : 10_000);
  return { ctx, page, held };
}
const line = (tag: string, s: Record<string, B>) => console.log(`[RUNGATE] ${tag}: ${JSON.stringify(s)}`);
const allFound = (s: Record<string, B>) => { for (const [k, v] of Object.entries(s)) expect(v.found, `${k} button was not found: the cell cannot judge the gate`).toBe(true); };

test('RG1. Free on HYPE: top and panel Quick/Deep all shown locked, ENABLED (a lock opens the upgrade sheet, PM 2026-11-18), same tooltip', async ({ browser }) => {
  test.setTimeout(150_000); const { ctx, page } = await open(browser, 'b', 'hype');
  try {
    const s = await state(page); line('free/hype', s); allFound(s);
    for (const [k, v] of Object.entries(s)) { expect(v.locked, `${k} is not shown locked`).toBe(true); expect(v.disabled, `${k} is disabled: a locked button must be clickable and open the upgrade sheet`).toBe(false); expect(v.lockIcon, `${k} has no lock icon`).toBe(true); }
    for (const sel of ['topQuick', 'panelQuick', 'topDeep', 'panelDeep']) {
      const btn = sel === 'topQuick' ? page.locator('.arena-quick-btn').first() : sel === 'topDeep' ? page.locator('button.arena-fire-btn').filter({ hasText: /deep/i }).first() : page.locator('.strat-panel .strat-btn').filter({ hasText: sel === 'panelQuick' ? /^\s*quick\s*$/i : /^\s*deep\s*$/i }).first();
      if (await btn.count() === 0) { console.log(`[RUNGATE] RG1 ${sel}: button locator found nothing, sheet click skipped`); continue; }
      const errs: string[] = []; const onC = (m: { type(): string; text(): string }) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }; const onE = (e: Error) => errs.push(`pageerror ${e.message.slice(0, 160)}`); page.on('console', onC); page.on('pageerror', onE);
      const pre = await btn.evaluate((el) => ({ disabled: (el as HTMLButtonElement).disabled, ariaDisabled: el.getAttribute('aria-disabled'), cls: el.className })); const user = await page.evaluate(() => ({ avatar: !!document.querySelector('[data-testid="user-menu"], .user-avatar, a[href="/settings"]'), path: location.pathname }));
      await btn.click({ timeout: 5_000 }).catch((e) => console.log(`[RUNGATE] RG1 ${sel}: click threw ${String(e).slice(0, 120)}`)); await page.waitForTimeout(800);
      const open = await page.locator('[role="dialog"]').first().isVisible().catch(() => false); const post = await page.evaluate(() => ({ path: location.pathname, dialogs: document.querySelectorAll('[role="dialog"], .upgrade-modal-term-wrap').length }));
      page.off('console', onC); page.off('pageerror', onE);
      console.log(`[RUNGATE] RG1 ${sel}: before ${JSON.stringify(pre)} signedInHints ${JSON.stringify(user)}; after path ${post.path} dialogs ${post.dialogs} visible ${open}; console errors ${JSON.stringify(errs)}`);
      expect(open, `${sel}: clicking a locked button did not open the upgrade sheet (path ${post.path})`).toBe(true); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    }
    expect(s.panelQuick.title, 'the panel QUICK tooltip differs from the top Quick button').toBe(s.topQuick.title); expect(s.panelDeep.title, 'the panel DEEP tooltip differs from the top Deep button').toBe(s.topDeep.title);
  } finally { await ctx.close(); }
});

test('RG2. Free on BTC: all four unlocked and enabled', async ({ browser }) => {
  test.setTimeout(150_000); const { ctx, page } = await open(browser, 'b', 'btc');
  try { const s = await state(page); line('free/btc', s); allFound(s); for (const [k, v] of Object.entries(s)) { expect(v.locked, `${k} is shown locked on BTC`).toBe(false); expect(v.disabled, `${k} is disabled on BTC`).toBe(false); } } finally { await ctx.close(); }
});

test('RG3. Free, allowance used up: top and panel both disabled, neither shown locked', async ({ browser }) => {
  test.setTimeout(150_000); const { ctx, page } = await open(browser, 'b', 'btc', { usage: true });
  try {
    const s = await state(page); line('free/btc/allowance-used', s); allFound(s);
    for (const [k, v] of Object.entries(s)) { expect(v.disabled, `${k} is enabled with the allowance used up`).toBe(true); expect(v.locked, `${k} is shown locked for a spent allowance (not a coin lock)`).toBe(false); }
  } finally { await ctx.close(); }
});

test('RG4. plan being read: all four disabled', async ({ browser }) => {
  test.setTimeout(150_000); const { ctx, page, held } = await open(browser, 'b', 'btc', { hold: true });
  try {
    await expect.poll(() => held.length, { timeout: 20_000, message: 'the plan read was never held: this cell measures nothing' }).toBeGreaterThan(0);
    const s = await state(page); line('free/btc/plan-checking', s); allFound(s);
    for (const [k, v] of Object.entries(s)) expect(v.disabled, `${k} is enabled while the plan is being read`).toBe(true);
  } finally { await ctx.close(); }
});

for (const coin of ['btc', 'hype'] as const) test(`RG5. Pro on ${coin}: all four unlocked and enabled`, async ({ browser }) => {
  test.setTimeout(150_000); const { ctx, page } = await open(browser, 'a', coin);
  try { const s = await state(page); line(`pro/${coin}`, s); allFound(s); for (const [k, v] of Object.entries(s)) { expect(v.locked, `${k} is shown locked for Pro`).toBe(false); expect(v.disabled, `${k} is disabled for Pro`).toBe(false); } } finally { await ctx.close(); }
});
