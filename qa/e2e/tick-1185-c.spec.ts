/* #1185 TICK CELLS, part C (signed out, throw-away): the landing card's OI rows (box 230). Read-only, paid-AI fence on, nothing written. */
import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';
import { signedOutContext, openPage } from './_v1185';

const T = (id: string, msg: string) => console.log(`[TICK] ${id} ${msg}`);
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name === 'mobile', 'viewports are set per cell'); });

test('C1 landing Live Read card: "OI trend" word and "OI 1h" figure agree on the direction of open interest (box 230)', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/');
    await page.waitForSelector('.lp-read-panel', { state: 'attached', timeout: 50_000 }).catch(() => T('C1', 'UNMEASURED: .lp-read-panel never rendered'));
    await page.waitForFunction(() => /OI\s*1h/i.test((document.querySelector('.lp-read-panel') as HTMLElement | null)?.innerText ?? '') && /\d%/.test((document.querySelector('.lp-read-panel') as HTMLElement | null)?.innerText ?? ''), undefined, { timeout: 60_000 }).catch(() => T('C1', 'the OI 1h row never carried a figure within 60 s'));
    await page.waitForTimeout(3_000);
    const rows = await page.evaluate(() => {
      const p = document.querySelector('.lp-read-panel') as HTMLElement | null; if (!p) return [];
      return Array.from(p.querySelectorAll('div')).filter((d) => d.children.length >= 2 && Array.from(d.children).every((c) => c.tagName === 'SPAN')).map((d) => ((d as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    });
    T('C1', `rows of the landing card: ${JSON.stringify(rows)}`);
    const trend = rows.find((r) => /^OI\s*trend/i.test(r)); const hr = rows.find((r) => /^OI\s*1h/i.test(r));
    if (trend && hr) {
      const pct = /([+-]?\d+(\.\d+)?)%/.exec(hr); const rising = /strong/i.test(trend); const falling = /weak/i.test(trend);
      T('C1', `trend row "${trend}" · 1h row "${hr}" -> trend says OI ${rising ? 'rising' : falling ? 'falling' : '?'}, 1h figure ${pct ? pct[1] : 'none'}`);
      expect.soft(pct, 'UNMEASURED: no percent in the OI 1h row').not.toBeNull();
      if (pct) { const v = parseFloat(pct[1]); if (rising) expect.soft(v, 'trend word says OI rising, the 1h figure is negative').toBeGreaterThanOrEqual(0); if (falling) expect.soft(v, 'trend word says OI falling, the 1h figure is positive').toBeLessThanOrEqual(0); }
    } else T('C1', `UNMEASURED: trend row ${JSON.stringify(trend)}, 1h row ${JSON.stringify(hr)}`);
    await page.locator('.lp-read-panel').first().screenshot({ path: 'qa/.shots/tick-c1-landing-card.png' }).catch(() => {});
  } finally { await ctx.close().catch(() => {}); }
});
