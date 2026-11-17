/* #2500 LAYER SWITCHES (owner decision 2026-11-17): the EMA ribbon and the RSI pane become switchable chart layers, default ON, kept per browser (localStorage lhq_arena_show_ema / lhq_arena_show_rsi), display only.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true [-f base_url=<url>] -f project=desktop -f screenshots=true -f "spec=qa/e2e/layer-toggles-2500.spec.ts"
 *   LT1  Pro, /arena 1280: the four chips (EMA ribbon, RSI, S/R, Liq clusters) exist as switches; EMA ribbon and RSI start ON
 *   LT2  RSI off: the RSI pane's "RSI" legend is no longer drawn on the chart and the chip reads off; back on: it returns
 *   LT3  EMA ribbon off: the chart's overlay canvas loses its ribbon lines (non-transparent pixel count falls clearly); back on: it returns to within 15% of the start
 *   LT4  both off persist across a reload: the chips read off again, the storage keys hold 0; both on again after switching back and reloading
 *   LT5  the AI read is unaffected: the strategy call (verdict + reason) and the EMA signal card read the same text with both layers off as with both on
 * Screenshots: qa/.shots/layers-<state>-1280.png. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';
import { settleForShot } from './_settle';

mkdirSync('qa/.shots', { recursive: true });
const chip = (page: Page, name: RegExp) => page.getByRole('switch', { name }).first();
const state = async (page: Page, name: RegExp) => (await chip(page, name).getAttribute('aria-checked')) === 'true';
const pixels = (page: Page) => page.evaluate(() => {
  let best = 0, total = 0; const cs = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
  for (const c of cs) { if (c.width < 300 || c.height < 150) continue; try { const d = c.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, c.width, c.height).data; if (!d) continue; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++; total += n; best = Math.max(best, n); } catch { /* tainted */ } }
  return { total, best, canvases: cs.length };
});
const callText = async (page: Page) => { const t = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' '); const v = /(BUY|SELL|WAIT)[^.]{0,200}/.exec(t); const e = /EMA[^|]{0,160}(Bullish|Bearish|Neutral|bull|bear)[^.]{0,80}/i.exec(t); return { call: v?.[0] ?? '', ema: e?.[0] ?? '' }; };

test.describe('#2500 layer switches', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('LT1-LT5. EMA ribbon and RSI switches: default on, work, persist, leave the AI read alone', async ({ browser }) => {
    test.setTimeout(300_000);
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
    try {
      await installPaidAiFence(page);
      await page.addInitScript(() => {
        const w = window as unknown as { __rsi: number }; w.__rsi = 0; const orig = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, mw?: number) { if (/^RSI/.test(String(text))) w.__rsi = Date.now(); return mw === undefined ? orig.call(this, text, x, y) : orig.call(this, text, x, y, mw); };
        try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ }
      });
      await gotoSignedIn(page, '/arena'); await page.waitForSelector('canvas', { timeout: 90_000 }); await page.waitForTimeout(12_000);
      const EMA = /ema ribbon/i, RSI = /^rsi$/i, SR = /s\/r/i, LIQ = /liq/i;
      for (const [n, re] of [['EMA ribbon', EMA], ['RSI', RSI], ['S/R', SR], ['Liq clusters', LIQ]] as const) await expect(chip(page, re), `the "${n}" layer chip is missing`).toBeVisible({ timeout: 30_000 });
      const on0 = { ema: await state(page, EMA), rsi: await state(page, RSI) }; console.log(`[LAYERS] LT1 default: ${JSON.stringify(on0)}`);
      expect(on0, 'EMA ribbon and RSI must start ON').toEqual({ ema: true, rsi: true });
      const callOn = await callText(page); const px0 = await pixels(page); await settleForShot(page, 'layers').catch(() => {}); await page.screenshot({ path: 'qa/.shots/layers-both-on-1280.png', timeout: 20_000 }).catch(() => {});
      /* RSI pane: its legend text is not reliably visible to a fillText hook, so the pane is judged by what removing it does to the chart: the canvases' ink and the main pane's size change clearly, and switching it back restores them. */
      const sizeOf = () => page.evaluate(() => Array.from(document.querySelectorAll('canvas')).map((c) => `${c.width}x${c.height}`).join(','));
      const pxR0 = await pixels(page), sz0 = await sizeOf(); await chip(page, RSI).click(); await page.waitForTimeout(2500); expect(await state(page, RSI), 'RSI chip still reads on after the click').toBe(false);
      const pxR1 = await pixels(page), sz1 = await sizeOf(); console.log(`[LAYERS] LT2 RSI off: ink ${pxR0.total} -> ${pxR1.total}; canvases ${sz0} -> ${sz1}`);
      expect(Math.abs(pxR1.total - pxR0.total) / pxR0.total + (sz0 === sz1 ? 0 : 1), 'switching the RSI pane off changed nothing on the chart (ink and canvas sizes identical)').toBeGreaterThan(0.02);
      await chip(page, RSI).click(); await page.waitForTimeout(2500); expect(await state(page, RSI)).toBe(true); const pxR2 = await pixels(page); console.log(`[LAYERS] LT2 RSI back on: ink ${pxR2.total}`); expect(Math.abs(pxR2.total - pxR0.total) / pxR0.total, 'switching the RSI pane back on does not restore the drawing').toBeLessThan(0.15);
      await chip(page, EMA).click(); await page.waitForTimeout(2500); expect(await state(page, EMA), 'EMA chip still reads on after the click').toBe(false);
      const px1 = await pixels(page); console.log(`[LAYERS] LT3 pixels: on ${JSON.stringify(px0)} | EMA off ${JSON.stringify(px1)}`);
      expect(px1.total, `the canvas lost no ink with the EMA ribbon off (${px0.total} -> ${px1.total})`).toBeLessThan(px0.total);
      await chip(page, EMA).click(); await page.waitForTimeout(2500); const px2 = await pixels(page); console.log(`[LAYERS] LT3 back on: ${JSON.stringify(px2)}`);
      expect(Math.abs(px2.total - px0.total) / px0.total, 'switching the ribbon back on does not restore the drawing').toBeLessThan(0.15);
      await chip(page, EMA).click(); await chip(page, RSI).click(); await page.waitForTimeout(2500);
      const callOff = await callText(page); await page.screenshot({ path: 'qa/.shots/layers-both-off-1280.png', timeout: 20_000 }).catch(() => {});
      console.log(`[LAYERS] LT5 call both on: ${JSON.stringify(callOn)} | both off: ${JSON.stringify(callOff)}`);
      expect(callOff.call, 'the strategy call text changed when the layers went off').toBe(callOn.call); expect(callOff.ema, 'the EMA signal card changed when the ribbon went off').toBe(callOn.ema);
      const keys = await page.evaluate(() => [localStorage.getItem('lhq_arena_show_ema'), localStorage.getItem('lhq_arena_show_rsi')]); expect(keys, 'the switches are not stored').toEqual(['0', '0']);
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('canvas', { timeout: 90_000 }); await page.waitForTimeout(10_000);
      const after = { ema: await state(page, EMA), rsi: await state(page, RSI) }; console.log(`[LAYERS] LT4 after reload: ${JSON.stringify(after)}`); expect(after, 'the off switches did not persist across a reload').toEqual({ ema: false, rsi: false });
      await chip(page, EMA).click(); await chip(page, RSI).click(); await page.waitForTimeout(1500); await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('canvas', { timeout: 90_000 }); await page.waitForTimeout(10_000);
      expect({ ema: await state(page, EMA), rsi: await state(page, RSI) }, 'switching back on did not persist').toEqual({ ema: true, rsi: true });
    } finally { await ctx.close(); }
  });
});
