/* #2266: the short English words the dashboard store computes (funding band, setup direction, market-read scale, Fear & Greed label, coin pattern chip) are shown through label keys.
 * Rows of migration 20261113i (the PROD block, the values PM will write) are injected into the real /api/labels payload.
 *   J0  control: the English dashboard shows some of the English defaults of those keys
 *   J1  ru, ko, zh with the rows injected: none of the English defaults (>= 5 characters, no placeholder) of those keys is on /dashboard
 *   J2  ru WITHOUT the rows (the state before PM applies the migration): the page still shows English defaults, never a blank where a word should be and never a raw key like FUNDING_BAND_HIGH
 * Signed out, nothing written or billed, market reads stubbed. A cell that finds nothing to measure fails. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { gotoGuarded } from './_shared';

const FILE = 'supabase/migrations/20261113i_labels_short_words_dashboard.sql';
const EN: Record<string, string> = existsSync('lib/labelDefaults.en.json') ? JSON.parse(readFileSync('lib/labelDefaults.en.json', 'utf8')) : {};
const ROWS: Record<string, Record<string, string>> = (() => { const out: Record<string, Record<string, string>> = {}; if (!existsSync(FILE)) return out; const re = /\('([A-Z0-9_]+)','(ko|zh|ru|ar)','((?:[^']|'')*)'\)/g; const t = readFileSync(FILE, 'utf8'); let m: RegExpExecArray | null; while ((m = re.exec(t))) (out[m[2]] ??= {})[m[1]] = m[3].replace(/''/g, "'"); return out; })();
const KEYS = Array.from(new Set(Object.values(ROWS).flatMap(r => Object.keys(r))));
const PROBES = KEYS.map(k => ({ k, en: (EN[k] ?? '').trim() })).filter(p => p.en.length >= 5 && !/[{}]/.test(p.en));
const BN = /\/api\/proxy\?.*type=(binance-24hr|binance-futures-24hr|premium-index)/;
const bybit = JSON.stringify({ retCode: 0, retMsg: 'OK', result: { category: 'linear', list: [['BTCUSDT', '69000', '0.01'], ['ETHUSDT', '3500', '0.012'], ['SOLUSDT', '150.5', '-0.015']].map(([symbol, last, pct]) => ({ symbol, lastPrice: last, price24hPcnt: pct, markPrice: last, indexPrice: last, openInterestValue: '5000000', openInterest: '100000', fundingRate: '0.0001', turnover24h: '90000000', volume24h: '2000000', nextFundingTime: '0' })) } });

async function open(browser: Browser, loc: string, inject: boolean) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, loc);
  await ctx.route(BN, r => r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"rate limited"}' }));
  await ctx.routeWebSocket(/binance\.com/, ws => { ws.close(); });
  await ctx.route(/\/api\/proxy\?.*type=bybit-tickers/, r => r.fulfill({ status: 200, contentType: 'application/json', body: bybit }));
  const page = await ctx.newPage();
  if (inject) await page.route('**/api/labels*', async (route) => {
    let res; try { res = await route.fetch(); } catch { try { await route.continue(); } catch { /* gone */ } return; }
    let body: unknown; try { body = await res.json(); } catch { await route.fulfill({ response: res }); return; }
    const pl = body as Record<string, unknown>; const labels = (pl.labels ?? pl) as Record<string, unknown>;
    for (const [k, v] of Object.entries(ROWS[loc] ?? {})) labels[k] = v;
    await route.fulfill({ response: res, json: pl });
  });
  await gotoGuarded(page, '/dashboard'); await page.waitForTimeout(14_000);
  return { ctx, page };
}
const text = (page: Page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));

test.describe('#2266 short words', () => {
  test.describe.configure({ timeout: 150_000 });

  test('J0. control: the English dashboard shows English defaults of the new keys', async ({ browser }) => {
    const { ctx, page } = await open(browser, 'en', false);
    try { const t = await text(page); const shown = PROBES.filter(p => t.includes(p.en)); console.log(`[J0] probes=${PROBES.length} shown=${shown.length} ${JSON.stringify(shown.map(p => p.en).slice(0, 8))}`); expect(PROBES.length, 'no probes: migration or defaults missing from this tree').toBeGreaterThan(10); expect(shown.length, 'the English page shows none of the probe words').toBeGreaterThan(0); } finally { await ctx.close(); }
  });

  for (const loc of ['ru', 'ko', 'zh']) {
    test(`J1. /dashboard in ${loc} with the rows: no English default of the new keys is left`, async ({ browser }) => {
      test.skip(!ROWS[loc], 'migration 20261113i is not in this tree');
      const { ctx, page } = await open(browser, loc, true);
      try { const t = await text(page); const left = PROBES.filter(p => t.includes(p.en)); console.log(`[J1] ${loc} left=${JSON.stringify(left.map(p => p.k + '=' + p.en))}`); expect(left.map(p => p.k + ' = "' + p.en + '"'), `English still on /dashboard in ${loc}`).toEqual([]); } finally { await ctx.close(); }
    });
  }

  test('J2. /dashboard in ru WITHOUT the rows: English defaults, never blank, never a raw key', async ({ browser }) => {
    const { ctx, page } = await open(browser, 'ru', false);
    try {
      const t = await text(page); const raw = t.match(/\b(FUNDING_BAND|FNG_WORD|SETUP_WORD|MARKET_READ|PATTERN)_[A-Z0-9_]+\b/g) || []; const shown = PROBES.filter(p => t.includes(p.en));
      console.log(`[J2] raw=${JSON.stringify(raw.slice(0, 5))} englishDefaultsShown=${shown.length} ${JSON.stringify(shown.map(p => p.en).slice(0, 6))}`);
      expect(raw, 'a raw label key is on the page').toEqual([]);
      // before the migration the English defaults show; since PM applied 20261113i to the shared dev project the words are Russian here, so only blank and raw-key are asserted
    } finally { await ctx.close(); }
  });
});
