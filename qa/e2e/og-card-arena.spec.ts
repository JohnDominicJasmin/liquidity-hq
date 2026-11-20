/* ONE 1200x630 CAPTURE for the social share card (PM, Dev's #2748): PROD liquidity-hq.com/arena, signed out, dark theme, BTC 4h, the chart with a strategy drawn. Read-only (GETs only), nothing clicked except the strategy menu (a local choice), no AI read, nothing written or billed.
 * PM's frame rules: no "n/a" / "unavailable" text anywhere in the frame, no usage counters, no news ticker. The spec prints (1) which strategy the menu offered and whether it took, (2) every visible text that matches the placeholder words, (3) what it hid for the clean frame (ticker, usage counters), and saves TWO shots: the raw viewport and the clean frame. It asserts only that the chart loaded; the PNG is the deliverable (CI artifact `qa-screenshots-*`, file qa/.shots/og-card-arena-clean.png). */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('qa/.shots', { recursive: true });

test('OG capture: /arena BTC 4h, dark, 1200x630, strategy drawn, clean frame', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ } });
  const page = await ctx.newPage();
  try {
    await page.goto('/arena?coin=btc&tf=4h', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.locator('.klc-canvas').first().waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(10_000);
    /* a strategy drawn: the local menu choice (signed out it is held in the page only); try the ones that draw without a paid read, in this order */
    const menu = page.getByTestId('strategy-set-select'); const menuState = { present: await menu.count(), enabled: false, options: [] as string[], picked: '' };
    if (menuState.present) {
      menuState.enabled = await menu.first().isEnabled().catch(() => false);
      menuState.options = await menu.first().locator('option').allTextContents().catch(() => []);
      for (const v of ['channel', 'ema_stack', 'supply_demand', 'range_bounce']) {
        if (!menuState.enabled) break;
        const ok = await menu.first().selectOption(v).then(() => true).catch(() => false);
        if (ok) { menuState.picked = v; await page.waitForTimeout(9_000); break; }
      }
    }
    console.log(`[OG] strategy menu: ${JSON.stringify(menuState)}`);
    const verdict = await page.getByTestId('strategy-call-verdict').count(); const unavailable = await page.getByTestId('strategy-call-unavailable').count(); const loading = await page.getByTestId('strategy-call-loading').count();
    console.log(`[OG] call box: verdict ${verdict} · unavailable ${unavailable} · loading ${loading}`);
    await page.screenshot({ path: 'qa/.shots/og-card-arena-raw.png' });
    const hits = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter((e) => e.children.length === 0 && /(^|\W)(n\/a|unavailable|no data|not available)(\W|$)/i.test((e.textContent || '')) && (e as HTMLElement).offsetParent !== null).map((e) => `${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).slice(0, 30)}: ${(e.textContent || '').trim().slice(0, 50)}`));
    console.log(`[OG] visible placeholder-word hits in the raw frame: ${JSON.stringify(hits.slice(0, 12))}`);
    /* the clean frame: hide the news ticker and the usage counters (presentation only; no data is changed) */
    const hidden = await page.evaluate(() => {
      const sel = ['[class*="ticker" i]', '[data-testid*="ticker" i]', '[data-testid*="usage" i]', '[class*="usage" i]', '.arena-usage', '.tnav-session'];
      let n = 0; const names: string[] = [];
      for (const s of sel) for (const el of Array.from(document.querySelectorAll(s)) as HTMLElement[]) { if (el.offsetParent !== null) { el.style.setProperty('display', 'none', 'important'); n++; names.push(`${s}:${(el.textContent || '').trim().slice(0, 30)}`); } }
      return { n, names: names.slice(0, 10) };
    });
    console.log(`[OG] hidden for the clean frame: ${JSON.stringify(hidden)}`);
    await page.waitForTimeout(1_500);
    const counters = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter((e) => e.children.length === 0 && (e as HTMLElement).offsetParent !== null && /\b\d+\s*\/\s*\d+\b|reads? (left|remaining)|left today|\bused\b/i.test(e.textContent || '')).map((e) => (e.textContent || '').trim().slice(0, 50)).slice(0, 8));
    console.log(`[OG] visible counter-like texts left in the clean frame: ${JSON.stringify(counters)}`);
    await page.screenshot({ path: 'qa/.shots/og-card-arena-clean.png' });
    expect(await page.locator('.klc-canvas').first().isVisible(), 'the chart did not render').toBe(true);
  } finally { await ctx.close().catch(() => {}); }
});
