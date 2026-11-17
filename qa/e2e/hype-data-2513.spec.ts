/* #2513 HYPE DATA (owner-reported 2026-11-17: VWAP / RSI14 / POC / VAH / VAL / MA20 read Unavailable on HYPE; the snapshot's klines held 49 of 50 coins and HYPE was the missing one).
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f project=desktop -f "spec=qa/e2e/hype-data-2513.spec.ts"      (a CI build: the server's upstream calls are stubbed there; on a deployed site it needs Binance/Bybit reachable)
 *   HY1  /api/market/snapshot: the klines section has an entry for EVERY tracked coin (the app's COINS list) and HYPE's entry carries finite vwap and rsi14 numbers
 *   HY2  /arena?coin=hype signed out: the Market snapshot panel's VWAP reads a number (not Unavailable / a dash)
 *   HY3  CONTROL: the same panel on BTC reads a number, so HY2 failing cannot be the panel
 * Signed out, GETs only. */
import { test, expect } from '@playwright/test';
import { COINS } from '../../lib/coins';

const tracked = Object.keys(COINS);
const nums = (o: unknown, re: RegExp): number[] => { const out: number[] = []; const walk = (v: unknown, k: string) => { if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) walk(vv, kk); else if (re.test(k) && typeof v === 'number' && Number.isFinite(v)) out.push(v); }; walk(o, ''); return out; };

test('HY1. snapshot klines: every tracked coin present, HYPE with finite vwap and rsi14', async ({ request }) => {
  test.setTimeout(120_000);
  const r = await request.get('/api/market/snapshot'); expect(r.status(), 'snapshot answered').toBe(200);
  const j = await r.json() as { klines?: Record<string, unknown>; data?: { klines?: Record<string, unknown> } }; const klines = (j.klines ?? j.data?.klines ?? {}) as Record<string, unknown>;
  const have = Object.keys(klines); const missing = tracked.filter((c) => !(c in klines));
  console.log(`[HYPE] klines coins ${have.length} of ${tracked.length} tracked; missing ${JSON.stringify(missing)}; hype entry keys ${JSON.stringify(Object.keys((klines.hype ?? {}) as object).slice(0, 12))}`);
  expect(klines.hype, 'HYPE has no klines entry').toBeTruthy();
  const v = nums(klines.hype, /^vwap$/i), r14 = nums(klines.hype, /rsi.?14/i);
  console.log(`[HYPE] hype vwap ${JSON.stringify(v)} rsi14 ${JSON.stringify(r14)}`);
  expect(v.length, 'HYPE klines carry no finite vwap').toBeGreaterThan(0); expect(r14.length, 'HYPE klines carry no finite rsi14').toBeGreaterThan(0);
  expect(missing, `tracked coins with no klines: ${missing.join(', ')}`).toEqual([]);
});

for (const coin of ['hype', 'btc'] as const) test(`HY${coin === 'hype' ? 2 : 3}. /arena?coin=${coin}: the Market snapshot VWAP reads a number`, async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(`/arena?coin=${coin}&tf=1h`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(15_000);
  const t = ((await page.locator('body').innerText()) || '').replace(/\s+/g, ' '); const m = /VWAP[^A-Za-z]{0,6}\s*([^ ]{0,14})\s*([^ ]{0,14})/.exec(t); const around = t.slice(Math.max(0, t.search(/Market snapshot/i)), Math.max(0, t.search(/Market snapshot/i)) + 260);
  console.log(`[HYPE] ${coin}: ${around}`);
  expect(/Market snapshot/i.test(t), 'the Market snapshot panel is not on the page').toBe(true);
  const seg = /VWAP[\s\S]{0,40}/i.exec(around)?.[0] ?? m?.[0] ?? ''; expect(/\d/.test(seg) && !/unavailable/i.test(seg), `the ${coin} VWAP reads "${seg}", not a number`).toBe(true);
});
