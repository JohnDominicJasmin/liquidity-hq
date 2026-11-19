/* ARENA INDICATORS: what is on the live page, and do the REAL toggles (toolbar S/R, Structure, Liq; the strategy panel's layer switches) add and remove drawings.
 * Enumerates every strategy chip, every role=switch layer, and every chart toolbar button on /arena (BTC 1h, 1280 and 390), then flips each toggle through the UI and reads the chart (overlay counts by name,
 * indicator list and visible flag) and the composite pixel diff of the candle pane. Prints [ENUM] lines. */
import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON } from './_auth';
import { openArena, readChart, snap } from './_ind';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
for (const w of [1280, 390]) test(`IND enum + toggles btc 1h ${w}`, async ({ browser }) => {
  test.setTimeout(300_000);
  const { ctx, page, attach } = await openArena(browser, { coin: 'btc', tf: '1h', width: w, height: w < 500 ? 844 : 900, chips: [] });
  try {
    expect(attach, 'chart handle').toBe('ok');
    const en = await page.evaluate(() => ({
      chips: Array.from(document.querySelectorAll('[data-testid^="strategy-indicator-"]')).map((e) => `${(e as HTMLElement).dataset.testid!.replace('strategy-indicator-', '')}[${e.getAttribute('aria-pressed')}]`),
      switches: Array.from(document.querySelectorAll('[role="switch"]')).map((e) => `${e.getAttribute('aria-label') || (e as HTMLElement).innerText}[${e.getAttribute('aria-checked')}${(e as HTMLButtonElement).disabled ? ',disabled' : ''}]`),
      layerRows: Array.from(document.querySelectorAll('.strat-layer')).map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()),
      toolbar: Array.from(document.querySelectorAll('.klc-toolbar button')).map((e) => `${(e as HTMLElement).innerText.replace(/\s+/g, ' ').trim() || e.getAttribute('aria-label') || e.getAttribute('title')}${e.getAttribute('aria-pressed') ? '[' + e.getAttribute('aria-pressed') + ']' : ''}`),
      sections: Array.from(document.querySelectorAll('.strat-lbl')).map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()),
    }));
    console.log(`[ENUM] ${w} strategy chips: ${en.chips.join(', ')}`); console.log(`[ENUM] ${w} layer switches (role=switch): ${en.switches.join(', ') || 'none'}`);
    console.log(`[ENUM] ${w} layer rows: ${en.layerRows.join(' | ')}`); console.log(`[ENUM] ${w} section labels: ${en.sections.join(' | ')}`); console.log(`[ENUM] ${w} chart toolbar: ${en.toolbar.join(' | ')}`);
    const st0 = await readChart(page, 5); const names = (s: typeof st0) => { const m: Record<string, number> = {}; for (const o of s.ovs.filter((x) => x.visible)) m[o.name] = (m[o.name] ?? 0) + 1; return JSON.stringify(m); };
    console.log(`[ENUM] ${w} chart now: indicators ${st0.inds.map((i) => `${i.name}${i.visible ? '' : '(hidden)'}`).join(',')} overlays ${names(st0)}`);
    const flip = async (label: string, loc: ReturnType<typeof page.locator>, after: (s: typeof st0) => string) => {
      if (!(await loc.count())) { console.log(`[ENUM] ${w} toggle ${label}: control not found`); return; }
      if (!(await loc.first().isVisible())) { console.log(`[ENUM] ${w} toggle ${label}: control is in the DOM but NOT VISIBLE at this width (box ${JSON.stringify(await loc.first().boundingBox())})`); return; }
      await loc.first().scrollIntoViewIfNeeded().catch(() => {}); const a = await readChart(page, 5); await snap(page, 'a'); await loc.first().click({ timeout: 15_000 }); await page.waitForTimeout(1500); const b = await readChart(page, 5); await snap(page, 'b');
      const px = await page.evaluate(() => { const s = (window as unknown as { __snaps: Record<string, ImageData> }).__snaps; const A = s.a, B = s.b; let n = 0; for (let i = 0; i < A.data.length; i += 8) if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 60) n++; return n; });
      await loc.first().click({ timeout: 15_000 }).catch(() => {}); await page.waitForTimeout(1200); const c = await readChart(page, 5);
      console.log(`[ENUM] ${w} toggle ${label}: before ${after(a)} | after click ${after(b)} (changed pixels ${px}) | after clicking back ${after(c)}`);
    };
    const ov = (s: typeof st0) => `overlays ${names(s)}; indicators ${s.inds.map((i) => `${i.name}${i.visible ? '' : '(hidden)'}`).join(',')}`;
    await flip('toolbar S/R', page.locator('.klc-toolbar button', { hasText: /^S\/R$/ }), ov);
    await flip('toolbar Structure', page.locator('.klc-toolbar button', { hasText: /structure$/i }).filter({ hasNotText: /draw/i }), ov);
    await flip('toolbar Liq', page.locator('.klc-toolbar button', { hasText: /^liq/i }), ov);
    for (const re of [/^ema ribbon$/i, /^rsi$/i, /s\/r/i, /liq/i, /gex/i]) await flip(`layer switch ${re}`, page.getByRole('switch', { name: re }), ov);
  } finally { await ctx.close().catch(() => {}); }
});
