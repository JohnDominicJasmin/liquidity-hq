/* #2516 / #2520 STRATEGY MENU + EVERY STRATEGY RENDERS. Signed in as the Pro DEV fixture on /arena (btc 1h), live CI stand-in candles.
 *   SM1  the menu is GROUPED: optgroups "Beginner / Trend", "Price action / SMC", "Sessions" (and "Derivatives" once #2520 is in) hold the strategy ids the registry says, "Let the read choose" first and "Custom" last
 *   SM2  EVERY strategy option, when picked, shows a verdict (BUY / SELL / WAIT / ...) in the call box with no NaN / undefined / [object / blank, and no page error or console error
 *   SM3  the same menu in Russian: the group labels are translated (not the English keys, not the raw LABEL_KEY)
 * It judges the display and the absence of breakage; the call each strategy makes on KNOWN candles is proven by the unit oracles (strategyFixtures*.test.mts). Nothing is run on the paid AI route. */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
async function open(browser: Browser, lang: 'en' | 'ru') {
  const ctx = await signedInContext(browser, 'a'); await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, lang);
  const page = await ctx.newPage(); await page.setViewportSize({ width: 1280, height: 900 }); await installPaidAiFence(page);
  await page.route(/\/api\/settings(\?|$)/, async (route) => (route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: [], rejected: [], settings: null }) })));
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => { if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' }); const res = await route.fetch(); const b = await res.json().catch(() => null); if (b == null) return route.fulfill({ response: res }); const patch = (r: Record<string, unknown>) => ({ ...r, language: lang }); return route.fulfill({ response: res, body: JSON.stringify(Array.isArray(b) ? b.map(patch) : patch(b)) }); });
  await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.locator('[data-testid="strategy-set-select"]').first().waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(6_000);
  return { ctx, page };
}
const menu = (page: Page) => page.locator('[data-testid="strategy-set-select"]').first().evaluate((sel) => {
  const s = sel as HTMLSelectElement; const out: Array<{ group: string; value: string; label: string; title: string }> = [];
  for (const el of Array.from(s.children)) {
    if (el.tagName === 'OPTGROUP') { const g = el as HTMLOptGroupElement; for (const o of Array.from(g.children) as HTMLOptionElement[]) out.push({ group: g.label, value: o.value, label: o.textContent || '', title: o.title }); }
    else { const o = el as HTMLOptionElement; out.push({ group: '', value: o.value, label: o.textContent || '', title: o.title }); }
  } return out;
});

test('SM1. the menu is grouped, with the read-choose entry first and Custom last', async ({ browser }) => {
  test.setTimeout(150_000); const { ctx, page } = await open(browser, 'en');
  try {
    const m = await menu(page); console.log(`[STRATMENU] ${JSON.stringify(m.map((x) => [x.group, x.value, x.label]))}`);
    const groups = [...new Set(m.map((x) => x.group).filter(Boolean))]; console.log(`[STRATMENU] groups ${JSON.stringify(groups)}`);
    expect(groups.slice(0, 3), 'the first three groups').toEqual(['Beginner / Trend', 'Price action / SMC', 'Sessions']);
    const by = (g: string) => m.filter((x) => x.group === g).map((x) => x.value);
    expect(by('Beginner / Trend')).toEqual(['ema_stack', 'ema_cross', 'range_bounce']);
    expect(by('Price action / SMC')).toEqual(['liq_sweep_mss', 'supply_demand', 'sr_flip', 'fvg', 'channel', 'rsi_divergence', 'bb_squeeze']);
    expect(by('Sessions')).toEqual(['ny_open_breakout', 'session_sweep', 'vwap_reclaim']);
    expect(m[0].group, 'the first entry is not in a group').toBe(''); expect(m[m.length - 1].group, 'the last entry is not in a group').toBe('');
    for (const x of m.filter((q) => q.group)) expect(x.title.length, `${x.value} has no tooltip`).toBeGreaterThan(8);
  } finally { await ctx.close(); }
});

test('SM2. every strategy shows a verdict with no broken value and no error', async ({ browser }) => {
  test.setTimeout(480_000); const { ctx, page } = await open(browser, 'en'); const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(`pageerror ${e.message.slice(0, 140)}`)); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|net::ERR|Failed to load resource|status of 4\d\d|status of 5\d\d/i.test(m.text())) errs.push(m.text().slice(0, 140)); });
  try {
    const ids = (await menu(page)).map((x) => x.value).filter((v) => !/^(auto|custom)/i.test(v) && v); const bad: string[] = [];
    console.log(`[STRATS] ${ids.length} strategies: ${ids.join(',')}`);
    for (const id of ids) {
      await page.locator('[data-testid="strategy-set-select"]').first().selectOption(id); await page.waitForTimeout(3_500);
      const v = ((await page.locator('[data-testid="strategy-call-verdict"]').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      const panel = ((await page.locator('.strat-panel').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
      const broken = /\bNaN\b|undefined|\[object|Infinity/.test(panel); console.log(`[STRATS] ${id}: verdict "${v}" broken=${broken} panel "${panel.slice(0, 200)}"`);
      if (!v) bad.push(`${id}: no verdict`); if (broken) bad.push(`${id}: broken value in the panel`);
    }
    expect(bad, 'strategies that did not render a clean verdict').toEqual([]); expect(errs, 'page / console errors while switching strategies').toEqual([]);
  } finally { await ctx.close(); }
});

test('SM3. Russian: the group labels are translated', async ({ browser }) => {
  test.setTimeout(150_000); const { ctx, page } = await open(browser, 'ru');
  try {
    const m = await menu(page); const groups = [...new Set(m.map((x) => x.group).filter(Boolean))]; console.log(`[STRATMENU] ru groups ${JSON.stringify(groups)}`);
    expect(groups.length).toBeGreaterThanOrEqual(3);
    for (const g of groups) { expect(g, `group label "${g}" is the raw key`).not.toMatch(/^STRATEGY_GROUP|^[A-Z_]{8,}$/); expect(/[А-Яа-я]/.test(g), `group label "${g}" is not Russian`).toBe(true); }
  } finally { await ctx.close(); }
});
