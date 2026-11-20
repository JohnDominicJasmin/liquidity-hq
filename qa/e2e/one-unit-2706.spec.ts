/* #2706 SIGN-OFF CELLS (PM ruling A, 2026-11-20: ONE PRICE UNIT ON THE ARENA for 1000x coins): 1000PEPE and 1000BONK, 390 and 1280, dark, the Pro fixture, ema_stack selected, on a DEPLOYED qa. Paid AI fenced: the Quick read is a STUB that records the request the page builds.
 * Per cell (printed as [UNIT] lines + shots qa/.shots/unit-<coin>-<width>*.png):
 *   chart       the last candle's close of the series the chart DRAWS (the axis unit), read from the klinecharts instance
 *   call box    every $ amount in the strategy call box (Watching, entry, stop...) against that close
 *   page        every $ amount on the Arena page that is not a K / M / B size, on a line carrying a price label (Watching, Entry, Stop, Target, EMA, SMA, VWAP, POC, Support, Resistance, Supply, Demand, Wrong if): all within 0.3x to 3x of the chart close, else listed
 *   overlays    every price point of the strategy and EMA overlays on the chart (the instance's getOverlays), within 0.3x to 3x of the chart close
 *   AI context  the request body the stubbed Quick read sends: every $ amount on a price-labelled line (Last Close, EMA, SMA, VWAP, POC, price, support, resistance, wall) within 0.3x to 3x of the chart close
 *   label       the chart symbol reads 1000PEPE / 1000BONK
 * Nothing is bought, nothing is written (settings writes stubbed), no paid AI route is reached. A measurement plus the picture for PM's visual sign-off. */
import { test, expect, type Page, type Browser, type Route } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

mkdirSync('qa/.shots', { recursive: true });
test.skip(!AUTH_READY, AUTH_SKIP_REASON);
const LABEL = /(Watching|Entry|Stop|Target|EMA|SMA|VWAP|POC|Support|Resistance|Supply|Demand|Wrong if|Last Close|price|wall)/i;
const amounts = (s: string) => [...s.matchAll(/\$\s?([0-9][0-9,]*\.?[0-9]*)(\s?[KMBkmb]\b)?/g)].filter((m) => !m[2]).map((m) => ({ text: m[0], value: Number(m[1].replace(/,/g, '')) })).filter((a) => Number.isFinite(a.value) && a.value > 0);
const inUnit = (v: number, ref: number) => v >= ref * 0.3 && v <= ref * 3;

async function open(browser: Browser, coin: string, width: number) {
  const ctx = await signedInContext(browser, 'a', { viewport: { width, height: width >= 1000 ? 900 : 844 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage(); await installPaidAiFence(page);
  const posts: string[] = [];
  await page.route('**/api/grok**', async (r: Route) => {
    if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ usage: { quick_used: 0, quick_limit: 50, deep_used: 0, deep_limit: 20 } }) });
    posts.push(r.request().postData() ?? '');
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ usage: { quick_used: 1, quick_limit: 50, deep_used: 0, deep_limit: 20 }, result: { signal: 'FLAT', confidence: 50, entryLow: null, entryHigh: null, tp: null, sl: null, levels: [], chartAnalysis: 'fixture', patterns: [], reasoning: 'fixture', catalysts: [], waitFor: 'fixture', bias: 'NEUTRAL', raidSetup: null, raidTarget: null, raidTrigger: null, analyzedAt: Date.now(), tf: '1h', session: 'fixture' } }) });
  });
  await page.route(/\/api\/settings(\?|$)/, async (route) => (route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: ['arena_strategy', 'strategy_selection'], rejected: [], settings: null }) })));
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => { if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' }); return route.fallback(); });
  await gotoSignedIn(page, `/arena?coin=${coin}&tf=1h`);
  return { ctx, page, posts };
}
async function probe(page: Page) {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__uChart = () => { const el = document.querySelector('.klc-canvas') as HTMLElement | null; if (!el) return null; const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$')); if (!key) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let f: any = (el as any)[key]; while (f) { let s = f.memoizedState; let n = 0; while (s && n < 300) { const q = s.memoizedState; if (q && typeof q === 'object' && q.current && typeof q.current.getOverlays === 'function') return q.current; s = s.next; n++; } f = f.return; } return null; };
  });
}

for (const coin of ['pepe', 'bonk']) for (const width of [1280, 390]) {
  test(`UNIT:${coin}:${width}`, async ({ browser }) => {
    test.setTimeout(420_000);
    const { ctx, page, posts } = await open(browser, coin, width);
    try {
      const sel = page.getByTestId('strategy-set-select').first(); await sel.waitFor({ state: 'visible', timeout: 90_000 }); await expect(sel).toBeEnabled({ timeout: 90_000 }); await page.waitForTimeout(5_000); await probe(page);
      let bars = 0; for (let i = 0; i < 45 && !bars; i++) { bars = await page.evaluate(() => { const c = (window as unknown as { __uChart: () => { getDataList: () => unknown[] } | null }).__uChart(); return c ? c.getDataList().length : 0; }); if (!bars) await page.waitForTimeout(1_000); }
      expect(bars, 'the chart holds no candles').toBeGreaterThan(50);
      await sel.selectOption('ema_stack', { timeout: 30_000 });
      for (let i = 0; i < 60; i++) { const st = await page.evaluate(() => { const b = document.querySelector('[data-testid="strategy-call-box"]') as HTMLElement | null; return { s: b?.dataset.strategy ?? '', v: !!document.querySelector('[data-testid="strategy-call-verdict"]') || !!document.querySelector('[data-testid="strategy-call-cant-run"]') }; }); if (st.s === 'ema_stack' && st.v) break; await page.waitForTimeout(1_000); }
      await page.waitForTimeout(4_000);
      const chart = await page.evaluate(() => {
        const c = (window as unknown as { __uChart: () => { getDataList: () => Array<{ close: number; timestamp: number }>; getOverlays: (o?: unknown) => Array<{ name: string; groupId?: string; points: Array<{ value?: number }> }> } | null }).__uChart()!;
        const l = c.getDataList(); const ov = c.getOverlays(); return { close: l[l.length - 1].close, ov: ov.map((o) => ({ name: o.name, group: o.groupId ?? '', values: (o.points || []).map((p) => p.value).filter((v): v is number => typeof v === 'number') })) };
      });
      const close = chart.close;
      const box = await page.evaluate(() => ((document.querySelector('[data-testid="strategy-call-box"]') as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' '));
      const bodyText = await page.evaluate(() => document.body.innerText);
      const lines = bodyText.split('\n').filter((l) => LABEL.test(l) && /\$/.test(l));
      const pageOut = lines.flatMap((l) => amounts(l).filter((a) => !inUnit(a.value, close)).map((a) => `${a.text} in "${l.trim().slice(0, 70)}"`));
      const tiny = bodyText.split(String.fromCharCode(10)).flatMap((l) => amounts(l).filter((a) => a.value < close * 0.02).map((a) => `${a.text} in "${l.trim().slice(0, 90)}"`)); console.log(`[UNIT] ${coin} ${width} page amounts far below the chart close (per-token next to a 1000x chart): ${tiny.length} ${JSON.stringify(tiny.slice(0, 10))}`);
      const boxAmts = amounts(box); const boxOut = boxAmts.filter((a) => !inUnit(a.value, close));
      const ovOut = chart.ov.filter((o) => /strategy|ema/i.test(o.name + o.group)).flatMap((o) => o.values.filter((v) => !inUnit(v, close)).map((v) => `${o.name}:${v}`));
      const symbol = await page.evaluate(() => { const t = document.body.innerText; const m = /(1000\w+)\/USDT/.exec(t); return m ? m[0] : ''; });
      console.log(`[UNIT] ${coin} ${width}: chart last close ${close} · symbol "${symbol}" · call box amounts ${JSON.stringify(boxAmts.map((a) => a.text))} (out of unit: ${boxOut.length}) · page price-labelled amounts out of unit: ${pageOut.length} ${JSON.stringify(pageOut.slice(0, 6))} · overlay points out of unit: ${ovOut.length} ${JSON.stringify(ovOut.slice(0, 6))} · overlays on chart ${chart.ov.length}`);
      /* shots: the full page at 1280, the chart and the call box at 390 */
      await page.evaluate(() => { document.querySelector('.klc-wrap')?.scrollIntoView({ block: 'start' }); }); await page.waitForTimeout(500);
      if (width >= 1000) await page.screenshot({ path: `qa/.shots/unit-${coin}-${width}.png`, mask: [page.locator('text=/@/')], maskColor: '#000000', timeout: 30_000 }).catch(() => {});
      else { await page.locator('.klc-wrap').first().screenshot({ path: `qa/.shots/unit-${coin}-${width}-chart.png`, timeout: 30_000 }).catch(() => {}); await page.evaluate(() => { document.querySelector('[data-testid="strategy-call-box"]')?.scrollIntoView({ block: 'center' }); }); await page.waitForTimeout(300); await page.locator('[data-testid="strategy-call-box"]').first().screenshot({ path: `qa/.shots/unit-${coin}-${width}-callbox.png`, timeout: 30_000 }).catch(() => {}); }
      /* the AI context: click the Quick read, read the request the page builds */
      const quick = page.locator('button.arena-quick-btn').first(); let aiLine = 'Quick button not found';
      if (await quick.count()) { await quick.scrollIntoViewIfNeeded().catch(() => {}); await expect(quick).toBeEnabled({ timeout: 60_000 }).catch(() => {}); await quick.click({ timeout: 20_000 }).catch(() => {}); for (let i = 0; i < 40 && !posts.length; i++) await page.waitForTimeout(500); }
      if (posts.length) {
        const body = posts[0]; const leaves: Array<{ path: string; text: string }> = [];
        const walk = (v: unknown, pth: string) => { if (typeof v === 'string') leaves.push({ path: pth, text: v }); else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${pth}[${i}]`)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, pth ? `${pth}.${k}` : k); };
        try { walk(JSON.parse(body), ''); } catch { leaves.push({ path: 'raw', text: body }); }
        const priced = leaves.filter((l) => /\$/.test(l.text)); const ALL = priced.flatMap((l) => amounts(l.text).filter((a) => !inUnit(a.value, close)).map((a) => `${l.path}: ${a.text} in "${l.text.slice(0, 90)}"`));
        /* the coin's OWN price fields: a path or text naming a level of this coin; other assets' prices (BTC, ETH, macro) are legitimately in their own unit */
        const OWN = /price|ma20|vwap|poc|vah|val|support|resist|level|ema|sma|fib|wall|liq|zone|target|stop|entry|supply|demand|nearest|cluster|high|low|close|pivot|range|structure|bos/i; const aiOut = ALL.filter((s) => OWN.test(s.split(':')[0]) && !/^context\.(emaATR|oilPrice|goldLine|cbPremium|maxPain|btcGex|etfFlows|ethEtfFlows|stablecoinFlow):/.test(s));   /* other assets and distances are legitimately in their own unit */
        aiLine = `${body.length} chars · string fields with a $ amount ${priced.length} · ALL out of unit ${ALL.length} · own-coin out of unit ${aiOut.length}`; console.log(`[UNIT] ${coin} ${width} AI ALL: ${JSON.stringify(ALL.slice(0, 14))}`); console.log(`[UNIT] ${coin} ${width} AI price fields: ${JSON.stringify(priced.filter((l) => OWN.test(l.path)).slice(0, 12).map((l) => `${l.path}=${l.text.slice(0, 50)}`))}`);
        expect(aiOut, `AI context price fields out of the chart's unit for ${coin}: ${aiOut.join(' | ')}`).toEqual([]);
      } else aiLine = 'no Quick read request was captured';
      console.log(`[UNIT] ${coin} ${width} AI context: ${aiLine}`);
      expect(symbol, 'the chart symbol label').toMatch(coin === 'pepe' ? /1000PEPE/ : /1000BONK/);
      expect(tiny, 'page amounts at a per-token scale next to the 1000x chart').toEqual([]); expect(boxOut, 'call box amounts out of the chart unit').toEqual([]); expect(pageOut, 'page price-labelled amounts out of the chart unit').toEqual([]); expect(ovOut, 'overlay prices out of the chart unit').toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}
