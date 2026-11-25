/* #1651 owner item 33 on a DEPLOYED site (signed out, read-only): which venue and unit the /funding table's "Current" and "Avg 7 days" cells come from. Prints [F33] lines: for each row the two cells, the Bybit tag, the browser's own Bybit ticker figure for that coin (with and without per-8h scaling, interval read from nowhere but the response) and the mean of the last 21 rows of the history response the page itself received. One soft assertion: the page's Bybit ticker response carries fundingIntervalHour (without it the browser cannot scale to per 8h). */
import { test, expect } from '@playwright/test';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');

test('F33 /funding: Current vs Avg 7 days, venue and unit per row', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage();
  let tickers: Array<Record<string, string>> | null = null;
  let history: Record<string, Array<{ fundingRate: string; fundingTime: number }>> | null = null;
  page.on('response', async (r) => {
    try {
      if (r.url().includes('type=bybit-tickers')) tickers = (await r.json())?.result?.list ?? tickers;
      if (r.url().includes('/api/market/funding-rate')) history = (await r.json())?.data ?? history;
    } catch { /* a body that is not JSON */ }
  });
  try {
    await page.goto('/funding', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await expect.poll(() => !!tickers && !!history, { timeout: 90_000 }).toBe(true);
    await page.waitForTimeout(12_000);
    const head = await page.locator('.frh-table thead th').allInnerTexts();
    const rows = await page.locator('.frh-table tbody tr').evaluateAll((trs) => trs.map((tr) => {
      const td = Array.from(tr.querySelectorAll('td')).map((c) => (c as HTMLElement).innerText.replace(/\s+/g, ' ').trim());
      return { coin: td[0] ?? '', current: td[1] ?? '', avg: td[2] ?? '', bybitTag: !!tr.querySelector('[data-testid="funding-venue-bybit"]') };
    }));
    const list = tickers as unknown as Array<Record<string, string>>;
    const hist = history as unknown as Record<string, Array<{ fundingRate: string; fundingTime: number }>>;
    console.log(`[F33] ${new Date().toISOString()} head=${JSON.stringify(head)} rows=${rows.length} tickers=${list.length} tickersWithInterval=${list.filter((t) => 'fundingIntervalHour' in t).length}`);
    const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? '-' : `${(v * 100).toFixed(4)}%`);
    for (const r of rows) {
      const coin = r.coin.split(' ')[0].toUpperCase();
      const t = list.find((x) => x.symbol === `${coin}USDT`) ?? list.find((x) => x.symbol === `1000${coin}USDT`);
      const h = (hist[`${coin}USDT`] ?? []).slice().sort((a, b) => a.fundingTime - b.fundingTime).slice(-21);
      const avg = h.length ? h.reduce((a, x) => a + Number(x.fundingRate), 0) / h.length : null;
      const gapH = h.length > 1 ? Math.round((h[h.length - 1].fundingTime - h[h.length - 2].fundingTime) / 3_600_000) : null;
      console.log(`[F33] ${coin} shown current=${r.current} avg=${r.avg} bybitTag=${r.bybitTag} | bybit ticker raw=${pct(t ? Number(t.fundingRate) : null)} | binance-history mean21=${pct(avg)} step=${gapH}h`);
    }
    expect.soft(list.some((t) => 'fundingIntervalHour' in t), 'the page\'s Bybit ticker response has no fundingIntervalHour on any contract, so no rate can be scaled to per 8 hours').toBe(true);
  } finally { await ctx.close().catch(() => {}); }
});
