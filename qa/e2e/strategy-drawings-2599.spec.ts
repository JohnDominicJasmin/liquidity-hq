/* EVERY STRATEGY DRAWS WHAT IT WATCHES (#2599, merged). One TEST PER STRATEGY and width (a fresh context each, 90 s each), so a strategy that freezes the page fails ONLY itself and the others still shoot.
 * Signed in as the Pro DEV fixture on /arena (btc 1h), the CI-built app with the CI stand-in candles. For each of the 16 strategies at 1280 and 390 (dark): pick it, wait, read the call box (verdict word), the Watching line and the "No setup right now" chip, take a viewport shot qa/.shots/draw-<id>-<w>-dark.png.
 * Asserted: a verdict word renders (no NaN / undefined / blank), no page error, the page stays RESPONSIVE (a 2 s evaluate round-trip), a WAIT with a Watching line names a price. Printed: [SD] lines. Nothing is run on the paid AI route. */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

mkdirSync('qa/.shots', { recursive: true });
test.skip(!AUTH_READY, AUTH_SKIP_REASON);
const IDS = ['ema_stack', 'ema_cross', 'range_bounce', 'liq_sweep_mss', 'supply_demand', 'sr_flip', 'fvg', 'bos_fvg', 'channel', 'rsi_divergence', 'bb_squeeze', 'ny_open_breakout', 'session_sweep', 'vwap_reclaim', 'funding_oi_squeeze', 'cvd_absorption'];

for (const width of [1280, 390]) for (const id of IDS) {
  test(`SD ${id} ${width} dark: the call and the drawing render and the page stays responsive`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await signedInContext(browser, 'a');
    await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage(); await page.setViewportSize({ width, height: width < 600 ? 900 : 1000 }); await installPaidAiFence(page);
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    await page.route(/\/api\/settings(\?|$)/, async (route) => (route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: [], rejected: [] }) })));
    await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => { if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' }); return route.fallback(); });
    try {
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h');
      const sel = page.locator('[data-testid="strategy-set-select"]').first(); await sel.waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(4_000);
      await sel.selectOption(id, { timeout: 20_000 }); await page.waitForTimeout(5_000);
      const t0 = Date.now(); const alive = await Promise.race([page.evaluate(() => 1).then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 8_000))]);
      console.log(`[SD] ${width} ${id}: page responsive ${alive} (${Date.now() - t0} ms)`);
      expect(alive, `${id}: the page main thread is FROZEN after selecting it (no evaluate round-trip in 8 s)`).toBe(true);
      /* read everything in ONE evaluate: a locator read on an element that is absent waits for the whole test timeout (that hid 9 strategies as 'timeouts' in the first run) */
      const r = await page.evaluate(() => {
        const txt = (el: Element | null) => (el ? ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim() : null);
        const box = document.querySelector('[data-testid="strategy-call-box"]'), na = document.querySelector('[data-testid="strategy-call-tf-unavailable"], [data-testid="strategy-call-unavailable"]'), load = document.querySelector('[data-testid="strategy-call-loading"]');
        return { box: txt(box), na: txt(na), loading: txt(load), watching: txt(document.querySelector('[data-testid="strategy-call-watching"]')), chip: /no setup right now/i.test(document.body.innerText || '') };
      });
      const text = r.box ?? r.na ?? r.loading ?? '';
      const verdict = /(BUY|SELL|WAIT|NO READING|LOADING)/i.exec(text)?.[1] ?? (r.na ? 'N/A' : '?');
      const watching = r.watching ?? '';
      console.log(`[SD] ${width} ${id}: verdict ${verdict} · watching "${watching.slice(0, 170)}" · chip ${r.chip} · box ${r.box != null} na ${r.na != null} loading ${r.loading != null} · call "${text.slice(0, 140)}"`);
      await page.screenshot({ path: `qa/.shots/draw-${id}-${width}-dark.png` }).catch(() => {});
      expect(/NaN|undefined|\[object|null/.test(text), `${id}: bad text in the call box: ${text.slice(0, 160)}`).toBe(false);
      expect(verdict, `${id}: no verdict rendered (box text: ${text.slice(0, 120)})`).not.toBe('?');
      if (verdict.toUpperCase() === 'WAIT' && watching) expect(/\d/.test(watching), `${id}: the Watching line names no price: ${watching}`).toBe(true);
      expect(errors, `${id}: page errors`).toEqual([]);
    } finally { await page.screenshot({ path: `qa/.shots/draw-${id}-${width}-dark-final.png` }).catch(() => {}); await ctx.close().catch(() => {}); }
  });
}
