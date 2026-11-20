/* #1185 RE-MEASURE ON PRODUCTION (owner order 2026-11-20), SIGNED OUT, read-only: the axe serious contrast items (A9) and the Nov-11 'failure shown as a value' sites (A10), the same cells measured on staging (run 44687012382), now on liquidity-hq.com. Every cell works in MY browser only (feed routes aborted, news rows served from a local fixture); nothing is written, no credential is typed, the paid-AI fence is installed first on every page. Prints [TICK] lines. */
import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { gotoGuarded } from './_shared';
import { signedOutContext, openPage, installNewsFixture, type Theme } from './_v1185';

const T = (id: string, msg: string) => console.log(`[TICK] ${id} ${msg}`);
const AXE = join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js');
const text = (page: Page) => page.evaluate(() => document.body.innerText);

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name === 'mobile', 'viewports are set per cell'); });

/* ================= A9 contrast / axe (192, 257) ================= */
async function axeContrast(page: Page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    // @ts-expect-error axe is injected
    const r = await window.axe.run(document, { runOnly: ['color-contrast'] });
    return r.violations.flatMap((v: { nodes: { target: string[]; any: { message: string }[]; html: string }[] }) => v.nodes.map((n) => ({ t: n.target.join(' ').slice(0, 90), m: (n.any[0]?.message || '').replace(/\s+/g, ' ').slice(0, 130), h: n.html.slice(0, 70) })));
  });
}
for (const [path, theme, wait, fixture] of [['/liq', 'dark', 20_000, false], ['/liq', 'light', 20_000, false], ['/funding', 'dark', 16_000, false], ['/briefing', 'dark', 14_000, true], ['/briefing', 'light', 14_000, true], ['/news', 'dark', 12_000, false], ['/news', 'light', 12_000, false], ['/arena?coin=btc&tf=1h', 'light', 20_000, false], ['/arena?coin=btc&tf=1h', 'dark', 20_000, false]] as [string, Theme, number, boolean][]) {
  test(`A9 axe color-contrast ${path} ${theme}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await signedOutContext(browser, { width: 1280, theme }); const page = await openPage(ctx);
    if (fixture) await installNewsFixture(page);
    try {
      await gotoGuarded(page, path); await page.waitForTimeout(wait);
      const th = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      const v = await axeContrast(page);
      const named = v.filter((x: { t: string; h: string }) => /liq-section-est|mb-event-tag|edge-card|ncard-empty|empty|wf-row|fund.*nodata|no-data/i.test(x.t + ' ' + x.h));
      T('A9', `${path} ${theme} (data-theme=${th}): ${v.length} contrast violations ${JSON.stringify(v.slice(0, 12))} · matching the box's named elements: ${JSON.stringify(named)}`);
      expect.soft(th === 'light' ? th : 'ok', 'the page is not on the requested theme').toBe(theme === 'light' ? 'light' : 'ok');
      expect.soft(v, `${path} ${theme}: serious contrast violations`).toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}

/* ================= A10 failure shown as a value (46) ================= */
test('A10 data feeds killed: no confident empty/zero values at the 7 audited sites', async ({ browser }) => {
  test.setTimeout(240_000);
  const kill = async (page: Page) => { await page.route(/\/api\/(proxy|market|oi|cmc|liq)/, (r) => r.abort()); await page.routeWebSocket(/.*/, (ws) => ws.close()); };
  const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx);
  try {
    await kill(page);
    /* /scanner: SetupScanner, AccumulationTracker, DistributionTracker */
    await gotoGuarded(page, '/scanner'); await page.waitForTimeout(40_000);
    let body = await text(page);
    const bad = body.match(/No setups match|No strong setups|No coins match|No stealth accumulation detected|No distribution detected/gi) ?? [];
    T('A10', `/scanner with feeds refused: ${body.length} chars · confident-empty phrases ${JSON.stringify(bad)} · headings present ${JSON.stringify(body.match(/Setup Scanner|Accumulation|Distribution/gi)?.slice(0, 6) ?? [])}`);
    expect.soft(body.length, 'CONTROL: /scanner rendered nothing').toBeGreaterThan(300);
    expect.soft(bad, '/scanner shows an empty result as if the read had succeeded').toEqual([]);
    await page.screenshot({ path: 'qa/.shots/tick-a10-scanner.png' }).catch(() => {});
    /* /arena: Multi-timeframe card and Confluence */
    await gotoGuarded(page, '/arena?coin=btc&tf=1h'); await page.waitForTimeout(40_000);
    body = await text(page);
    const mtf = body.match(/Mixed Signals|No clear directional bias|No data|unavailable/gi) ?? [];
    const pcts = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && /^0%$/.test(((e as HTMLElement).innerText || '').trim())).length);
    T('A10', `/arena btc with feeds refused: multi-timeframe phrases ${JSON.stringify(mtf)} · bare "0%" leaf elements ${pcts} · confluence mentions ${JSON.stringify(body.match(/Confluence[^\n]{0,40}/gi)?.slice(0, 3) ?? [])}`);
    expect.soft(body.match(/Mixed Signals|No clear directional bias/gi) ?? [], '/arena claims "Mixed Signals" with no readings').toEqual([]);
    await page.screenshot({ path: 'qa/.shots/tick-a10-arena.png' }).catch(() => {});
    /* landing: "Setup 0" */
    await gotoGuarded(page, '/'); await page.waitForTimeout(30_000);
    body = await text(page);
    const s0 = body.match(/Setup\s*0\b|NO READ/gi) ?? [];
    T('A10', `landing with feeds refused: ${body.length} chars · "Setup 0" / "NO READ" ${JSON.stringify(s0)}`);
    expect.soft(s0, 'landing hero shows "Setup 0" / "NO READ" as a reading').toEqual([]);
  } finally { await ctx.close().catch(() => {}); }
});

test('A10 /news All tab with the news read refused: no endless Loading', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx);
  try {
    await page.route((u) => u.href.includes('/rest/v1/') && /news\b/i.test(u.pathname), (r) => r.abort());
    await gotoGuarded(page, '/news'); await page.waitForTimeout(35_000);
    const m = await page.evaluate(() => ({ text: document.body.innerText.slice(0, 600).replace(/\s+/g, ' '), skeletons: document.querySelectorAll('[class*=skeleton], [class*=Skeleton], [aria-busy=true]').length, loading: (document.body.innerText.match(/loading/gi) ?? []).length }));
    T('A10-news', `news read refused, after 35 s: skeleton-ish elements ${m.skeletons} · "loading" words ${m.loading} · text start "${m.text.slice(0, 300)}"`);
    expect.soft(m.skeletons + m.loading, 'the News page is still loading after its read failed').toBe(0);
  } finally { await ctx.close().catch(() => {}); }
});

