/* The Arena strategy card (#2307 and the strategies stacked on it up to #2316), signed in as account A, reads only (the settings write is stubbed and recorded). Expectations are the PR text:
 *   K1  the card has a picker with None + 7 strategies, always says "Signals, not predictions", and choosing a strategy sends { arena_strategy: <id> } to /api/settings
 *   K2  each of the 7 strategies, one by one: a verdict (buy / sell / wait) or the unavailable state shows, with its sentence in words (no raw label key, no blank), and a shot at 390
 *   K3  a failed candle read shows the UNAVAILABLE state, never WAIT (unknown is not neutral)
 *   K4  strategy 4 (supply/demand) needs BTC: with only the BTC read failing on a non-BTC coin it shows unavailable, while a strategy that does not need BTC still shows a verdict
 *   K5  Russian: the card reads in Russian (no raw key, Cyrillic sentence), for strategy 1 and strategy 4
 *   K6  the saved choice comes back: with the settings read returning arena_strategy, the picker shows it
 * A cell that finds no card fails. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

mkdirSync('qa/.shots', { recursive: true });
const IDS = ['liq_sweep_mss', 'ny_open_breakout', 'ema_stack', 'supply_demand', 'bb_squeeze', 'vwap_reclaim', 'rsi_divergence'];

async function openArena(browser: import('@playwright/test').Browser, o: { width?: number; loc?: string; coin?: string; saved?: string | null; failKlines?: 'all' | 'btc' | null } = {}) {
  const ctx = await signedInContext(browser, 'a');
  await ctx.addInitScript(([l]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [o.loc ?? 'en']);
  const page = await ctx.newPage(); if (o.width) await page.setViewportSize({ width: o.width, height: 900 });
  await installPaidAiFence(page);
  const writes: unknown[] = [];
  /* the settings WRITE goes through /api/settings (stubbed and recorded); the READ is a browser Supabase call to the user_settings table, so a saved choice is played back by patching that response */
  await page.route(/\/api\/settings(\?|$)/, async route => {
    const req = route.request(); if (req.method() === 'GET') return route.fallback();
    writes.push(req.postDataJSON()); return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  /* a signed-in account's language comes from its settings row, not from localStorage, so Russian is played back the same way */
  const patchRow: Record<string, unknown> = {}; if (o.saved !== undefined) patchRow.arena_strategy = o.saved; if (o.loc && o.loc !== 'en') patchRow.language = o.loc;
  if (Object.keys(patchRow).length) await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res });
    const patch = (r: Record<string, unknown>) => ({ ...r, ...patchRow });
    return route.fulfill({ response: res, json: Array.isArray(body) ? body.map(patch) : patch(body as Record<string, unknown>) });
  });
  /* candles come from /api/market/klines?source=bybit|binance-futures|okx&symbol=...: failing them all, or only BTC's, makes a failed read */
  if (o.failKlines) await page.route(/\/api\/market\/klines\?/, route => {
    if (o.failKlines === 'btc' && !/symbol=BTC/i.test(route.request().url())) return route.fallback();
    return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"stub"}' });
  });
  await gotoSignedIn(page, `/arena?coin=${o.coin ?? 'eth'}&tf=1h`); await page.waitForTimeout(12_000);
  return { ctx, page, writes };
}
const card = (page: Page) => page.getByTestId('arena-strategy-card');
async function choose(page: Page, id: string) { await page.getByTestId('arena-strategy-select').selectOption(id); await page.waitForTimeout(6_000); }
const read = (page: Page) => page.evaluate(() => {
  const c = document.querySelector('[data-testid="arena-strategy-card"]') as HTMLElement | null; if (!c) return null;
  const v = c.querySelector('[data-testid="arena-strategy-verdict"]') as HTMLElement | null; const e = c.querySelector('[data-testid="arena-strategy-error"]');
  return { text: (c.textContent || '').replace(/\s+/g, ' ').trim(), verdict: v ? v.getAttribute('data-verdict') : null, error: !!e, options: Array.from(c.querySelectorAll('select option')).map(o => (o as HTMLOptionElement).value) };
});

test.describe('Arena strategy card', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.describe.configure({ timeout: 170_000 });

  test('K1. the picker lists None + 7 strategies, the card says signals not predictions, choosing sends arena_strategy', async ({ browser }) => {
    const { ctx, page, writes } = await openArena(browser);
    try {
      await expect(card(page), 'no strategy card on /arena').toBeVisible({ timeout: 30_000 });
      const s = await read(page); console.log(`[K1] ${JSON.stringify(s)}`);
      expect(s!.options).toEqual(['', ...IDS]); expect(s!.text).toMatch(/Signals, not predictions/i);
      await choose(page, 'ema_stack');
      console.log(`[K1] settings writes: ${JSON.stringify(writes)}`);
      expect(writes.some(w => (w as { arena_strategy?: string })?.arena_strategy === 'ema_stack'), `no arena_strategy write: ${JSON.stringify(writes)}`).toBe(true);
    } finally { await ctx.close(); }
  });

  for (const id of IDS) test(`K2. ${id}: shows a verdict or the unavailable state, in words`, async ({ browser }) => {
    const { ctx, page } = await openArena(browser, { width: 390 });
    try {
      await expect(card(page)).toBeVisible({ timeout: 30_000 }); await choose(page, id);
      const s = (await read(page))!; console.log(`[K2] ${id} verdict=${s.verdict} error=${s.error} text=${s.text.slice(0, 200)}`);
      await card(page).scrollIntoViewIfNeeded(); await card(page).screenshot({ path: `qa/.shots/strategy-card-${id}-390.png` });
      expect(s.verdict !== null || s.error, 'neither a verdict nor the unavailable state').toBe(true);
      if (s.verdict) expect(['buy', 'sell', 'wait']).toContain(s.verdict);
      expect(s.text, 'a raw label key is showing').not.toMatch(/STRAT_[A-Z_]+/);
      expect(s.text.length, 'the card is nearly empty').toBeGreaterThan(60);
    } finally { await ctx.close(); }
  });

  test('K3. a failed candle read is UNAVAILABLE, never wait', async ({ browser }) => {
    const { ctx, page } = await openArena(browser, { failKlines: 'all' });
    try {
      await expect(card(page)).toBeVisible({ timeout: 30_000 });
      for (const id of IDS) { await choose(page, id); const s = (await read(page))!; console.log(`[K3] ${id} verdict=${s.verdict} error=${s.error}`); expect(s.error, `${id}: no unavailable state on a failed read`).toBe(true); expect(s.verdict, `${id}: a failed read drew a verdict`).toBeNull(); }
    } finally { await ctx.close(); }
  });

  test('K4. only the BTC read failing: supply/demand shows unavailable; a strategy that does not need BTC still answers', async ({ browser }) => {
    const { ctx, page } = await openArena(browser, { failKlines: 'btc', coin: 'eth' });
    try {
      await expect(card(page)).toBeVisible({ timeout: 30_000 });
      await choose(page, 'ema_stack'); const a = (await read(page))!; console.log(`[K4] ema_stack verdict=${a.verdict} error=${a.error}`);
      expect(a.verdict, 'a strategy without BTC needs should still answer on ETH').not.toBeNull();
      await choose(page, 'supply_demand'); const b = (await read(page))!; console.log(`[K4] supply_demand verdict=${b.verdict} error=${b.error}`);
      expect(b.error, 'supply/demand with no BTC read must be unavailable').toBe(true); expect(b.verdict).toBeNull();
    } finally { await ctx.close(); }
  });

  for (const id of ['liq_sweep_mss', 'supply_demand']) test(`K5. Russian: ${id} reads in Russian`, async ({ browser }) => {
    const { ctx, page } = await openArena(browser, { loc: 'ru' });
    try {
      await expect(card(page)).toBeVisible({ timeout: 30_000 }); await choose(page, id);
      const s = (await read(page))!; console.log(`[K5] ${id} ${s.text.slice(0, 220)}`);
      await card(page).screenshot({ path: `qa/.shots/strategy-card-${id}-ru.png` });
      expect(s.text, 'a raw label key is showing').not.toMatch(/STRAT_[A-Z_]+/); expect(s.text).toMatch(/[Ѐ-ӿ]{4,}/);
      expect(s.text).toMatch(/Сигналы, а не прогнозы|прогноз/i);
    } finally { await ctx.close(); }
  });

  test('K6. a saved choice comes back from the settings read', async ({ browser }) => {
    const { ctx, page } = await openArena(browser, { saved: 'vwap_reclaim' });
    try {
      await expect(card(page)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('arena-strategy-select')).toHaveValue('vwap_reclaim', { timeout: 15_000 });
    } finally { await ctx.close(); }
  });
});
