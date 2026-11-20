/* The ONE strategy menu on /arena (#2358, owner decision 2026-11-14 option A), signed in as account A. The settings write is STUBBED and recorded (nothing reaches the dev row); the settings READ is patched to play a saved
 * choice back. Candles are the real ones of the build under test (the CI stand-in market) unless a cell fails them on purpose.
 *   M1  the menu: Let the read choose, the sixteen strategies grouped as #2516 ships them (+ bos_fvg, #2566), Custom; no old presets, no duplicate label, no raw key; in en and ru
 *   M2  PM's rules: picking a strategy never removes chips (six write arena_strategy ONLY; Bollinger squeeze ADDS BOLL and writes both in ONE request); a chip tap keeps the strategy; Let the read choose / Custom write arena_strategy: null only
 *   M3  the call box sits directly under the dropdown inside the same panel with name, description, verdict + reason, the signals-not-predictions line; Let the read choose and Custom show no call box
 *   M3u a failed candle read is the LOADING skeleton first and the UNAVAILABLE state only after the SECOND failed read in a row (~50 s; never WAIT), and so is supply / demand when only the BTC read fails (RE-PINNED 2026-11-20 for #2732; M3u, M3u-ny, M3u-btc)
 *   M4  a saved old-preset chip set (no strategy id) shows Custom with every chip intact and NOTHING is written on load
 *   M5  an unknown stored strategy id falls back to Let the read choose, no call box, nothing written
 *   M7  no sideways scroll at 390, 768 and 1280, dark and light, with a call box open; shots named strategy-menu-<width>-<theme>.png
 * (M6, CLS on deployed qa, is qa/e2e/cls-arena-probe*.spec.ts; M8 and the data checks are __tests__/strategyMenu.test.mts.) A cell that finds no menu fails. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

mkdirSync('qa/.shots', { recursive: true });
/* THE MENU AS #2516 + #2566 SHIP IT (16 strategies, GROUPED: Beginner / Trend, Price action / SMC, Sessions): the option order in the DOM is the group order, not the registry order. */
const IDS = ['ema_stack', 'ema_cross', 'range_bounce', 'liq_sweep_mss', 'supply_demand', 'sr_flip', 'fvg', 'bos_fvg', 'channel', 'rsi_divergence', 'bb_squeeze', 'ny_open_breakout', 'session_sweep', 'vwap_reclaim', 'funding_oi_squeeze', 'cvd_absorption'];
const NAMES_EN = ['EMA 20/50/100/200 stack', 'Golden / death cross (EMA 50/200)', 'Range bounce', 'Liquidity sweep + structure shift', 'Supply / demand zone retest', 'Support / resistance flip', 'Fair value gap', 'Break of structure + FVG', 'Channel breakout', 'RSI divergence', 'Bollinger squeeze breakout', 'New York open breakout', 'Asia / London session sweep', 'VWAP reclaim', 'Funding + OI squeeze', 'CVD absorption'];
const OLD = ['Liquidity Sweep', 'Trend Follow', 'Mean Reversion'];

type Open = { width?: number; theme?: 'dark' | 'light'; loc?: string; saved?: string | null; chips?: string[] | null; failKlines?: 'all' | 'btc' | null; coin?: string; tf?: string };
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
  await gotoSignedIn(page, `/arena?coin=${o.coin ?? 'eth'}&tf=${o.tf ?? '1h'}`); await page.waitForTimeout(12_000);
  return { ctx, page, writes };
}
const menu = (p: Page) => p.getByTestId('strategy-set-select');
const box = (p: Page) => p.getByTestId('strategy-call-box');
async function pick(p: Page, v: string) { await menu(p).selectOption(v); await p.waitForTimeout(6_000); }
/* #2604 (release 2026-11-19): a strategy that cannot run on the timeframe is a DISABLED option whose title says why ("Works on 30m or lower."). A disabled option can never be selected, so a loop that picks every id would wait on it until the test timeout (release #2622, mobile: M2 / M3 / M3u hit 170 s at the NEW YORK OPEN option on 1h). NY open runs on 30m or lower: it is disabled on the 1h cells and exercised on 15m. */
const NA_ON_1H = ['ny_open_breakout'];
const optionState = (p: Page, id: string) => p.evaluate(v => { const o = Array.from(document.querySelectorAll('[data-testid="strategy-set-select"] option')).find(x => (x as HTMLOptionElement).value === v) as HTMLOptionElement | undefined; return o ? { disabled: o.disabled, title: o.title } : null; }, id);
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
      for (const x of o.slice(1, 1 + IDS.length)) { expect(x.label, `${x.value} not translated`).toMatch(/[А-Яа-яЁё]/); expect(x.label).not.toMatch(/STRAT_/); }
      expect(new Set(o.map(x => x.label)).size).toBe(o.length);
    } finally { await ctx.close(); }
  });

  /* PM's rules (#2358, final): (1) picking a strategy NEVER removes chips: six strategies leave the chip row as it was and write ONLY arena_strategy; Bollinger squeeze ADDS BOLL (no-op if on) and writes arena_strategy +
   * strategy_selection in ONE request. (2) toggling a chip keeps the strategy and writes strategy_selection only. (3) Let the read choose / Custom write arena_strategy: null only, chips untouched, the call box goes. */
  const strat = (writes: Array<Record<string, unknown>>, from: number) => writes.slice(from).filter(w => 'arena_strategy' in w || 'strategy_selection' in w);
  for (const id of IDS) test(`M2. picking ${id} with SMA already on: ${id === 'bb_squeeze' ? 'ONE request carries arena_strategy and the chips with BOLL added' : 'ONE request carries arena_strategy only'}; SMA stays on`, async ({ browser }) => {
    const { ctx, page, writes } = await openArena(browser, { saved: null, chips: ['SMA'], tf: NA_ON_1H.includes(id) ? '15m' : '1h' });
    try {
      await expect(menu(page)).toBeVisible({ timeout: 30_000 }); const before = writes.length;
      expect(await optionState(page, id), `${id}: the option is disabled on the timeframe this cell opens`).toMatchObject({ disabled: false });
      await pick(page, id);
      const mine = strat(writes, before); console.log(`[M2] ${id} writes ${JSON.stringify(mine)}`);
      expect(mine.length, 'the pick was not saved in ONE request').toBe(1);
      expect(mine[0].arena_strategy).toBe(id);
      if (id === 'bb_squeeze') { expect([...(mine[0].strategy_selection as string[])].sort(), 'Bollinger squeeze must ADD BOLL to the chips').toEqual(['BOLL', 'SMA']); expect(await chipOn(page, 'BOLL')).toBe('true'); }
      else expect('strategy_selection' in mine[0], `${id} must write arena_strategy ONLY (it has no chip to add)`).toBe(false);
      expect(await chipOn(page, 'SMA'), 'the strategy removed the user\'s SMA chip').toBe('true');
      expect(await menu(page).inputValue()).toBe(id);
    } finally { await ctx.close(); }
  });

  test('M2b. Bollinger squeeze when BOLL is already on: the chip stays on once, the strategy is saved, nothing else changes', async ({ browser }) => {
    const { ctx, page, writes } = await openArena(browser, { saved: null, chips: ['BOLL', 'MACD'] });
    try {
      await expect(menu(page)).toBeVisible({ timeout: 30_000 }); const before = writes.length; await pick(page, 'bb_squeeze');
      const mine = strat(writes, before); console.log(`[M2b] writes ${JSON.stringify(mine)}`);
      expect(mine.length).toBe(1); expect(mine[0].arena_strategy).toBe('bb_squeeze');
      if ('strategy_selection' in mine[0]) expect([...(mine[0].strategy_selection as string[])].sort(), 'BOLL duplicated or a chip lost').toEqual(['BOLL', 'MACD']);
      expect(await chipOn(page, 'BOLL')).toBe('true'); expect(await chipOn(page, 'MACD')).toBe('true');
    } finally { await ctx.close(); }
  });

  test('M2c. toggling a chip while a strategy is picked keeps the strategy: strategy_selection only is written, the menu and the call box stay', async ({ browser }) => {
    const { ctx, page, writes } = await openArena(browser, { saved: 'ema_stack', chips: [] });
    try {
      await expect(menu(page)).toBeVisible({ timeout: 30_000 }); await expect(box(page)).toBeVisible({ timeout: 20_000 }); const before = writes.length;
      await page.getByTestId('strategy-indicator-MACD').click(); await page.waitForTimeout(4_000);
      const mine = strat(writes, before); console.log(`[M2c] writes ${JSON.stringify(mine)}`);
      expect(mine.length, 'the chip tap was not one request').toBe(1); expect('arena_strategy' in mine[0], 'a chip tap wrote the strategy').toBe(false); expect(mine[0].strategy_selection).toEqual(['MACD']);
      expect(await menu(page).inputValue(), 'the chip tap changed the menu').toBe('ema_stack'); await expect(box(page), 'the call box went when a chip was toggled').toBeVisible();
    } finally { await ctx.close(); }
  });

  test('M2d. Let the read choose with chips on clears the strategy AND the chips in ONE save, removes the call box, and the menu stays on Let the read choose (hotfix #2408: with the chips left on the menu derived Custom and snapped back)', async ({ browser }) => {
    const { ctx, page, writes } = await openArena(browser, { saved: 'ema_stack', chips: ['SMA', 'MACD'] });
    try {
      await expect(menu(page)).toBeVisible({ timeout: 30_000 }); await expect(box(page)).toBeVisible({ timeout: 20_000 }); const before = writes.length;
      await pick(page, 'auto');
      const mine = strat(writes, before); console.log(`[M2d] writes ${JSON.stringify(mine)}`);
      expect(mine.length, 'Let the read choose must be ONE request').toBe(1); expect(mine[0]).toMatchObject({ arena_strategy: null, strategy_selection: [] });
      await expect(box(page), 'the call box is still showing').toHaveCount(0); expect(await chipOn(page, 'SMA'), 'Let the read choose left the SMA chip on').toBe('false'); expect(await chipOn(page, 'MACD'), 'Let the read choose left the MACD chip on').toBe('false');
      await page.waitForTimeout(2_000);
      expect(await menu(page).inputValue(), 'the menu must STAY on Let the read choose (it used to snap to Custom from chips that were still on)').toBe('auto');
    } finally { await ctx.close(); }
  });

  test('M2e. Custom with a strategy picked writes arena_strategy: null only and leaves the chips; with no chips and no strategy the menu reads Let the read choose', async ({ browser }) => {
    const { ctx, page, writes } = await openArena(browser, { saved: 'bb_squeeze', chips: ['BOLL'] });
    try {
      await expect(menu(page)).toBeVisible({ timeout: 30_000 }); const before = writes.length; await pick(page, 'custom');
      const mine = strat(writes, before); console.log(`[M2e] writes ${JSON.stringify(mine)}`);
      expect(mine.length).toBe(1); expect(mine[0]).toMatchObject({ arena_strategy: null }); expect('strategy_selection' in mine[0]).toBe(false);
      await expect(box(page)).toHaveCount(0); expect(await chipOn(page, 'BOLL')).toBe('true'); expect(await menu(page).inputValue()).toBe('custom');
    } finally { await ctx.close(); }
    const e = await openArena(browser, { saved: null, chips: [] });
    try { await expect(menu(e.page)).toBeVisible({ timeout: 30_000 }); expect(await menu(e.page).inputValue(), 'nothing saved must read Let the read choose').toBe('auto'); } finally { await e.ctx.close(); }
  });

  test('M2n. NY open on 1h is a DISABLED option with its reason as the title; nothing is written; the only strategy disabled on 1h is NY open', async ({ browser }) => {
    const { ctx, page, writes } = await openArena(browser, { saved: null, chips: [] });
    try {
      await expect(menu(page)).toBeVisible({ timeout: 30_000 });
      const off: string[] = []; for (const id of IDS) { const o = await optionState(page, id); expect(o, `${id}: option missing`).not.toBeNull(); if (o!.disabled) { off.push(id); expect(o!.title, `${id}: a disabled option must say why`).toMatch(/Works on \d+\s?\w+ or (lower|higher)/); } }
      expect(off, 'the strategies disabled on 1h').toEqual(NA_ON_1H);
      expect((await optionState(page, 'ny_open_breakout'))!.title).toBe('Works on 30m or lower.');
      expect(writes.filter(w => 'arena_strategy' in w || 'strategy_selection' in w), 'something was written').toEqual([]);
    } finally { await ctx.close(); }
  });

  test('M3. the call box sits directly under the menu in the same panel with every part; Let the read choose and Custom show none', async ({ browser }) => {
    const { ctx, page } = await openArena(browser, { saved: null, chips: [] });
    try {
      await expect(menu(page)).toBeVisible({ timeout: 30_000 });
      await expect(box(page), 'a call box shows with no strategy picked').toHaveCount(0);
      for (const id of IDS) {
        if (NA_ON_1H.includes(id)) { expect((await optionState(page, id))!.disabled, `${id}: expected disabled on 1h (#2604)`).toBe(true); continue; }
        await pick(page, id); await expect(box(page), `${id}: no call box`).toBeVisible({ timeout: 20_000 });
        const g = await page.evaluate(() => {
          const s = document.querySelector('[data-testid="strategy-set-select"]') as HTMLElement; const b = document.querySelector('[data-testid="strategy-call-box"]') as HTMLElement;
          const sr = s.getBoundingClientRect(), br = b.getBoundingClientRect(); let a: HTMLElement | null = s; let same = false; while (a) { if (a.contains(b)) { same = a.contains(s) && a !== document.body && a !== document.documentElement; break; } a = a.parentElement; }
          return { under: br.top >= sr.bottom - 1, gap: Math.round(br.top - sr.bottom), h: Math.round(br.height), name: b.querySelector('[data-testid="strategy-call-name"]')?.textContent ?? '', desc: (b.querySelector('[data-testid="strategy-call-desc"]')?.textContent ?? '').length, verdict: b.querySelector('[data-testid="strategy-call-verdict"]')?.getAttribute('data-verdict') ?? null, unavailable: !!b.querySelector('[data-testid="strategy-call-unavailable"]'), loading: !!b.querySelector('[data-testid="strategy-call-loading"]'), reason: (b.querySelector('[data-testid="strategy-call-reason"]')?.textContent ?? '').length, note: b.querySelector('[data-testid="strategy-call-note"]')?.textContent ?? '', text: (b.textContent || '') };
        });
        console.log(`[M3] ${id} ${JSON.stringify({ ...g, text: g.text.slice(0, 80) })}`);
        expect(g.under, `${id}: the box is not under the menu`).toBe(true); expect(g.gap, `${id}: the box is far from the menu`).toBeLessThan(80); expect(g.h, `${id}: the reserved height is gone`).toBeGreaterThanOrEqual(80); /* #2500 compact panel: the reserved call-box height is ~84 px now (was 140); CLS cells prove nothing shifts */ /* #2366/#2373: the box is the reserved call block (>= 142 on a tablet, 163 on a phone, 201 wide) plus the description row and the note; it was >= 200 when the box carried a name heading and a card */
        expect(g.name, `${id}: the duplicate name heading is back (#2366: the menu already says which strategy)`).toBe(''); expect(g.desc, `${id}: no description`).toBeGreaterThan(20); { /* #2500 compact panel: "Signals, not predictions." is part of the EXPANDED explainer now, not a line of its own: open it first */
          let note = g.note; if (!note) { await box(page).getByRole('button', { name: /expand/i }).first().click().catch(() => undefined); await page.waitForTimeout(500); note = (await box(page).getByTestId('strategy-call-note').textContent().catch(() => '')) ?? ''; }
          expect(note, `${id}: no signals-not-predictions line`).toMatch(/not predictions/i); }
        expect(g.verdict !== null || g.unavailable || g.loading, `${id}: neither a verdict, a loading nor an unavailable state`).toBe(true);
        if (g.verdict) { expect(['buy', 'sell', 'wait']).toContain(g.verdict); expect(g.reason, `${id}: a verdict with no reason`).toBeGreaterThan(20); }
        expect(g.text, `${id}: a raw label key shows`).not.toMatch(/STRAT_[A-Z_]+/);
      }
      for (const v of ['auto', 'custom']) { await pick(page, v); await expect(box(page), `${v}: a call box is showing`).toHaveCount(0); }
    } finally { await ctx.close(); }
  });

  test('M3n. NY open on 15m: selectable; the call box shows with a verdict, the loading or the unavailable state and no raw key', async ({ browser }) => {
    const { ctx, page } = await openArena(browser, { saved: null, chips: [], tf: '15m' });
    try {
      await expect(menu(page)).toBeVisible({ timeout: 30_000 });
      expect((await optionState(page, 'ny_open_breakout'))!.disabled, 'NY open is disabled on 15m').toBe(false);
      await pick(page, 'ny_open_breakout'); await expect(box(page), 'no call box for NY open on 15m').toBeVisible({ timeout: 20_000 });
      const text = (await box(page).innerText()).replace(/\s+/g, ' '); console.log(`[M3n] ny_open_breakout 15m: ${text.slice(0, 120)}`);
      expect(text, 'a raw label key shows').not.toMatch(/STRAT_[A-Z_]+/);
      await expect(page.getByTestId('strategy-call-verdict').or(page.getByTestId('strategy-call-unavailable')).or(page.getByTestId('strategy-call-cant-run')), 'NY open on 15m shows no settled state').toBeVisible({ timeout: 20_000 });
    } finally { await ctx.close(); }
  });

  /* RE-PINNED 2026-11-20 for #2732 (PM option A, "retries first, the word only after them"; written rule: a FAILED candle read from load shows the LOADING skeleton first, and the unavailable state only after the SECOND failed read in a row, a 45 s retry later, about 50 s from load; failKlines 'all' still ends in the unavailable state, later).
   * M3u used to expect `strategy-call-unavailable` within 20 s of every pick, which is older than the change. It now pins the order: at the first look (about 12 s after load, or 6 s after a pick) the box shows the SKELETON, no unavailable state and no verdict (never WAIT); the unavailable state is NOT there yet and MUST be there by the end of a 100 s window.
   * Every pick restarts the hook (a new strategy is a new read with its own count), so the end state is awaited for the strategy saved at load (the "about 50 s from load" case), for the LAST strategy picked, and for NY open on 15m / supply-demand-with-BTC-failing in their own tests; the strategies in between are pinned on the skeleton, never a verdict. The control for all of it is the same flow with no failure (M3, M2c, M6s: a verdict and no unavailable state). */
  const NOT_YET = 'a failed read must show the loading skeleton first: the unavailable state may only appear after the second failed read in a row (about 50 s)';
  const unavailableBy = async (p: Page, what: string) => { await expect(p.getByTestId('strategy-call-unavailable'), `${what}: the unavailable state never appeared after the retry (two failed reads, about 50 s from the start)`).toBeVisible({ timeout: 100_000 }); await expect(p.getByTestId('strategy-call-verdict'), `${what}: a verdict (WAIT) is showing next to a failed read`).toHaveCount(0); await expect(p.getByTestId('strategy-call-loading'), `${what}: the skeleton is still showing once the unavailable state is`).toHaveCount(0); };
  const skeletonNow = async (p: Page, what: string) => { await expect(p.getByTestId('strategy-call-loading'), `${what}: no loading skeleton on the first failed read`).toBeVisible({ timeout: 5_000 }); await expect(p.getByTestId('strategy-call-unavailable'), `${what}: ${NOT_YET}`).toHaveCount(0); await expect(p.getByTestId('strategy-call-verdict'), `${what}: a verdict (WAIT) is showing on a failed read`).toHaveCount(0); };

  test('M3u. a failed candle read is the loading skeleton first and the UNAVAILABLE state only after the second failed read, for every strategy, never WAIT', async ({ browser }) => {
    test.setTimeout(420_000);
    const a = await openArena(browser, { saved: 'ema_stack', chips: [], failKlines: 'all' });
    try {
      await expect(menu(a.page)).toBeVisible({ timeout: 30_000 });
      await expect(box(a.page), 'no call box for the strategy saved at load').toBeVisible({ timeout: 20_000 });
      await skeletonNow(a.page, 'ema_stack from load (about 12 s)');   /* the first read has failed, the retry is 45 s away */
      await unavailableBy(a.page, 'ema_stack from load');
      let last = 'ema_stack';
      for (const id of IDS) {
        if (id === 'ema_stack') continue;
        if (NA_ON_1H.includes(id)) { expect((await optionState(a.page, id))!.disabled, `${id}: expected disabled on 1h (#2604)`).toBe(true); continue; }
        await pick(a.page, id); await skeletonNow(a.page, `${id} right after the pick`); last = id;
      }
      await unavailableBy(a.page, `${last} (the last strategy picked)`);
    } finally { await a.ctx.close(); }
  });

  test('M3u-ny. NY open on 15m with every candle read failing: the skeleton first, the unavailable state after the second failed read', async ({ browser }) => {
    test.setTimeout(240_000);
    const n = await openArena(browser, { saved: null, chips: [], failKlines: 'all', tf: '15m' });
    try {
      await expect(menu(n.page)).toBeVisible({ timeout: 30_000 });
      await pick(n.page, 'ny_open_breakout'); await skeletonNow(n.page, 'ny_open_breakout on 15m'); await unavailableBy(n.page, 'ny_open_breakout on 15m');
    } finally { await n.ctx.close(); }
  });

  test('M3u-btc. supply / demand with only the BTC read failing: the skeleton first, the unavailable state after the second failed read; a strategy that does not need BTC keeps its verdict', async ({ browser }) => {
    test.setTimeout(300_000);
    const b = await openArena(browser, { saved: null, chips: [], failKlines: 'btc', coin: 'eth' });
    try {
      await expect(menu(b.page)).toBeVisible({ timeout: 30_000 });
      await pick(b.page, 'supply_demand'); await skeletonNow(b.page, 'supply_demand with BTC failing'); await unavailableBy(b.page, 'supply_demand with BTC failing');
      await pick(b.page, 'ema_stack'); await expect(b.page.getByTestId('strategy-call-verdict'), 'a strategy that does not need BTC lost its verdict').toBeVisible({ timeout: 20_000 }); await expect(b.page.getByTestId('strategy-call-unavailable'), 'a strategy that does not need BTC shows the unavailable state').toHaveCount(0);
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
