/* #2610 A STRATEGY WITH TOO FEW CANDLES SAYS HOW MANY IT NEEDS AND HOW MANY THE COIN HAS. Signed in as the Pro fixture on a deployed build, REAL candles (nothing stubbed):
 *   NC1  AAPL 1d with the EMA cross (needs 601): the call box says WAIT + "Needs 601 1d candles; AAPL has N." and has NO Retry button; N must equal the number of CLOSED daily candles an independent read of the venue returns (Bybit AAPLUSDT, the forming day dropped), within 1 (the day can roll over between the two reads).
 *   NC2  control: BTC 1d with the EMA cross has well over 601 candles: the call box is a real verdict (BUY / SELL / WAIT with its own reason), never the "Needs" line.
 *   NC3  control: BTC 1h with the EMA stack (needs 230) is a real verdict.
 * The independent count comes from the TEST process (api.bybit.com directly); if that host is unreachable from the runner the count is printed as unavailable and only the shape is asserted. Nothing is run on the paid AI route. */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

async function box(page: Page, coin: string, tf: string, strat: string): Promise<{ text: string; retry: boolean; verdict: string | null }> {
  await gotoSignedIn(page, `/arena?coin=${coin}&tf=${tf}`);
  const sel = page.locator('[data-testid="strategy-set-select"]').first(); await sel.waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(3_000);
  await sel.selectOption(strat, { timeout: 20_000 }); await page.waitForTimeout(9_000);
  return page.evaluate(() => {
    const b = document.querySelector('[data-testid="strategy-call-box"]') as HTMLElement | null;
    const v = document.querySelector('[data-testid="strategy-call-verdict"]') as HTMLElement | null;
    return { text: b ? (b.innerText || '').replace(/\s+/g, ' ').trim() : '', retry: !!document.querySelector('[data-testid="strategy-call-retry"]'), verdict: v ? (v.dataset.verdict || v.innerText) : null };
  });
}
async function closedDaily(sym: string): Promise<number | null> {
  try {
    const r = await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=D&limit=1000`); if (!r.ok) return null;
    const j = await r.json() as { result?: { list?: string[][] } }; const list = j.result?.list ?? []; const now = Date.now();
    return list.filter((k) => +k[0] + 86_400_000 <= now).length;
  } catch { return null; }
}

test('NC1 aapl 1d ema_cross: "Needs 601 1d candles; AAPL has N." with N = the closed daily candles, no Retry', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await signedInContext(browser, 'a'); await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage(); await page.setViewportSize({ width: 1280, height: 1000 }); await installPaidAiFence(page);
  try {
    const r = await box(page, 'aapl', '1d', 'ema_cross'); const indep = await closedDaily('AAPLUSDT');
    console.log(`[NC] aapl 1d ema_cross: "${r.text.slice(0, 220)}" · retry button ${r.retry} · independent closed daily candles ${indep}`);
    await page.screenshot({ path: 'qa/.shots/nc-aapl-1d-ema_cross.png' }).catch(() => {});
    const m = /Needs 601 1d candles; AAPL has (\d+)\./.exec(r.text);
    expect(m, `the box does not say "Needs 601 1d candles; AAPL has N." (box: ${r.text.slice(0, 200)})`).not.toBeNull();
    expect(r.retry, 'a too-few state must not offer Retry (it can never help)').toBe(false); expect(/Price data did not load|Read unavailable/i.test(r.text), 'the generic error text is still shown').toBe(false);
    if (indep != null) expect(Math.abs(Number(m![1]) - indep), `the box says ${m![1]} candles, an independent venue read gives ${indep}`).toBeLessThanOrEqual(1);
  } finally { await ctx.close().catch(() => {}); }
});
test('NC2/NC3 controls: BTC 1d ema_cross and BTC 1h ema_stack have enough candles: a real verdict, never the "Needs" line', async ({ browser }) => {
  test.setTimeout(200_000);
  const ctx = await signedInContext(browser, 'a'); await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage(); await page.setViewportSize({ width: 1280, height: 1000 }); await installPaidAiFence(page);
  try {
    for (const [coin, tf, strat] of [['btc', '1d', 'ema_cross'], ['btc', '1h', 'ema_stack']] as const) {
      const r = await box(page, coin, tf, strat); console.log(`[NC] ${coin} ${tf} ${strat}: verdict ${r.verdict} · "${r.text.slice(0, 160)}"`);
      expect(/Needs \d+ \S+ candles/.test(r.text), `${coin} ${tf} ${strat}: the Needs line shows on a coin with enough history: ${r.text.slice(0, 160)}`).toBe(false);
      expect(/^(buy|sell|wait)$/i.test(String(r.verdict)), `${coin} ${tf} ${strat}: no verdict (${r.verdict})`).toBe(true);
    }
  } finally { await ctx.close().catch(() => {}); }
});
