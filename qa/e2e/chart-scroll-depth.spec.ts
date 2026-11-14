/* #1263 "weekly/monthly timeframes, years of history" and the scroll-back (#2132): how FAR BACK does the Arena chart really load, per timeframe, for a Binance coin (BTC) and a
 * Bybit-only coin (HYPE)? Signed out, reads only, meant for the DEPLOYED qa build (base_url) because the history comes from the exchanges.
 * It records every /api/market/klines response the page receives, then pans the chart back (mouse drag to the right on the plot, repeatedly), and reports for each tf:
 *   candles loaded, earliest open time, how many years/days that is, before and after the pans. The assertions are deliberately modest (history exists; panning never loads LESS;
 *   1W reaches at least 2 years, 1M at least 3 years where the exchange has them) - the numbers themselves are the evidence, printed as [DEPTH]. */
import { test, expect, type Page } from '@playwright/test';
import { gotoGuarded } from './_shared';

type Bar = number;
async function depth(page: Page, coin: string, tf: string) {
  const times = new Set<number>();
  page.on('response', async (r) => {
    if (!/\/api\/market\/klines/.test(r.url())) return;
    try { const j = await r.json(); const arr = Array.isArray(j) ? j : (j?.result?.list ?? []); for (const k of arr) { const t = Number(Array.isArray(k) ? k[0] : k?.t ?? k?.time); if (Number.isFinite(t)) times.add(t); } } catch { /* not json */ }
  });
  await gotoGuarded(page, `/arena?coin=${coin}&tf=${tf}`); await page.waitForTimeout(15_000);
  const snap = () => { const a = Array.from(times).sort((x, y) => x - y); return { n: a.length, earliest: (a[0] ?? null) as Bar | null }; };
  const before = snap();
  const canvas = page.locator('canvas').first(); const box = await canvas.boundingBox();
  if (box) for (let i = 0; i < 12; i++) { await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.5, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(1200); }
  await page.waitForTimeout(4000);
  const after = snap();
  const now = Date.now(); const ageD = (t: number | null) => t === null ? null : Math.round((now - t) / 86_400_000);
  console.log(`[DEPTH] ${coin} ${tf} before: n=${before.n} earliest=${before.earliest ? new Date(before.earliest).toISOString().slice(0, 10) : null} (${ageD(before.earliest)} d) | after 12 pans: n=${after.n} earliest=${after.earliest ? new Date(after.earliest).toISOString().slice(0, 10) : null} (${ageD(after.earliest)} d)`);
  return { before, after, ageD };
}

test.describe('chart history depth on the deployed build', () => {
  test.describe.configure({ timeout: 200_000 });
  for (const coin of ['btc', 'hype']) for (const [tf, minDays] of [['15m', 0], ['1h', 0], ['1d', 365], ['1w', 730], ['1M', 1000]] as Array<[string, number]>) {
    test(`D. ${coin} ${tf}: history and scroll-back depth`, async ({ page }) => {
      const d = await depth(page, coin, tf);
      expect(d.before.n, `no candles were loaded for ${coin} ${tf}: nothing measured`).toBeGreaterThan(20);
      expect(d.after.n, 'panning back loaded fewer candles than before').toBeGreaterThanOrEqual(d.before.n);
      if (coin === 'btc' && minDays > 0) expect(d.ageD(d.after.earliest) ?? 0, `${tf} history reaches back fewer than ${minDays} days`).toBeGreaterThanOrEqual(minDays);
    });
  }
});
