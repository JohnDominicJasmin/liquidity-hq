/* #1263 "Phone (390): the box labels stay readable (short form T / E / S), and nothing covers the price axis. Light and dark." ON PRODUCTION, SIGNED OUT, read-only (GETs only; the only interaction is the local strategy menu).
 * The candle feed is served from QA's SYNTHETIC CHANNEL FIXTURE inside MY browser (route stub, never sent anywhere): a falling channel with an upward breakout, i.e. a live BUY call, so the Channel strategy draws its position box. The exchange websockets are closed so no live bar interferes. Nothing is written anywhere.
 * Measured at 390 in dark and in light (the chart is a canvas, so the evidence is the canvas itself): every fillText the chart draws is recorded (text, x, y, font, measured width), then
 *   L1 the box's labels are drawn and read in the SHORT form: T / E / S (or the long Target / Entry / Stop is reported, printed either way)   L2 NO label's right edge reaches the price axis: every box label's x + width is left of the leftmost price-axis tick text   L3 the call box says BUY and the Channel verdict is the fixture's
 * Also prints whether a "Draw Structure" control exists signed out (it is a Pro tool: if the box only draws through it, the box cannot be measured signed out and the result says so). Saves qa/.shots/box-<theme>-390.png (CI artifact). */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { channelCandles } from '../fixtures/channelCandles';

mkdirSync('qa/.shots', { recursive: true });
const TF = 4 * 3_600_000;

for (const theme of ['dark', 'light'] as const) {
  test(`BOX ${theme} 390 (prod, signed out): T / E / S labels and the price axis`, async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = channelCandles({ dir: 'falling', breakout: 'up', tf: TF, t0: Date.now() - 130 * TF });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript((t) => {
      try { localStorage.setItem('theme', t as string); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ }
      const w = window as unknown as { __ft?: Array<{ t: string; x: number; y: number; font: string; w: number }> }; w.__ft = [];
      const proto = CanvasRenderingContext2D.prototype; const orig = proto.fillText;
      proto.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, ...rest: number[]) { try { const m = this.measureText(String(text)); w.__ft!.push({ t: String(text), x, y, font: this.font, w: m.width }); if (w.__ft!.length > 6000) w.__ft!.splice(0, 2000); } catch { /* ignore */ } return (orig as (...a: unknown[]) => void).call(this, text, x, y, ...rest); } as typeof proto.fillText;
    }, theme);
    await ctx.routeWebSocket(/(bybit|bytick|binance)/, (ws) => { ws.close(); });
    const page = await ctx.newPage();
    /* NOTHING PAID CAN REACH THE SERVER FROM THIS SPEC: every AI route is aborted inside my browser before it is sent */
    let aiAttempts = 0; const AI_PATHS = ['/api/grok', '/api/thesis-check', '/api/strategy-research', '/api/pine-script', '/api/shadow-account', '/api/behavioral-bias', '/api/macro-context', '/api/briefing', '/api/dry-powder', '/api/onchain']; await page.route((u) => AI_PATHS.some((p) => u.pathname === p || u.pathname.startsWith(p + '-') || u.pathname.startsWith(p + '/')), (r) => { aiAttempts++; return r.abort(); });
    const lim = (u: string) => Number(new URL(u).searchParams.get('limit') ?? '300');
    await page.route('**/api/market/klines**', (r) => {
      const u = new URL(r.request().url()), n = fx.candles.slice(-Math.min(lim(r.request().url()), fx.candles.length));
      const body = u.searchParams.get('source') === 'bybit'
        ? { retCode: 0, retMsg: 'OK', result: { list: n.slice().reverse().map((k) => [String(k.timestamp), String(k.open), String(k.high), String(k.low), String(k.close), String(k.volume ?? 0), '0']) } }
        : n.map((k) => [k.timestamp, String(k.open), String(k.high), String(k.low), String(k.close), String(k.volume ?? 0)]);
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    try {
      await page.goto('/arena?coin=btc&tf=4h', { waitUntil: 'domcontentloaded', timeout: 90_000 });
      const sel = page.getByTestId('strategy-set-select').first(); await sel.waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(6_000);
      const enabled = await sel.isEnabled().catch(() => false); if (enabled) await sel.selectOption('channel', { timeout: 20_000 }).catch(() => undefined); await page.waitForTimeout(9_000);
      const draw = page.getByRole('button', { name: /draw structure/i }); const drawCount = await draw.count(); const drawEnabled = drawCount ? await draw.first().isEnabled().catch(() => false) : false;
      if (drawCount && drawEnabled) { await draw.first().click().catch(() => undefined); await page.waitForTimeout(10_000); }
      console.log(`[BOX ${theme}] clicked Draw Structure ${drawCount && drawEnabled} · AI requests aborted in my browser ${aiAttempts}`);
      const call = await page.evaluate(() => ({ verdict: (document.querySelector('[data-testid="strategy-call-verdict"]') as HTMLElement | null)?.innerText?.trim() ?? '', box: ((document.querySelector('[data-testid="strategy-call-box"]') as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').slice(0, 220) }));
      console.log(`[BOX ${theme}] menu enabled ${enabled} · Draw Structure controls ${drawCount} (enabled ${drawEnabled}) · call "${call.verdict}" ${call.box}`);
      const texts = await page.evaluate(() => { const w = window as unknown as { __ft?: Array<{ t: string; x: number; y: number; font: string; w: number }> }; return (w.__ft ?? []).slice(-1500); });
      const tick = (s: string) => /^[\d,]+(\.\d+)?$/.test(s.trim()) && s.trim().length >= 4;
      const labelRe = /^(T|E|S|Target|Entry|Stop|TP|SL|R:R.*|.*R:R.*|[TES] [\d,.]+|Target [\d,.]+|Entry [\d,.]+|Stop [\d,.]+)$/;
      const labels = texts.filter((q) => labelRe.test(q.t.trim()) && q.t.trim().length <= 24); const ticks = texts.filter((q) => tick(q.t));
      const axisLeft = ticks.length ? Math.min(...ticks.map((q) => q.x)) : null;
      const uniq = (a: typeof texts) => Array.from(new Map(a.map((q) => [`${q.t}@${Math.round(q.x)},${Math.round(q.y)}`, q])).values());
      /* DIAGNOSTIC: every distinct non-axis text the chart drew (so the label wording is read from the canvas, not guessed) */
      const others = uniq(texts.filter((q) => !tick(q.t) && q.t.trim().length > 0 && q.t.trim().length <= 40)); console.log(`[BOX ${theme}] canvas texts (non-axis, distinct ${others.length}): ${JSON.stringify(others.slice(-70).map((q) => `${q.t.trim().slice(0, 30)}@${Math.round(q.x)},${Math.round(q.y)} w${Math.round(q.w)}`))}`);
      /* the price axis: numeric ticks drawn right of x=250, with their left edge and width; and the chart canvas size */
      const axisTicks = uniq(ticks.filter((q) => q.x > 250)); const cv = await page.evaluate(() => Array.from(document.querySelectorAll('.klc-canvas canvas, .klc-wrap canvas')).map((c) => `${(c as HTMLCanvasElement).clientWidth}x${(c as HTMLCanvasElement).clientHeight}@${Math.round(c.getBoundingClientRect().left)}`).slice(0, 6));
      console.log(`[BOX ${theme}] price-axis ticks right of x=250: ${JSON.stringify(axisTicks.slice(-14).map((q) => `${q.t}@${Math.round(q.x)} w${Math.round(q.w)} right${Math.round(q.x + q.w)}`))} · min axis left x ${axisTicks.length ? Math.round(Math.min(...axisTicks.map((q) => q.x))) : 'n/a'} · canvases ${JSON.stringify(cv)}`);
      const boxLabels = others.filter((q) => /^(Target|Entry|Stop)\b/.test(q.t.trim())); const minAxisX = axisTicks.length ? Math.min(...axisTicks.map((q) => q.x)) : null; const boxOver = minAxisX == null ? [] : boxLabels.filter((q) => q.x + q.w > minAxisX + 0.5);
      console.log(`[BOX ${theme}] box labels ${JSON.stringify(boxLabels.map((q) => `${q.t.trim()} right${Math.round(q.x + q.w)}`))} · reaching the axis ${JSON.stringify(boxOver.map((q) => q.t.trim()))}`);
      const L = uniq(labels).slice(-12); const over = axisLeft == null ? [] : L.filter((q) => q.x + q.w > axisLeft + 0.5);
      console.log(`[BOX ${theme}] labels ${JSON.stringify(L.map((q) => ({ t: q.t.slice(0, 22), x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.w), right: Math.round(q.x + q.w) })))} · axis ticks ${ticks.length} (leftmost x ${axisLeft == null ? 'n/a' : Math.round(axisLeft)}) · labels reaching the axis ${JSON.stringify(over.map((q) => q.t))}`);
      await page.screenshot({ path: `qa/.shots/box-${theme}-390.png` });
      expect(call.verdict.length, 'no strategy call at all: the stubbed candles were not used or the strategy did not run').toBeGreaterThan(0);
      expect(over, 'a box label reaches the price axis').toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}
