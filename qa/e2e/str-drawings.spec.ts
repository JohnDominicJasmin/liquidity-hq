/* STRATEGY DRAWINGS (owner order, feature freeze, priority 2): every strategy in lib/strategies STRATEGIES (16 on the qa build) x coin x timeframe, signed in as the Pro fixture ('a'), on the REAL market data the target serves.
 * After a strategy is picked the chart must show AT LEAST ONE drawing (level line, zone, polyline, marker) even when the call is WAIT; where the strategy cannot run, the panel must SAY WHY (lib/strategies/availability.ts).
 * One test = one coin x one timeframe x one width; ONE page load, the strategy menu is switched in place (paid AI routes fenced, settings writes stubbed, nothing is clicked except the menu).
 * A strategy the menu GREYS OUT for this coin / timeframe (a disabled <option> with the reason as its tooltip) cannot be picked in place, so it is read two ways: the menu's own greyed state and tooltip, and (width 1280 only)
 * a second page load with that strategy SAVED as the user's pick (the settings row is patched on the way in), where the call box must say why and the chart must show nothing stale.
 * Title: STR:<coin>:<tf>:<width>, so a shard is a --grep: -f "spec=--grep=STR:btc:1h:1280".
 *
 * HOW A DRAWING IS MEASURED (method is printed per cell):
 *   instance  the klinecharts instance, found through React's fiber tree (the chart sits in a useRef of KLineProChart: no app seam needed): chart.getOverlays({ groupId: 'strategy_overlay' }) = the strategy's own drawings
 *             (strategyLevelLine / strategyZone / strategyPolyline / strategyMarker; a marker with extendData.past is an arrow of a PAST signal); each is projected to pixels (convertToPixel) and counted IN VIEW
 *             when its bounding box meets the candle pane (a level is a line from its candle to the right edge).
 *   pixels    canvas pixel statistics: chart canvases are read with getImageData; pixels that differ between the 'auto' (no strategy) baseline and the strategy state, noise (two baselines 700 ms apart) shown beside it.
 *             Corroboration only: a strategy that also switches a chip on adds those lines to the difference.
 *   If the instance cannot be found the cell is decided by pixels alone and says so (method=pixels).
 * Status: PASS (a drawing in view), WEAK (in view only as arrows of PAST signals: nothing drawn for the current state), EXPLAINED (no drawing and the menu / call box states why the strategy cannot run), FAIL (anything else).
 * Printed: [STR] <coin> <tf> <strategy>: drawings=<n> method=<..> verdict=<..> reason=<..> | status=... Shots (dark): qa/.shots/str-<coin>-<tf>-<strategy>-<width>.png (+ -panel.png at 390: the call box). */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';
import { COIN_UNIVERSE } from '../../lib/coinUniverse.generated';

mkdirSync('qa/.shots', { recursive: true });
test.skip(!AUTH_READY, AUTH_SKIP_REASON);
test.describe.configure({ retries: 0 });

/* The menu order of lib/strategies/index.ts STRATEGY_GROUPS: Beginner / Trend, Price action / SMC, Sessions, Derivatives. 16 strategies. */
const STRATS = ['ema_stack', 'ema_cross', 'range_bounce', 'liq_sweep_mss', 'supply_demand', 'sr_flip', 'fvg', 'bos_fvg', 'channel', 'rsi_divergence', 'bb_squeeze', 'ny_open_breakout', 'session_sweep', 'vwap_reclaim', 'funding_oi_squeeze', 'cvd_absorption'] as const;
const EXPECT_COMMIT = '';   /* any build: the served commit is logged per cell. A hard-coded sha made the first runs wait 15 min and fail on a build that was fine (runs 45018904351, 45019923277) */
const CRYPTO = ['btc', 'eth', 'sol', 'hype', 'doge', 'pepe', 'cyber'] as const;
const TOKENIZED_DEEP = ['aapl', 'tsla', 'spy', 'xau', 'hk0700', 'anthropic'] as const;   // stock, stock, ETF, gold, a Hong Kong share (HK$), a pre-IPO reference
const TOKENIZED_ALL: string[] = COIN_UNIVERSE.filter((r) => !!r.kind).map((r) => r.id);
const TFS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'] as const;   // lib/limits.ts ARENA_TFS
const TFS_390 = ['15m', '1h', '4h', '1d'] as const;
const WIDTHS = [1280, 390] as const;

async function openArena(browser: Browser, coin: string, tf: string, width: number, strategy: string | null, theme: 'dark' | 'light' = 'dark') {
  const ctx = await signedInContext(browser, 'a', { viewport: { width, height: width >= 1000 ? 900 : 844 } });
  await ctx.addInitScript((th) => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('theme', th as string); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
  /* every canvas text with an off-window arrow (up, down, left) is recorded: the chart's edge hints for drawings beyond the visible window (6576e45+) are canvas text, so this is the direct evidence that one was drawn */
  await ctx.addInitScript(() => {
    const proto = CanvasRenderingContext2D.prototype; const orig = proto.fillText;
    proto.fillText = function (this: CanvasRenderingContext2D, t: string, ...a: [number, number, number?]) { try { if (/[↑↓←]/.test(String(t))) { const w = window as unknown as { __strEdge?: Set<string> }; (w.__strEdge = w.__strEdge || new Set()).add(String(t)); } } catch { /* ignore */ } return orig.call(this, t, ...a); } as typeof proto.fillText;
  });
  const page = await ctx.newPage(); await installPaidAiFence(page);
  await page.route(/\/api\/settings(\?|$)/, async (route) => (route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: ['arena_strategy', 'strategy_selection'], rejected: [], settings: null }) })));
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' });
    const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res });
    const p = (r: Record<string, unknown>) => ({ ...r, arena_strategy: strategy }); return route.fulfill({ response: res, json: Array.isArray(body) ? body.map(p) : p(body as Record<string, unknown>) });
  });
  await gotoSignedIn(page, `/arena?coin=${coin}&tf=${tf}`);
  return { ctx, page };
}

/* Everything the page-side helpers need lives on window so one evaluate call can find the chart and measure it. */
async function installProbe(page: Page) {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__strChart = () => {
      const el = document.querySelector('.klc-canvas') as HTMLElement | null; if (!el) return null;
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$')); if (!key) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let f: any = (el as any)[key];
      while (f) {
        let s = f.memoizedState; let n = 0;
        while (s && n < 300) { const q = s.memoizedState; if (q && typeof q === 'object' && q.current && typeof q.current.getOverlays === 'function') return q.current; s = s.next; n++; }
        f = f.return;
      }
      return null;
    };
    w.__strSnap = (name: string) => {
      const cs = Array.from(document.querySelectorAll('.klc-canvas canvas')) as HTMLCanvasElement[]; w.__strPx = w.__strPx || {};
      w.__strPx[name] = cs.map((c) => { try { return c.getContext('2d')!.getImageData(0, 0, c.width, c.height); } catch { return null; } });
      return cs.length;
    };
    w.__strDiff = (a: string, b: string) => {
      const A = w.__strPx[a] as Array<ImageData | null>, B = w.__strPx[b] as Array<ImageData | null>; let n = 0;
      for (let i = 0; i < Math.min(A.length, B.length); i++) {
        const x = A[i], y = B[i]; if (!x || !y || x.width !== y.width || x.height !== y.height) continue;
        const d1 = x.data, d2 = y.data;
        for (let p = 0; p < d1.length; p += 4) { if (Math.abs(d1[p] - d2[p]) + Math.abs(d1[p + 1] - d2[p + 1]) + Math.abs(d1[p + 2] - d2[p + 2]) > 24) n++; }
      }
      return n;
    };
  });
}

type Cell = { instance: boolean; bars: number | null; total: number; now: number; past: number; inView: number; inViewNow: number; kinds: Record<string, number>; pane: string };
async function readOverlays(page: Page): Promise<Cell> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any; const chart = w.__strChart();
    if (!chart) return { instance: false, bars: null, total: 0, now: 0, past: 0, inView: 0, inViewNow: 0, kinds: {}, pane: '' };
    const list = chart.getOverlays({ groupId: 'strategy_overlay' }) as Array<{ name: string; points: Array<{ timestamp?: number; value?: number }>; extendData?: { past?: boolean } }>;
    let pw = 0, ph = 0; try { const sz = chart.getSize?.('candle_pane', 'main'); pw = sz?.width || 0; ph = sz?.height || 0; } catch { /* old api */ }
    const cv = document.querySelector('.klc-canvas') as HTMLElement | null;
    if (!ph) ph = cv?.clientHeight || 0; if (!pw) pw = cv?.clientWidth || 0;
    const kinds: Record<string, number> = {}; let inView = 0, inViewNow = 0, now = 0, past = 0;
    for (const o of list) {
      const isPast = !!o.extendData?.past; kinds[isPast ? 'pastArrow' : o.name] = (kinds[isPast ? 'pastArrow' : o.name] || 0) + 1; if (isPast) past++; else now++;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of o.points || []) {
        if (typeof p.value !== 'number') continue;
        try { const r = chart.convertToPixel({ timestamp: p.timestamp, value: p.value }, { paneId: 'candle_pane' }); const px = Array.isArray(r) ? r[0] : r; if (px && Number.isFinite(px.y)) { y0 = Math.min(y0, px.y); y1 = Math.max(y1, px.y); if (Number.isFinite(px.x)) { x0 = Math.min(x0, px.x); x1 = Math.max(x1, px.x); } } } catch { /* skip */ }
      }
      if (!Number.isFinite(y0)) continue;
      if (o.name === 'strategyLevelLine') x1 = pw;   // a level runs from its candle to the right edge
      if (!Number.isFinite(x0)) { x0 = 0; x1 = pw; }
      /* a labelled ZONE beyond the visible price window draws an edge label (price + arrow) since 6576e45, so a zone counts when it overlaps the window sideways, whatever its height */
      const xin = x1 >= 0 && x0 <= pw; const seen = o.name === "strategyZone" ? xin : (y1 >= 0 && y0 <= ph && xin);
      if (seen) { inView++; if (!isPast) inViewNow++; }
    }
    return { instance: true, bars: (chart.getDataList?.() || []).length, total: list.length, now, past, inView, inViewNow, kinds, pane: `${Math.round(pw)}x${Math.round(ph)}` };
  });
}

type Panel = { state: string; strategy: string; verdict: string; reason: string; watching: string; cantRun: string; errorText: string; marketClosed: string; box: string };
async function readPanel(page: Page): Promise<Panel> {
  return page.evaluate(() => {
    const q = (s: string) => (document.querySelector(`[data-testid="${s}"]`) as HTMLElement | null);
    const tx = (s: string) => (q(s)?.innerText || '').replace(/\s+/g, ' ').trim();
    const v = q('strategy-call-verdict'); const box = q('strategy-call-box');
    const state = q('strategy-call-cant-run') ? 'cant-run' : q('strategy-call-tf-unavailable') ? 'tf-unavailable' : q('strategy-call-unavailable') ? 'read-failed' : v ? 'verdict' : q('strategy-call-loading') ? 'loading' : box ? 'empty' : 'no-box';
    return { state, strategy: box?.dataset.strategy || '', verdict: (v?.dataset.verdict || '').toUpperCase(), reason: tx('strategy-call-reason'), watching: tx('strategy-call-watching'), cantRun: tx('strategy-call-cant-run'), errorText: [tx('strategy-call-unavailable'), tx('strategy-call-unavailable-detail'), tx('strategy-call-tf-unavailable')].filter(Boolean).join(' | '), marketClosed: tx('strategy-call-market-closed'), box: (box?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 240) };
  });
}

async function settlePanel(page: Page, sid: string): Promise<Panel> {
  let panel = await readPanel(page); const t1 = Date.now();
  while ((panel.state === 'loading' || panel.state === 'empty' || panel.state === 'no-box' || panel.strategy !== sid) && Date.now() - t1 < 30_000) { await page.waitForTimeout(500); panel = await readPanel(page); }
  await page.waitForTimeout(2_500);
  return readPanel(page);
}

async function shoot(page: Page, name: string, width: number) {
  await page.evaluate(() => { document.querySelector('.klc-wrap')?.scrollIntoView({ block: 'start' }); });
  await page.waitForTimeout(400);
  if (width >= 1000) await page.screenshot({ path: `qa/.shots/${name}.png`, mask: [page.locator('text=/@/')], maskColor: '#000000', timeout: 20_000 }).catch(() => {});
  else {
    await page.locator('.klc-wrap').first().screenshot({ path: `qa/.shots/${name}.png`, timeout: 20_000 }).catch(() => {});
    await page.evaluate(() => { document.querySelector('[data-testid="strategy-call-box"]')?.scrollIntoView({ block: 'center' }); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="strategy-call-box"]').first().screenshot({ path: `qa/.shots/${name}-panel.png`, timeout: 20_000 }).catch(() => {});
  }
}

type Spec = { title: string; coin: string; tf: string; width: number; mode: 'core' | 'fast'; px: boolean; theme?: 'dark' | 'light' };
const SPECS: Spec[] = [];
/* CORE: crypto across sizes (BTC, ETH, SOL, HYPE, DOGE, PEPE, CYBER) and the tokenized deep set, all 8 timeframes at 1280 and the four main ones at 390, with shots. */
for (const coin of [...CRYPTO, ...TOKENIZED_DEEP]) for (const tf of TFS) for (const width of WIDTHS) {
  if (width === 390 && !TFS_390.includes(tf as never)) continue;
  SPECS.push({ title: `STR:${coin}:${tf}:${width}`, coin, tf, width, mode: 'core', px: coin === 'btc' && width === 1280 && (tf === '1h' || tf === '4h') });
}
/* BREADTH: EVERY tokenized asset of the universe (stocks, ETFs, commodities, FX, pre-IPO references, tokenized assets) at 1h, 1280, no shots. */
for (const coin of ['bonk', 'floki', 'mog', 'cat', 'tag', 'turbo', 'sats', 'toshi']) SPECS.push({ title: `STRB:${coin}:1h:1280`, coin, tf: '1h', width: 1280, mode: 'fast', px: false });   // the other crypto coins quoted per 1000 units (coins.ts bybitMult)
for (const coin of TOKENIZED_ALL) SPECS.push({ title: `STRB:${coin}:1h:1280`, coin, tf: '1h', width: 1280, mode: 'fast', px: false });

/* LIGHT THEME (open line on #1263): the core 1h cells of BTC, ETH, PEPE, XAU and SPY at 1280 and 390 in the light theme. */
for (const coin of ['btc', 'eth', 'pepe', 'xau', 'spy']) for (const width of [1280, 390]) SPECS.push({ title: `STRL:${coin}:1h:${width}`, coin, tf: '1h', width, mode: 'core', px: false, theme: 'light' });

for (const sp of SPECS) {
  const { coin, tf, width } = sp;
  test(sp.title, async ({ browser }) => {
    test.setTimeout(1_500_000);
    const { ctx, page } = await openArena(browser, coin, tf, width, null, sp.theme ?? 'dark');
    const crashes: string[] = []; page.on('pageerror', (e) => crashes.push(String(e).slice(0, 160))); page.on('crash', () => crashes.push('PAGE CRASH'));
    /* what the derivatives strategies' data calls answered (the funding / open-interest / futures-taker reads go through the app's own server): status counts per kind */
    const net: Record<string, number> = {};
    const kindOf = (u: string) => /\/api\/proxy\?type=(funding-rate-1|funding-history|oi-hist)/.exec(u)?.[1] ?? (/\/api\/market\/klines\?source=binance-futures/.test(u) ? 'futures-klines' : null);
    page.on('response', (r) => { const k = kindOf(r.url()); if (k) { const key = `${k}:${r.status()}`; net[key] = (net[key] || 0) + 1; } });
    page.on('requestfailed', (r) => { const k = kindOf(r.url()); if (k) { const key = `${k}:FAILED`; net[key] = (net[key] || 0) + 1; } });
    const fails: string[] = []; const rows: string[] = []; const seededTodo: string[] = [];
    try {
      /* THE BUILD UNDER TEST: wait up to 15 min for the target to serve EXPECT_COMMIT (a deploy in progress), then fail loudly rather than measure another build */
      let served = ''; const tv = Date.now();
      for (;;) { served = await page.evaluate(async () => { try { return String(((await (await fetch('/api/version', { cache: 'no-store' })).json()) as { commit?: string }).commit ?? ''); } catch { return ''; } }); if (served.startsWith(EXPECT_COMMIT) || Date.now() - tv > 900_000) break; await page.waitForTimeout(15_000); }
      console.log(`[STR] ${coin} ${tf} @${width}: build served ${served} (expected ${EXPECT_COMMIT}) after ${Math.round((Date.now() - tv) / 1000)} s`);
      expect(served.startsWith(EXPECT_COMMIT), `the target serves ${served}, not ${EXPECT_COMMIT}`).toBe(true);
      const sel = page.getByTestId('strategy-set-select').first(); await sel.waitFor({ state: 'visible', timeout: 60_000 }); await expect(sel).toBeEnabled({ timeout: 90_000 });
      await page.waitForTimeout(sp.mode === 'core' ? 4_000 : 1_500); await installProbe(page);
      let bars: number | null = null; const t0 = Date.now();
      while (Date.now() - t0 < 45_000) { const c = await readOverlays(page).catch(() => null); bars = c?.bars ?? null; if (c?.instance && (c.bars ?? 0) > 0) break; await page.waitForTimeout(1_000); }
      const last = await page.evaluate(() => { // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ch = (window as any).__strChart?.(); const l = ch?.getDataList?.() || []; const b = l[l.length - 1]; return b ? { ts: b.timestamp as number, n: l.length } : null; });
      const ageH = last ? Math.round((Date.now() - last.ts) / 360_000) / 10 : null;
      const now = new Date(); const nyMin = ((now.getUTCHours() * 60 + now.getUTCMinutes()) - 5 * 60 + 1440) % 1440; const wd = now.getUTCDay();
      const usOpen = wd >= 1 && wd <= 5 && nyMin >= 9 * 60 + 30 && nyMin < 16 * 60;
      console.log(`[STR] ${coin} ${tf} @${width}: chart holds ${bars} candles, newest candle ${ageH == null ? 'n/a' : ageH + ' h old'}, run at ${now.toISOString()} (US cash session by EST arithmetic: ${usOpen ? 'open' : 'closed'}; holidays and DST not modelled here)`);
      /* the Liq clusters layer chip and any one-line note under the chips (the 1000x / mixed-unit coins turn the layer off and say so) */
      const liq = await page.evaluate(() => {
        const panel = document.querySelector('.strat-panel') as HTMLElement | null;
        const btn = Array.from(document.querySelectorAll('.strat-panel button')).find((b) => /liq/i.test((b as HTMLElement).innerText || '')) as HTMLButtonElement | undefined;
        const lines = (panel?.innerText || '').split('\n').map((l) => l.trim()).filter((l) => /liq|unit|mixed|per 1000|1000/i.test(l) && l.length < 200);
        return { chip: btn ? `disabled=${btn.disabled} pressed=${btn.getAttribute('aria-pressed')} aria-disabled=${btn.getAttribute('aria-disabled')} title="${(btn.title || '').slice(0, 100)}"` : 'no chip', lines: lines.slice(0, 6) };
      });
      console.log(`[STR] ${coin} ${tf} @${width}: LIQ-LAYER ${liq.chip} lines=${JSON.stringify(liq.lines)}`);
      await page.waitForTimeout(500);
      for (const sid of STRATS) {
        const cellT0 = Date.now();
        try {
          const opt = await page.evaluate((id) => { const o = document.querySelector(`[data-testid="strategy-set-select"] option[value="${id}"]`) as HTMLOptionElement | null; return o ? { disabled: o.disabled, title: o.title } : null; }, sid);
          if (!opt) { console.log(`[STR] ${coin} ${tf} ${sid}: drawings=n/a method=menu verdict=missing reason=the strategy is not in the menu | status=FAIL width=${width}`); fails.push(`${coin} ${tf} ${sid} @${width}: not in the menu`); rows.push(`${sid}:FAIL`); continue; }
          if (opt.disabled) {
            console.log(`[STR] ${coin} ${tf} ${sid}: drawings=0 method=menu verdict=greyed-out reason=${opt.title || '(no tooltip)'} | status=${opt.title ? 'EXPLAINED' : 'FAIL'} width=${width} (menu option disabled; tooltip is the stated reason)`);
            rows.push(`${sid}:${opt.title ? 'EXPLAINED' : 'FAIL'}`); if (!opt.title) fails.push(`${coin} ${tf} ${sid} @${width}: option disabled without a stated reason`);
            seededTodo.push(sid); continue;
          }
          let px = { noise: 0, diff: 0 }; let idleTotal = 0;
          if (sp.px) {
            await sel.selectOption('auto', { timeout: 20_000 }); await page.waitForTimeout(1_800);
            await page.evaluate(() => { /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ (window as any).__strSnap('base1'); }); await page.waitForTimeout(700);
            await page.evaluate(() => { /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ (window as any).__strSnap('base2'); });
            idleTotal = (await readOverlays(page)).total;
          }
          await page.evaluate(() => { (window as unknown as { __strEdge?: Set<string> }).__strEdge = new Set(); });
          await sel.selectOption(sid, { timeout: 20_000 });
          let panel: Panel;
          if (sp.mode === 'core') panel = await settlePanel(page, sid);
          else { panel = await readPanel(page); const t1 = Date.now(); while ((panel.state === 'loading' || panel.state === 'empty' || panel.state === 'no-box' || panel.strategy !== sid) && Date.now() - t1 < 30_000) { await page.waitForTimeout(300); panel = await readPanel(page); } await page.waitForTimeout(1_500); panel = await readPanel(page); }
          const ov = await readOverlays(page);
          if (sp.px) px = await page.evaluate(() => { // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any; w.__strSnap('now'); return { noise: w.__strDiff('base1', 'base2') as number, diff: w.__strDiff('base2', 'now') as number }; });
          const pixelsDrew = sp.px && px.diff > Math.max(150, px.noise * 2 + 100);
          const method = ov.instance ? (sp.px ? 'instance+pixels' : 'instance') : 'pixels';
          const drawings = ov.instance ? ov.total : (pixelsDrew ? 1 : 0);
          const explained = panel.state === 'cant-run' || panel.state === 'tf-unavailable';
          const verdict = panel.state === 'verdict' ? panel.verdict : panel.state === 'cant-run' ? 'WAIT(cannot run)' : panel.state === 'tf-unavailable' ? 'unavailable(tf)' : panel.state === 'read-failed' ? 'read-failed' : panel.state.toUpperCase();
          const reason = panel.state === 'verdict' ? panel.reason : panel.cantRun || panel.errorText || panel.box;
          let status: string;
          const inView = ov.instance ? ov.inView : (pixelsDrew ? 1 : 0), inViewNow = ov.instance ? ov.inViewNow : inView;
          const needsData = panel.state === 'verdict' && panel.verdict === 'WAIT' && /^needs /i.test(panel.reason);
          const edge = await page.evaluate(() => Array.from((window as unknown as { __strEdge?: Set<string> }).__strEdge ?? []).slice(0, 4));
          if (inViewNow > 0 || edge.length > 0) status = 'PASS'; else if (inView > 0) status = 'WEAK'; else if ((explained || needsData) && ov.total === 0) status = needsData ? 'EXPLAINED-NEEDS-DATA' : 'EXPLAINED'; else status = 'FAIL';
          console.log(`[STR] ${coin} ${tf} ${sid}: drawings=${drawings} method=${method} verdict=${verdict} reason=${reason.slice(0, 200)} | status=${status} width=${width} inView=${inView} inViewCurrent=${inViewNow} edgeHints=${JSON.stringify(edge)} kinds=${JSON.stringify(ov.kinds)}${sp.px ? ` idleOverlays=${idleTotal} pixelsDiff=${px.diff} noise=${px.noise}` : ''} liqWord=${/liquid/i.test(reason) ? "YES" : "no"} watching="${panel.watching.slice(0, 140)}"${panel.marketClosed ? ` marketNote="${panel.marketClosed}"` : ''} pane=${ov.pane} bars=${ov.bars} cellMs=${Date.now() - cellT0}`);
          rows.push(`${sid}:${status}`);
          if (sp.mode === 'core') await shoot(page, `str-${coin}-${tf}-${sid}-${width}`, width);
          if (status === 'FAIL') fails.push(`${coin} ${tf} ${sid} @${width}: no drawing in view (overlays ${ov.total}, in view ${inView}, panel ${panel.state}: ${reason.slice(0, 80)})`);
        } catch (e) {
          console.log(`[STR] ${coin} ${tf} ${sid}: drawings=n/a method=none verdict=ERROR reason=${String(e).slice(0, 160)} | status=FAIL width=${width}`);
          fails.push(`${coin} ${tf} ${sid} @${width}: harness error ${String(e).slice(0, 100)}`); rows.push(`${sid}:FAIL`);
        }
      }
      console.log(`[STR] SUMMARY ${coin} ${tf} @${width}: ${rows.join(' ')} · page errors ${crashes.length}${crashes.length ? ' ' + JSON.stringify(crashes.slice(0, 3)) : ''} · derivatives data calls ${JSON.stringify(net)}`);
      /* the greyed-out strategies, the other way: SAVED as the user's pick, the call box must say why and the chart must hold no stale drawing (1280 only; the breadth sweep reads the menu only) */
      if (width >= 1000 && sp.mode === 'core') for (const sid of seededTodo) {
        const s = await openArena(browser, coin, tf, width, sid);
        try {
          const sel2 = s.page.getByTestId('strategy-set-select').first(); await sel2.waitFor({ state: 'visible', timeout: 60_000 }); await expect(sel2).toBeEnabled({ timeout: 90_000 });
          await s.page.waitForTimeout(3_000); await installProbe(s.page);
          const panel = await settlePanel(s.page, sid); const ov = await readOverlays(s.page);
          const ok = panel.state === 'cant-run' && panel.cantRun.length > 5 && ov.inViewNow === 0;
          console.log(`[STR] ${coin} ${tf} ${sid}: SAVED-PICK drawings=${ov.total} method=${ov.instance ? 'instance' : 'none'} verdict=${panel.state === 'cant-run' ? 'WAIT(cannot run)' : panel.state === 'verdict' ? panel.verdict : panel.state.toUpperCase()} reason=${(panel.cantRun || panel.reason || panel.errorText || panel.box).slice(0, 200)} | status=${ok ? 'EXPLAINED' : 'FAIL'} width=${width} callBoxStrategy=${panel.strategy}`);
          if (!ok) fails.push(`${coin} ${tf} ${sid} @${width}: saved pick of a strategy that cannot run does not say why (panel ${panel.state}, overlays ${ov.total})`);
        } catch (e) { console.log(`[STR] ${coin} ${tf} ${sid}: SAVED-PICK ERROR ${String(e).slice(0, 160)} | status=FAIL`); fails.push(`${coin} ${tf} ${sid} @${width}: saved-pick harness error`); } finally { await s.ctx.close().catch(() => {}); }
      }
      for (const f of fails) expect.soft(false, f).toBe(true);
      expect(crashes.filter((c) => c === 'PAGE CRASH'), 'the page crashed').toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}
