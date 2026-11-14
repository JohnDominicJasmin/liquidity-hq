/* The ONE strategy menu on /arena (#2358, owner decision 2026-11-14 option A), signed in as account A. The settings write is STUBBED and recorded (nothing reaches the dev row); the settings READ is patched to play a saved
 * choice back. Candles are the real ones of the build under test (the CI stand-in market) unless a cell fails them on purpose.
 *   M1  the menu: Let the read choose, the seven strategies in the owner's order, Custom; no old presets, no duplicate label, no raw key; in en and ru
 *   M2  picking a strategy writes arena_strategy AND strategy_selection in ONE request; only Bollinger squeeze turns a chip on (BOLL), every other strategy writes strategy_selection []
 *   M3  the call box sits directly under the dropdown inside the same panel with name, description, verdict + reason, the signals-not-predictions line; Let the read choose and Custom show no call box; a failed candle read
 *       is the UNAVAILABLE state (never WAIT), and so is supply / demand when only the BTC read fails
 *   M4  a saved old-preset chip set (no strategy id) shows Custom with every chip intact and NOTHING is written on load
 *   M5  an unknown stored strategy id falls back to Let the read choose, no call box, nothing written
 *   M7  no sideways scroll at 390, 768 and 1280, dark and light, with a call box open; shots named strategy-menu-<width>-<theme>.png
 * (M6, CLS on deployed qa, is qa/e2e/cls-arena-probe*.spec.ts; M8 and the data checks are __tests__/strategyMenu.test.mts.) A cell that finds no menu fails. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

mkdirSync('qa/.shots', { recursive: true });
const IDS = ['liq_sweep_mss', 'ny_open_breakout', 'ema_stack', 'supply_demand', 'bb_squeeze', 'vwap_reclaim', 'rsi_divergence'];
const NAMES_EN = ['Liquidity sweep + structure shift', 'New York open breakout', 'EMA 20/50/100/200 stack', 'Supply / demand zone retest', 'Bollinger squeeze breakout', 'VWAP reclaim', 'RSI divergence'];
const OLD = ['Liquidity Sweep', 'Trend Follow', 'Mean Reversion'];

type Open = { width?: number; theme?: 'dark' | 'light'; loc?: string; saved?: string | null; chips?: string[] | null; failKlines?: 'all' | 'btc' | null; coin?: string };
async function openArena(browser: Browser, o: Open = {}) {
  const ctx = await signedInContext(browser, 'a');
  await ctx.addInitScript(([l, t]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [o.loc ?? 'en', o.theme ?? 'dark']);
  const page = await ctx.newPage(); await page.setViewportSize({ width: o.width ?? 1280, height: (o.width ?? 1280) < 500 ? 844 : 900 });
  await installPaidAiFence(page);
  const writes: Array<Record<string, unknown>> = [];
  /* the settings WRITE goes through /api/settings (stubbed, recorded, answered like the real route so the page treats it as saved) */
  await page.route(/\/api\/settings(\?|$)/, async route => {
    const req = route.request(); if (req.method() === 'GET') return route.fallback();
    const body = (req.postDataJSON() ?? {}) as Record<string, unknown>; writes.push(body);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: Object.keys(body).filter(k => k !== 'knownAsOf'), rejected: [], settings: null }) });
  });
  /* the READ is a browser Supabase call to the user_settings table: a saved choice (or language) is played back by patching that response */
  const patchRow: Record<string, unknown> = { arena_sound: false };
  if (o.saved !== undefined) patchRow.arena_strategy = o.saved; if (o.chips !== undefined) patchRow.strategy_selection = o.chips; if (o.loc && o.loc !== 'en') patchRow.language = o.loc;
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res });
    const patch = (r: Record<string, unknown>) => ({ ...r, ...patchRow });
    return route.fulfill({ response: res, json: Array.isArray(body) ? body.map(patch) : patch(body as Record<string, unknown>) });
  });
  if (o.failKlines) await page.route(/\/api\/market\/klines\?/, route => {
    if (o.failKlines === 'btc' && !/symbol=BTC/i.test(route.request().url())) return route.fallback();
    return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"stub"}' });
  });
  await gotoSignedIn(page, `/arena?coin=${o.coin ?? 'eth'}&tf=1h`); await page.waitForTimeout(12_000);
  return { ctx, page, writes };
}
const menu = (p: Page) => p.getByTestId('strategy-set-select');
const box = (p: Page) => p.getByTestId('strategy-call-box');
async function pick(p: Page, v: string) { await menu(p).selectOption(v); await p.waitForTimeout(6_000); }
const options = (p: Page) => p.evaluate(() => Array.from(document.querySelectorAll('[data-testid="strategy-set-select"] option')).map(o => ({ value: (o as HTMLOptionElement).value, label: (o.textContent || '').trim() })));
const chipOn = (p: Page, id: string) => p.getByTestId(`strategy-indicator-${id}`).getAttribute('aria-pressed');

test.describe('one strategy menu (#2358)', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.describe.configure({ timeout: 170_000 });

  test('M1. the menu is Let the read choose, the seven strategies in order, Custom: no old presets, no duplicates, no raw key', async ({ browser }) => {
    const { ctx, page } = await openArena(browser);
    try {
      await expect(menu(page), 'no strategy menu on /arena').toBeVisible({ timeout: 30_000 });
      const o = await options(page); console.log(`[M1] ${JSON.stringify(o)}`);
      expect(o.map(x => x.value)).toEqual(['auto', ...IDS, 'custom']);
      expect(o.map(x => x.label)).toEqual(['Let the read choose', ...NAMES_EN, 'Custom']);
      for (const old of OLD) expect(o.some(x => x.label === old), `the old preset "${old}" is back`).toBe(false);
      expect(new Set(o.map(x => x.label)).size, 'a duplicate label').toBe(o.length);
      expect(o.some(x => /STRAT_|_NAME/.test(x.label)), 'a raw label key is showing').toBe(false);
    } finally { await ctx.close(); }
  });

  test('M1r. Russian: the strategy names read in Russian, no raw key, same values in the same order', async ({ browser }) => {
    const { ctx, page } = await openArena(browser, { loc: 'ru' });
    try {
      await expect(menu(page)).toBeVisible({ timeout: 30_000 });
      const o = await options(page); console.log(`[M1r] ${JSON.stringify(o)}`);
      expect(o.map(x => x.value)).toEqual(['auto', ...IDS, 'custom']);
      for (const x of o.slice(1, 8)) { expect(x.label, `${x.value} not translated`).toMatch(/[А-Яа-яЁё]/); expect(x.label).not.toMatch(/STRAT_/); }
      expect(new Set(o.map(x => x.label)).size).toBe(o.length);
    } finally { await ctx.close(); }
  });

  for (const id of IDS) test(`M2. picking ${id}: one request carries arena_strategy and strategy_selection; ${id === 'bb_squeeze' ? 'the Bollinger chip lights' : 'no chip is switched on'}`, async ({ browser }) => {
    const { ctx, page, writes } = await openArena(browser, { saved: null, chips: [] });
    try {
      await expect(menu(page)).toBeVisible({ timeout: 30_000 }); const before = writes.length;
      await pick(page, id);
      const mine = writes.slice(before).filter(w => 'arena_strategy' in w || 'strategy_selection' in w); console.log(`[M2] ${id} writes ${JSON.stringify(mine)}`);
      expect(mine.length, 'the pick was not saved in ONE request').toBe(1);
      expect(mine[0].arena_strategy).toBe(id); expect(mine[0].strategy_selection).toEqual(id === 'bb_squeeze' ? ['BOLL'] : []);
      expect(await menu(page).inputValue()).toBe(id);
      if (id === 'bb_squeeze') expect(await chipOn(page, 'BOLL'), 'the Bollinger chip is not on').toBe('true');
      else for (const c of ['SMA', 'PSAR', 'MACD', 'BOLL']) expect(await chipOn(page, c).catch(() => 'absent'), `${c} is on after picking ${id}`).not.toBe('true');
    } finally { await ctx.close(); }
  });

  test('M3. the call box sits directly under the menu in the same panel with every part; Let the read choose and Custom show none', async ({ browser }) => {
    const { ctx, page } = await openArena(browser, { saved: null, chips: [] });
    try {
      await expect(menu(page)).toBeVisible({ timeout: 30_000 });
      await expect(box(page), 'a call box shows with no strategy picked').toHaveCount(0);
      for (const id of IDS) {
        await pick(page, id); await expect(box(page), `${id}: no call box`).toBeVisible({ timeout: 20_000 });
        const g = await page.evaluate(() => {
          const s = document.querySelector('[data-testid="strategy-set-select"]') as HTMLElement; const b = document.querySelector('[data-testid="strategy-call-box"]') as HTMLElement;
          const sr = s.getBoundingClientRect(), br = b.getBoundingClientRect(); let a: HTMLElement | null = s; let same = false; while (a) { if (a.contains(b)) { same = a.contains(s) && a !== document.body && a !== document.documentElement; break; } a = a.parentElement; }
          return { under: br.top >= sr.bottom - 1, gap: Math.round(br.top - sr.bottom), h: Math.round(br.height), name: b.querySelector('[data-testid="strategy-call-name"]')?.textContent ?? '', desc: (b.querySelector('[data-testid="strategy-call-desc"]')?.textContent ?? '').length, verdict: b.querySelector('[data-testid="strategy-call-verdict"]')?.getAttribute('data-verdict') ?? null, unavailable: !!b.querySelector('[data-testid="strategy-call-unavailable"]'), loading: !!b.querySelector('[data-testid="strategy-call-loading"]'), reason: (b.querySelector('[data-testid="strategy-call-reason"]')?.textContent ?? '').length, note: b.querySelector('[data-testid="strategy-call-note"]')?.textContent ?? '', text: (b.textContent || '') };
        });
        console.log(`[M3] ${id} ${JSON.stringify({ ...g, text: g.text.slice(0, 80) })}`);
        expect(g.under, `${id}: the box is not under the menu`).toBe(true); expect(g.gap, `${id}: the box is far from the menu`).toBeLessThan(80); expect(g.h, `${id}: the reserved height is gone`).toBeGreaterThanOrEqual(200);
        expect(g.name.length, `${id}: no name`).toBeGreaterThan(3); expect(g.desc, `${id}: no description`).toBeGreaterThan(20); expect(g.note, `${id}: no signals-not-predictions line`).toMatch(/not predictions/i);
        expect(g.verdict !== null || g.unavailable || g.loading, `${id}: neither a verdict, a loading nor an unavailable state`).toBe(true);
        if (g.verdict) { expect(['buy', 'sell', 'wait']).toContain(g.verdict); expect(g.reason, `${id}: a verdict with no reason`).toBeGreaterThan(20); }
        expect(g.text, `${id}: a raw label key shows`).not.toMatch(/STRAT_[A-Z_]+/);
      }
      for (const v of ['auto', 'custom']) { await pick(page, v); await expect(box(page), `${v}: a call box is showing`).toHaveCount(0); }
    } finally { await ctx.close(); }
  });

  test('M3u. a failed candle read is the UNAVAILABLE state for every strategy, never WAIT; supply / demand is unavailable when only BTC fails', async ({ browser }) => {
    const a = await openArena(browser, { saved: null, chips: [], failKlines: 'all' });
    try {
      await expect(menu(a.page)).toBeVisible({ timeout: 30_000 });
      for (const id of IDS) { await pick(a.page, id); await expect(a.page.getByTestId('strategy-call-unavailable'), `${id}: no unavailable state on a failed read`).toBeVisible({ timeout: 20_000 }); await expect(a.page.getByTestId('strategy-call-verdict')).toHaveCount(0); }
    } finally { await a.ctx.close(); }
    const b = await openArena(browser, { saved: null, chips: [], failKlines: 'btc', coin: 'eth' });
    try {
      await expect(menu(b.page)).toBeVisible({ timeout: 30_000 });
      await pick(b.page, 'supply_demand'); await expect(b.page.getByTestId('strategy-call-unavailable'), 'supply / demand with only BTC failing is not unavailable').toBeVisible({ timeout: 20_000 });
      await pick(b.page, 'ema_stack'); await expect(b.page.getByTestId('strategy-call-verdict'), 'a strategy that does not need BTC lost its verdict').toBeVisible({ timeout: 20_000 });
    } finally { await b.ctx.close(); }
  });

  test('M4. a saved old-preset chip set (no strategy id) shows Custom with every chip intact and nothing is written on load', async ({ browser }) => {
    const { ctx, page, writes } = await openArena(browser, { saved: null, chips: ['SMA', 'MACD'] });
    try {
      await expect(menu(page)).toBeVisible({ timeout: 30_000 });
      expect(await menu(page).inputValue(), 'the menu does not show Custom').toBe('custom');
      expect(await chipOn(page, 'SMA')).toBe('true'); expect(await chipOn(page, 'MACD')).toBe('true'); expect(await chipOn(page, 'BOLL')).not.toBe('true');
      await expect(box(page)).toHaveCount(0);
      expect(writes.filter(w => 'arena_strategy' in w || 'strategy_selection' in w), 'something was written on load').toEqual([]);
    } finally { await ctx.close(); }
  });

  test('M5. an unknown stored strategy id falls back to Let the read choose: no call box, no crash, nothing written', async ({ browser }) => {
    const { ctx, page, writes } = await openArena(browser, { saved: 'no_such_strategy', chips: [] });
    const errors: string[] = []; page.on('pageerror', e => errors.push(String(e).slice(0, 120)));
    try {
      await expect(menu(page)).toBeVisible({ timeout: 30_000 });
      expect(await menu(page).inputValue()).toBe('auto'); await expect(box(page)).toHaveCount(0);
      expect(writes.filter(w => 'arena_strategy' in w || 'strategy_selection' in w)).toEqual([]); expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
    } finally { await ctx.close(); }
  });

  test('M6s. a saved strategy comes back: the menu shows it and its call box is there (the old K6)', async ({ browser }) => {
    const { ctx, page, writes } = await openArena(browser, { saved: 'rsi_divergence', chips: [] });
    try {
      await expect(menu(page)).toBeVisible({ timeout: 30_000 }); expect(await menu(page).inputValue()).toBe('rsi_divergence'); await expect(box(page)).toBeVisible({ timeout: 20_000 });
      expect(await box(page).getAttribute('data-strategy')).toBe('rsi_divergence'); expect(writes.filter(w => 'arena_strategy' in w || 'strategy_selection' in w), 'a saved choice was re-written on load').toEqual([]);
    } finally { await ctx.close(); }
  });

  for (const theme of ['dark', 'light'] as const) for (const width of [390, 768, 1280] as const) test(`M7. ${width} ${theme}: no sideways scroll with a call box open; shot`, async ({ browser }) => {
    const { ctx, page } = await openArena(browser, { width, theme, saved: 'ema_stack', chips: [] });
    try {
      await expect(menu(page)).toBeVisible({ timeout: 30_000 }); await expect(box(page)).toBeVisible({ timeout: 20_000 }); await menu(page).scrollIntoViewIfNeeded(); await page.waitForTimeout(600);
      const sc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth, b: (document.querySelector('[data-testid="strategy-call-box"]') as HTMLElement).getBoundingClientRect().right }));
      console.log(`[M7] ${width} ${theme} ${JSON.stringify(sc)}`);
      await page.screenshot({ path: `qa/.shots/strategy-menu-${width}-${theme}.png`, mask: [page.locator('.tnav-drop-email'), page.locator('text=/@/')], maskColor: '#000000' });
      await box(page).screenshot({ path: `qa/.shots/strategy-menu-box-${width}-${theme}.png` }).catch(() => {});
      expect(sc.sw, 'the page scrolls sideways').toBeLessThanOrEqual(sc.vw); expect(sc.b, 'the call box runs past the viewport').toBeLessThanOrEqual(sc.vw);
    } finally { await ctx.close(); }
  });
});
