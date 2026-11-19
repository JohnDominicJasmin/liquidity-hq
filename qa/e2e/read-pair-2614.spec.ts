/* #2614 / #2611 THE LIVE QUICK READ PAIR (ONE BILLED PAIR, approved by PM 2026-11-19): two real Quick reads of BTC 1h, each in a FRESH browser context (so the page's own result cache cannot answer the second), as the Pro fixture on the deployed qa build.
 * Expectation (from #2614): the levels a read quotes are the server's FIXED numbers (nearest resistance above / nearest support below the last closed candle's close, one taker threshold of 60%), so the two reads quote THE SAME numbers, and those equal an INDEPENDENT computation:
 * the closed 1h candles of Bybit BTCUSDT (read by the TEST process, forming candle dropped) run through QA's oracle copy of the chart's S/R levels. Venues quote a few dollars apart, so the oracle match has a 0.15 percent tolerance; the two reads must agree with each other EXACTLY on the number they quote for each level.
 *   P1 each read quotes a price within 0.15% of the oracle's resistance above and of its support below   P2 both reads quote the identical text for each   P3 any taker threshold a read states is 60%
 * Only /api/grok is let through (one POST per read); every other paid route stays fenced. Skipped unless E2E_ALLOW_BILLED_CALLS=1. Prints the two reads' quoted numbers. */
import { test, expect, type Browser } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, BILLED_CALLS_READY, BILLED_CALLS_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';
import { srLevels } from '../fixtures/strategyFixtures';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
test.skip(!BILLED_CALLS_READY, BILLED_CALLS_SKIP_REASON);

async function oneRead(browser: Browser, label: string): Promise<{ text: string; status: number; shot: string }> {
  const ctx = await signedInContext(browser, 'a');
  await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage(); await page.setViewportSize({ width: 1280, height: 1000 });
  await installPaidAiFence(page);
  await page.route('**/api/grok', (route) => route.continue());   // registered after the fence: wins for this one path
  try {
    await gotoSignedIn(page, '/arena?coin=btc&tf=1h');
    await expect(page.locator('.plan-badge-pro').first(), 'the Pro plan never resolved').toBeVisible({ timeout: 60_000 }); await page.waitForTimeout(3_000);
    const resp = page.waitForResponse((r) => /\/api\/grok(\?|$)/.test(r.url()) && r.request().method() === 'POST', { timeout: 120_000 });
    await page.locator('button.arena-quick-btn').first().click();
    const r = await resp; const body = await r.text().catch(() => ''); await page.waitForTimeout(4_000);
    const shot = `qa/.shots/read-pair-${label}.png`; await page.screenshot({ path: shot }).catch(() => {});
    return { text: body, status: r.status(), shot };
  } finally { await ctx.close().catch(() => {}); }
}
const dollars = (t: string) => [...t.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((m) => ({ raw: m[0].replace(/\s/g, ''), v: Number(m[1].replace(/,/g, '')) })).filter((x) => Number.isFinite(x.v));

test('QR the pair: two real Quick reads of BTC 1h quote identical levels, equal to an independent computation', async ({ browser }) => {
  test.setTimeout(420_000);
  const a = await oneRead(browser, 'a'); await new Promise((r) => setTimeout(r, 20_000)); const b = await oneRead(browser, 'b');
  console.log(`[QR] read A status ${a.status} (${a.text.length} chars), read B status ${b.status} (${b.text.length} chars)`);
  expect(a.status, `read A: HTTP ${a.status} ${a.text.slice(0, 200)}`).toBe(200); expect(b.status, `read B: HTTP ${b.status} ${b.text.slice(0, 200)}`).toBe(200);
  /* the independent oracle */
  const res = await fetch('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=60&limit=400'); const j = await res.json() as { result?: { list?: string[][] } };
  const list = (j.result?.list ?? []).slice().reverse().map((k) => ({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] })).filter((k) => k.time + 3_600_000 <= Date.now());
  expect(list.length, 'the independent venue read returned too few candles').toBeGreaterThan(200);
  const close = list[list.length - 1].close, lv = srLevels(list, close).map((l) => l.price), above = lv.filter((p) => p > close).sort((x, y) => x - y)[0], below = lv.filter((p) => p < close).sort((x, y) => y - x)[0];
  console.log(`[QR] oracle: last closed close ${close} · nearest resistance above ${above} · nearest support below ${below}`);
  const pa = dollars(a.text), pb = dollars(b.text);
  console.log(`[QR] A quotes ${[...new Set(pa.map((x) => x.raw))].join(' ')}`); console.log(`[QR] B quotes ${[...new Set(pb.map((x) => x.raw))].join(' ')}`);
  const near = (list2: { raw: string; v: number }[], target: number | undefined) => (target == null ? null : list2.find((x) => Math.abs(x.v - target) <= target * 0.0015) ?? null);
  for (const [name, p] of [['A', pa], ['B', pb]] as const) { if (above != null) expect(near(p, above), `read ${name} never quotes the resistance above (oracle ${above})`).not.toBeNull(); if (below != null) expect(near(p, below), `read ${name} never quotes the support below (oracle ${below})`).not.toBeNull(); }
  if (above != null) expect(near(pa, above)!.raw, 'the two reads quote DIFFERENT resistance numbers').toBe(near(pb, above)!.raw);
  if (below != null) expect(near(pa, below)!.raw, 'the two reads quote DIFFERENT support numbers').toBe(near(pb, below)!.raw);
  for (const [name, t] of [['A', a.text], ['B', b.text]] as const) for (const m of t.matchAll(/taker[^.%]{0,80}?(\d{2})\s?%/gi)) expect(m[1], `read ${name} states a taker threshold other than 60%`).toBe('60');
});
