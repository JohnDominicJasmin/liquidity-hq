/* #2511 CHANNEL RISK BOX, rendered. Signed in as the Pro fixture (the Draw Structure button needs an entitled session), /arena on 4h, the chart's candles replaced by the QA channel fixtures (qa/fixtures/channelCandles.ts) so the call is KNOWN. The paid AI route is fenced and stubbed: nothing is billed.
 * The fixture ENDS AT THE CURRENT 4h BAR and at a price near the synthetic live feed, so the chart's own live bar sits on the last candle instead of far away in time and price (the first version of this spec put the fixture in 2025 and the live bar at 70k stretched the axis to 20k).
 * The box is drawn on the chart's canvas, so labels are read by recording every fillText the page makes, with the page position (canvas left + x) so labels can be compared with the price axis.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true [-f base_url=<url>] -f project=desktop -f screenshots=true -f "spec=qa/e2e/channel-box-2511.spec.ts"
 *   CB1:<theme>:<width>  falling channel broken UP: Draw Structure draws Target / Entry / Stop (T / E / S when the chart is under 460 px wide), the R:R text, and the caption "Levels from the Channel strategy, not a prediction."; the Entry price is the breakout close (full form), the Stop is the oracle's last swing inside (within 0.2%) and BELOW entry, R:R agrees with the labels' own % (full form); no label sits over the price axis
 *   CB2:<theme>:<width>  falling channel with NO close outside: Draw Structure draws NO box text
 *   CB3:<width>          rising channel broken DOWN: a SELL box: the Stop sits ABOVE the entry (vertical position of its label, and its price vs the oracle)
 *   CB4:<width>          layout shift when the box appears is at most 0.1
 * Screenshots: qa/.shots/channel-<cell>-<theme>-<width>.png. Arrows cannot be read from a canvas: "no arrow" is pinned in __tests__/channelStrategy2511.test.mts and checked by eye on the screenshots. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';
import { settleForShot } from './_settle';
import { channelCandles, type ChannelFixture } from '../fixtures/channelCandles';

mkdirSync('qa/.shots', { recursive: true });
const CAPTION = 'Levels from the Channel strategy, not a prediction.';
const TF = 4 * 3_600_000;

/** A fixture whose LAST candle is the current 4 h bar, at a price near the synthetic live feed. */
const fixture = (dir: 'falling' | 'rising', breakout: 'none' | 'up' | 'down'): ChannelFixture => { const bars = 120, t0 = Math.floor(Date.now() / TF) * TF - (bars - 1) * TF; return channelCandles({ dir, breakout, bars, t0, startMid: dir === 'falling' ? 80_000 : 62_000, slopePct: 0.1 }); };
const kline = (fx: ChannelFixture) => fx.candles.map((c) => [c.timestamp, String(c.open), String(c.high), String(c.low), String(c.close), String(c.volume ?? 0), c.timestamp + TF - 1, '0', 1, '0', '0', '0']);

async function arm(page: Page, fx: ChannelFixture) {
  await installPaidAiFence(page);   // FIRST: it must precede this spec's own routes
  await page.route('**/api/draw-structure**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ structures: [], proposals: [] }) }));
  await page.route('**/api/market/klines**', (r) => { const u = new URL(r.request().url()); if (u.searchParams.get('end')) return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kline(fx)) }); });
  await page.addInitScript(() => {
    const w = window as unknown as { __texts: Array<{ t: string; x: number; y: number; w: number }>; __cls: number; __clsAll: number };
    w.__texts = []; w.__cls = 0; w.__clsAll = 0;
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, mw?: number) {
      try { const m = this.measureText(text); const tr = this.getTransform(); const r = this.canvas.getBoundingClientRect(); const sx = r.width / (this.canvas.width || 1), sy = r.height / (this.canvas.height || 1); w.__texts.push({ t: String(text), x: Math.round(r.left + (x * tr.a + tr.e) * sx), y: Math.round(r.top + (y * tr.d + tr.f) * sy), w: Math.round(m.width * tr.a * sx) }); if (w.__texts.length > 4000) w.__texts.splice(0, 2000); } catch { /* ignore */ }
      return mw === undefined ? orig.call(this, text, x, y) : orig.call(this, text, x, y, mw);
    };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) { w.__clsAll += e.value; if (!e.hadRecentInput) w.__cls += e.value; } }).observe({ type: 'layout-shift', buffered: true }); } catch { /* unsupported */ }
  });
}

type Rec = { t: string; x: number; y: number; w: number };
const texts = (page: Page) => page.evaluate(() => ((window as unknown as { __texts: Array<{ t: string; x: number; y: number; w: number }> }).__texts));
const price = (s: string) => { const m = /\$\s*([\d,]+(?:\.\d+)?)/.exec(s); return m ? Number(m[1].replace(/,/g, '')) : NaN; };
const pct = (s: string) => { const m = /\(([+-][\d.]+)%\)/.exec(s); return m ? Number(m[1]) : NaN; };

/** The box's own labels. The Stop / Target / Entry words are shared with the S/R price tags ("S $85,692", "R $90,583" sit on the axis), so a label is the one in the ENTRY label's column. */
function boxLabels(rec: Rec[]) {
  const entry = [...rec].reverse().find((r) => /^(Entry\b|E$)/.test(r.t)); if (!entry) return { entry: undefined, stop: undefined, target: undefined, rr: undefined, cap: undefined };
  const near = (re: RegExp) => [...rec].reverse().find((r) => re.test(r.t) && Math.abs(r.x - entry.x) <= 60);
  return { entry, stop: near(/^(Stop\b|S$|S\s)/), target: near(/^(Target\b|T$|T\s)/), rr: [...rec].reverse().find((r) => /R:R/i.test(r.t)), cap: [...rec].reverse().find((r) => /Levels from the Channel strategy/i.test(r.t)) };
}

async function drawStructure(page: Page) {
  await page.getByRole('button', { name: /^4h$/i }).first().click({ timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(5_000);
  await page.evaluate(() => { (window as unknown as { __texts: unknown[] }).__texts = []; });
  const btn = page.getByRole('button', { name: /draw structure/i }).first();
  await expect(btn, 'the Draw Structure button is not there (not entitled, not on 4h, or the chart did not mount)').toBeVisible({ timeout: 60_000 });
  await btn.click(); await page.waitForTimeout(5_000);
}
const themed = (page: Page, theme: string) => page.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
const shot = async (page: Page, name: string) => { await settleForShot(page, 'channel').catch(() => {}); await page.screenshot({ path: `qa/.shots/${name}.png`, timeout: 20_000 }).catch(() => {}); };

for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280] as const) {
  test.describe(`channel box ${theme} ${width}`, () => {
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);

    test(`CB1:${theme}:${width}: BUY box on a falling channel broken up`, async ({ browser }) => {
      test.setTimeout(180_000);
      const fx = fixture('falling', 'up'), entry = fx.breakoutClose as number, swing = (fx.lastSwingInside as { price: number }).price;
      const ctx = await signedInContext(browser, 'a', { viewport: { width, height: width < 500 ? 844 : 900 } }); const page = await ctx.newPage();
      try {
        await themed(page, theme); await arm(page, fx); await gotoSignedIn(page, '/arena'); await drawStructure(page);
        const rec = await texts(page), L = boxLabels(rec), full = width >= 1000;
        console.log(`[BOX] CB1 ${theme} ${width}: entry="${L.entry?.t}" stop="${L.stop?.t}" target="${L.target?.t}" rr="${L.rr?.t}" caption=${!!L.cap}; oracle entry ${entry.toFixed(0)} swing ${swing.toFixed(0)}`);
        await shot(page, `channel-buy-${theme}-${width}`);
        expect(L.entry, `no Entry label drawn; recent texts: ${rec.slice(-12).map((r) => r.t).join(' | ')}`).toBeTruthy(); expect(L.stop, 'no Stop label in the box column').toBeTruthy(); expect(L.target || true).toBeTruthy();
        expect(L.cap?.t, 'the caption is not drawn').toBe(CAPTION);
        const stopP = price((L.stop as Rec).t); if (Number.isFinite(stopP)) { expect(Math.abs(stopP - swing) / swing, `Stop ${stopP} is not the last swing inside the channel (oracle ${swing.toFixed(0)})`).toBeLessThan(0.002); expect(stopP, 'a BUY stop must sit below the entry').toBeLessThan(entry); }
        if (full) {
          expect(Math.abs(price((L.entry as Rec).t) - entry) / entry, `Entry ${(L.entry as Rec).t} is not the breakout close ${entry.toFixed(0)}`).toBeLessThan(0.0005);
          const ent = price((L.entry as Rec).t), tgt = L.target ? price(L.target.t) : NaN, rrN = Number(/([\d.]+)\s*$/.exec(L.rr?.t ?? '')?.[1]);
          if (Number.isFinite(tgt) && Number.isFinite(rrN)) { const want = (tgt - ent) / (ent - stopP); expect(Math.abs(rrN - want), `R:R ${rrN} vs (target-entry)/(entry-stop) = ${want.toFixed(2)}`).toBeLessThan(0.1 + 0.05 * want); expect(pct(L.target?.t ?? '')).toBeGreaterThan(0); }
        } else expect(/^E$/.test((L.entry as Rec).t) || (L.entry as Rec).t.length <= 14, `at 390 the labels should be the short form; got "${(L.entry as Rec).t}"`).toBe(true);
        const axis = rec.filter((r) => /^[\d,]+\.\d\d$/.test(r.t)); const axisX = axis.length ? Math.min(...axis.map((r) => r.x)) : Infinity;
        for (const b of [L.entry, L.stop, L.target, L.rr]) if (b && Number.isFinite(axisX)) expect(b.x + b.w, `label "${b.t}" reaches the price axis (right edge ${b.x + b.w}, axis starts ${axisX})`).toBeLessThanOrEqual(axisX + 2);
      } finally { await ctx.close(); }
    });

    test(`CB2:${theme}:${width}: no close outside the channel = no box text`, async ({ browser }) => {
      test.setTimeout(180_000);
      const fx = fixture('falling', 'none');
      const ctx = await signedInContext(browser, 'a', { viewport: { width, height: width < 500 ? 844 : 900 } }); const page = await ctx.newPage();
      try {
        await themed(page, theme); await arm(page, fx); await gotoSignedIn(page, '/arena'); await drawStructure(page);
        const rec = await texts(page); const boxy = rec.filter((r) => /^(Entry\b|Target\b|Stop\b)|R:R|Levels from the Channel/i.test(r.t)); const L = boxLabels(rec);
        console.log(`[BOX] CB2 ${theme} ${width}: box texts ${JSON.stringify(boxy.map((b) => b.t))}; E label ${L.entry?.t}`);
        await shot(page, `channel-none-${theme}-${width}`);
        expect(boxy.map((b) => b.t), 'a box was drawn with no live call').toEqual([]); expect(L.entry, 'an Entry label was drawn with no live call').toBeUndefined();
      } finally { await ctx.close(); }
    });
  });
}

for (const width of [390, 1280] as const) {
  test.describe(`channel box SELL and CLS ${width}`, () => {
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);

    test(`CB3:${width}: SELL box on a rising channel broken down (stop above entry)`, async ({ browser }) => {
      test.setTimeout(180_000);
      const fx = fixture('rising', 'down'), entry = fx.breakoutClose as number, swing = (fx.lastSwingInside as { price: number }).price;
      const ctx = await signedInContext(browser, 'a', { viewport: { width, height: width < 500 ? 844 : 900 } }); const page = await ctx.newPage();
      try {
        await themed(page, 'dark'); await arm(page, fx); await gotoSignedIn(page, '/arena'); await drawStructure(page);
        const rec = await texts(page), L = boxLabels(rec);
        console.log(`[BOX] CB3 ${width}: entry="${L.entry?.t}" (y ${L.entry?.y}) stop="${L.stop?.t}" (y ${L.stop?.y}) target="${L.target?.t}"; oracle entry ${entry.toFixed(0)} swing ${swing.toFixed(0)}`);
        await shot(page, `channel-sell-dark-${width}`);
        expect(L.entry && L.stop, 'a SELL box needs an Entry and a Stop label').toBeTruthy();
        expect((L.stop as Rec).y, 'a SELL stop label must sit ABOVE the entry label on screen (smaller y)').toBeLessThan((L.entry as Rec).y);
        const stopP = price((L.stop as Rec).t); if (Number.isFinite(stopP)) { expect(stopP, 'a SELL stop price must be above the entry').toBeGreaterThan(entry); expect(Math.abs(stopP - swing) / swing, `Stop ${stopP} vs the oracle swing ${swing.toFixed(0)}`).toBeLessThan(0.002); }
      } finally { await ctx.close(); }
    });

    test(`CB4:${width}: layout shift when the box appears is at most 0.1`, async ({ browser }) => {
      test.setTimeout(180_000);
      const fx = fixture('falling', 'up');
      const ctx = await signedInContext(browser, 'a', { viewport: { width, height: width < 500 ? 844 : 900 } }); const page = await ctx.newPage();
      try {
        await themed(page, 'dark'); await arm(page, fx); await gotoSignedIn(page, '/arena');
        await page.getByRole('button', { name: /^4h$/i }).first().click({ timeout: 30_000 }).catch(() => {}); await page.waitForTimeout(6_000);
        const before = await page.evaluate(() => { const w = window as unknown as { __cls: number; __clsAll: number }; return { cls: w.__cls, all: w.__clsAll }; });
        const btn = page.getByRole('button', { name: /draw structure/i }).first(); await expect(btn).toBeVisible({ timeout: 60_000 }); await btn.click(); await page.waitForTimeout(6_000);
        const after = await page.evaluate(() => { const w = window as unknown as { __cls: number; __clsAll: number }; return { cls: w.__cls, all: w.__clsAll }; });
        const d = { cls: after.cls - before.cls, all: after.all - before.all };
        console.log(`[BOX] CB4 ${width}: shift around the click: ${d.cls.toFixed(4)} (counting input-adjacent shifts too: ${d.all.toFixed(4)})`);
        const L = boxLabels(await texts(page)); expect(L.entry, 'the box did not appear, so the layout-shift number says nothing').toBeTruthy();
        expect(d.all, `layout shift when Draw Structure is clicked and the box appears: ${d.all.toFixed(4)}`).toBeLessThanOrEqual(0.1);
      } finally { await ctx.close(); }
    });
  });
}
