/* ARENA INDICATOR HELPERS (draw + value cells). Shared by ind-*.spec.ts. Test-side only: reads the klinecharts instance through React's fiber (the app exposes no handle),
 * never edits app code. Oracles are written here from the textbook definitions and never import the app's own implementation.
 *   attachChart   finds the chart instance (the useRef whose .current has getDataList + getIndicators) and parks it on window.__qaChart
 *   readChart     candles + every indicator's calculated result + every overlay's points, as the chart holds them
 *   pixel cells   composite all chart canvases into one bitmap; the indicator is hidden through the chart API for the baseline, shown for the "on" shot; the oracle value is mapped to
 *                 a pixel with the chart's own axis, and the cell asks whether ink that was not in the baseline is at that pixel (control: the same test 14 px off the line) */
import type { Browser, Page, BrowserContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

mkdirSync('qa/.shots', { recursive: true });

export type Bar = { ts: number; o: number; h: number; l: number; c: number; v: number };
export type KlineHit = { url: string; status: number; source: string; bars: Bar[] };

/* Matrix coins. spot = the Binance SPOT symbol used as an independent price source (null when the coin has no spot market); mult = chart price / spot price. */
export const COIN_INFO: Record<string, { label: string; spot: string | null; mult: number; fut: string; bybit: string }> = {
  btc: { label: 'BTC', spot: 'BTCUSDT', mult: 1, fut: 'BTCUSDT', bybit: 'BTCUSDT' },
  eth: { label: 'ETH', spot: 'ETHUSDT', mult: 1, fut: 'ETHUSDT', bybit: 'ETHUSDT' },
  sol: { label: 'SOL', spot: 'SOLUSDT', mult: 1, fut: 'SOLUSDT', bybit: 'SOLUSDT' },
  pepe: { label: '1000PEPE', spot: 'PEPEUSDT', mult: 1000, fut: '1000PEPEUSDT', bybit: '1000PEPEUSDT' },
  link: { label: 'LINK', spot: 'LINKUSDT', mult: 1, fut: 'LINKUSDT', bybit: 'LINKUSDT' },
  aapl: { label: 'AAPL', spot: null, mult: 1, fut: 'AAPLUSDT', bybit: 'AAPLUSDT' },
};

export function parseKlines(url: string, body: unknown): Bar[] {
  const out: Bar[] = [];
  const b = body as { result?: { list?: string[][] } } | string[][] | null;
  if (Array.isArray(b)) for (const k of b) out.push({ ts: Number(k[0]), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) });
  else if (b && b.result && Array.isArray(b.result.list)) for (const k of [...b.result.list].reverse()) out.push({ ts: Number(k[0]), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) });
  void url;
  return out.filter((x) => Number.isFinite(x.ts) && Number.isFinite(x.c)).sort((a, b2) => a.ts - b2.ts);
}

export type OpenOpts = { coin: string; tf: string; width: number; height: number; chips?: string[]; theme?: 'dark' | 'light' };
export type Opened = { ctx: BrowserContext; page: Page; klines: KlineHit[]; attach: string };

export async function openArena(browser: Browser, o: OpenOpts): Promise<Opened> {
  const ctx = await signedInContext(browser, 'a', { viewport: { width: o.width, height: o.height } });
  await ctx.addInitScript(([theme]) => {
    try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('theme', theme as string); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ }
    /* every string the chart paints, newest last: the indicator legends are canvas text, not DOM */
    const w = window as unknown as { __ft: Array<[number, string]> }; w.__ft = [];
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, mw?: number) {
      try { w.__ft.push([Date.now(), String(text)]); if (w.__ft.length > 6000) w.__ft.splice(0, 3000); } catch { /* ignore */ }
      return mw === undefined ? orig.call(this, text, x, y) : orig.call(this, text, x, y, mw);
    };
  }, [o.theme ?? 'dark']);
  const page = await ctx.newPage(); await installPaidAiFence(page);
  const klines: KlineHit[] = [];
  page.on('response', async (r) => {
    const u = r.url(); if (!/\/api\/market\/klines/.test(u)) return;
    try { const body = await r.json(); klines.push({ url: u, status: r.status(), source: new URL(u).searchParams.get('source') ?? '', bars: parseKlines(u, body) }); } catch { /* not json */ }
  });
  await page.route(/\/api\/settings(\?|$)/, async (route) => (route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: ['arena_strategy', 'strategy_selection'], rejected: [], settings: null }) })));
  const patch: Record<string, unknown> = { arena_sound: false, strategy_selection: o.chips ?? [], arena_strategy: null, strategy_params: null };
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' });
    const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res });
    const p = (r: Record<string, unknown>) => ({ ...r, ...patch }); return route.fulfill({ response: res, json: Array.isArray(body) ? body.map(p) : p(body as Record<string, unknown>) });
  });
  await gotoSignedIn(page, `/arena?coin=${o.coin}&tf=${o.tf}`);
  await page.waitForSelector('.klc-canvas canvas', { timeout: 90_000 });
  let attach = 'none'; const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    attach = await attachChart(page);
    if (attach === 'ok') { const n = await page.evaluate(() => (window as unknown as { __qaChart: { getDataList: () => unknown[] } }).__qaChart.getDataList().length); if (n >= 150) break; }
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(4000);
  return { ctx, page, klines, attach };
}

export function attachChart(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { __qaChart?: unknown };
    const el = document.querySelector('.klc-canvas') as (HTMLElement & Record<string, unknown>) | null; if (!el) return 'no .klc-canvas';
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$')); if (!key) return 'no react fiber key on .klc-canvas';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let f: any = el[key]; let hops = 0;
    while (f && hops < 120) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let h: any = f.memoizedState; let n = 0;
      while (h && n < 300) {
        const v = h.memoizedState;
        if (v && typeof v === 'object' && v.current && typeof v.current.getDataList === 'function' && typeof v.current.getIndicators === 'function' && typeof v.current.convertToPixel === 'function') { w.__qaChart = v.current; return 'ok'; }
        h = h.next; n++;
      }
      f = f.return; hops++;
    }
    return 'chart ref not found in the fiber chain';
  });
}

export type ChartState = {
  n: number; ts: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[];
  vr: { from: number; to: number };
  panes: Record<string, { top: number; left: number; height: number; width: number } | null>;
  inds: Array<{ id: string; name: string; paneId: string; calcParams: number[]; visible: boolean; offset: number; result: Array<Record<string, number | undefined>> }>;
  ovs: Array<{ id: string; name: string; visible: boolean; points: Array<{ timestamp?: number; value?: number }>; ext: Record<string, unknown> }>;
};

export function readChart(page: Page, tail = 450): Promise<ChartState> {
  return page.evaluate((tail) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ch = (window as any).__qaChart; const dl = ch.getDataList() as Array<Record<string, number>>; const vr = ch.getVisibleRange();
    const panes: Record<string, unknown> = {}; const inds = (ch.getIndicators() as Array<Record<string, unknown>>);
    const ids = new Set<string>(['candle_pane', 'vol_pane', 'rsi_pane']); for (const i of inds) ids.add(String(i.paneId));
    for (const id of ids) { const b = ch.getSize(id, 'root'); panes[id] = b ? { top: b.top, left: b.left, height: b.height, width: b.width } : null; }
    return {
      n: dl.length, ts: dl.map((d) => d.timestamp), o: dl.map((d) => d.open), h: dl.map((d) => d.high), l: dl.map((d) => d.low), c: dl.map((d) => d.close), v: dl.map((d) => d.volume ?? 0),
      vr: { from: vr.from, to: vr.to }, panes,
      inds: inds.map((i) => { const r = (i.result as Array<Record<string, number>>) ?? []; const off = Math.max(0, r.length - tail); return { id: String(i.id), name: String(i.name), paneId: String(i.paneId), calcParams: (i.calcParams as number[]) ?? [], visible: i.visible !== false, offset: off, result: r.slice(off) }; }),
      ovs: (ch.getOverlays() as Array<Record<string, unknown>>).map((o2) => ({ id: String(o2.id), name: String(o2.name), visible: o2.visible !== false, points: ((o2.points as Array<Record<string, number>>) ?? []).map((p) => ({ timestamp: p.timestamp, value: p.value })), ext: (typeof o2.extendData === 'object' && o2.extendData) ? JSON.parse(JSON.stringify(o2.extendData)) : {} })),
    };
  }, tail) as Promise<ChartState>;
}

/** Hide / show an indicator or every overlay of a name through the chart API (the baseline for the pixel diff). */
export function setVisible(page: Page, kind: 'ind' | 'ov', key: string, visible: boolean): Promise<number> {
  return page.evaluate(([kind2, key2, vis]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ch = (window as any).__qaChart; let n = 0;
    if (kind2 === 'ind') for (const i of ch.getIndicators({ name: key2 })) { ch.overrideIndicator({ id: i.id, name: i.name, visible: vis }); n++; }
    else for (const o of ch.getOverlays({ name: key2 })) { ch.overrideOverlay({ id: o.id, visible: vis }); n++; }
    return n;
  }, [kind, key, visible] as [string, string, boolean]);
}

export function snap(page: Page, name: string): Promise<{ w: number; h: number }> {
  return page.evaluate((nm) => {
    const w = window as unknown as { __snaps?: Record<string, ImageData> }; w.__snaps = w.__snaps ?? {};
    const cont = document.querySelector('.klc-canvas') as HTMLElement; const cr = cont.getBoundingClientRect(); const W = Math.round(cr.width), H = Math.round(cr.height);
    const off = document.createElement('canvas'); off.width = W; off.height = H; const g = off.getContext('2d', { willReadFrequently: true })!; g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    for (const c of Array.from(cont.querySelectorAll('canvas'))) { const r = c.getBoundingClientRect(); try { g.drawImage(c, r.left - cr.left, r.top - cr.top, r.width, r.height); } catch { /* tainted */ } }
    w.__snaps[nm] = g.getImageData(0, 0, W, H); return { w: W, h: H };
  }, name);
}

export type DrawArgs = { paneId: string; base: string; cur: string; pts: Array<{ ts: number; value: number }>; r: number; thr?: number; ctrl?: number };
export type DrawRes = { n: number; hit: number; ctrlN: number; ctrlHit: number; offscreen: number; paneChanged: number; paneTotal: number; err?: string };

/** For each (timestamp, value): map to a pixel with the pane's own axis; hit = the pixel neighbourhood differs between the baseline and the on-shot AND is not the pane background. */
export function drawCheck(page: Page, a: DrawArgs): Promise<DrawRes> {
  return page.evaluate((args) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ch = (window as any).__qaChart; const w = window as unknown as { __snaps: Record<string, ImageData> };
    const B = w.__snaps[args.base], C = w.__snaps[args.cur]; if (!B || !C) return { n: 0, hit: 0, ctrlN: 0, ctrlHit: 0, offscreen: 0, paneChanged: 0, paneTotal: 0, err: 'missing snapshot' };
    const root = ch.getSize(args.paneId, 'root'); const main = ch.getSize(args.paneId, 'main'); if (!root || !main) return { n: 0, hit: 0, ctrlN: 0, ctrlHit: 0, offscreen: 0, paneChanged: 0, paneTotal: 0, err: 'no pane ' + args.paneId };
    const Wd = C.width, Hd = C.height; const thr = args.thr ?? 60;
    const px = (img: ImageData, x: number, y: number) => { const i = (y * Wd + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
    // background of the pane = its most common colour in the on-shot
    const cnt = new Map<string, number>(); const y0 = Math.max(0, Math.floor(root.top)), y1 = Math.min(Hd, Math.floor(root.top + root.height));
    for (let y = y0; y < y1; y += 3) for (let x = 0; x < Wd; x += 3) { const p = px(C, x, y); const k = p.join(','); cnt.set(k, (cnt.get(k) ?? 0) + 1); }
    let bgK = ''; let bgN = -1; for (const [k, v] of cnt) if (v > bgN) { bgN = v; bgK = k; } const bg = bgK.split(',').map(Number);
    const d3 = (p: number[], q: number[]) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
    const test = (x: number, y: number) => { for (let dy = -args.r; dy <= args.r; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = Math.round(x) + dx, yy = Math.round(y) + dy; if (xx < 0 || yy < 0 || xx >= Wd || yy >= Hd) continue; const pc = px(C, xx, yy); if (d3(pc, px(B, xx, yy)) > thr && d3(pc, bg) > thr) return true; } return false; };
    let n = 0, hit = 0, ctrlN = 0, ctrlHit = 0, off = 0; const auto = Math.max(5, Math.min(14, Math.round(root.height * 0.22))); const dy = args.ctrl ?? auto;
    for (const p of args.pts) {
      const c = ch.convertToPixel({ timestamp: p.ts, value: p.value }, { paneId: args.paneId, absolute: true }) as { x?: number; y?: number };
      if (c.x == null || c.y == null || !isFinite(c.x) || !isFinite(c.y)) { off++; continue; }
      const x = c.x + main.left, y = c.y; if (y < root.top + 2 || y > root.top + root.height - 2 || x < 0 || x > Wd - 2) { off++; continue; }
      n++; if (test(x, y)) hit++;
      const yc = args.ctrl != null ? y + dy : (y + dy < root.top + root.height - 2 ? y + dy : y - dy); if (yc > root.top + 2 && yc < root.top + root.height - 2) { ctrlN++; if (test(x, yc)) ctrlHit++; }
    }
    let changed = 0, total = 0; for (let y = y0; y < y1; y += 2) for (let x = 0; x < Wd; x += 2) { total++; if (d3(px(C, x, y), px(B, x, y)) > thr) changed++; }
    return { n, hit, ctrlN, ctrlHit, offscreen: off, paneChanged: changed, paneTotal: total };
  }, a) as Promise<DrawRes>;
}

/* ---------------------------------------------------------------- oracles (textbook, written here) ---------------------------------------------------------------- */
export type Series = Array<number | undefined>;
export const rollMean = (c: number[], n: number): Series => c.map((_, i) => (i < n - 1 ? undefined : c.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
/** EMA seeded with the SMA of the first n closes (the TradingView / textbook convention), alpha = 2/(n+1). */
export function emaSeed(c: number[], n: number): Series {
  const out: Series = new Array(c.length).fill(undefined); if (c.length < n) return out; let e = c.slice(0, n).reduce((a, b) => a + b, 0) / n; out[n - 1] = e;
  for (let i = n; i < c.length; i++) { e = (c[i] * 2) / (n + 1) + (e * (n - 1)) / (n + 1); out[i] = e; } return out;
}
/** The recursive SMA(N, M) that klinecharts calls "SMA": s = (M * close + (N - M + 1) * s_prev) / (N + 1); first value is the mean of the first N. */
export function smaNM(c: number[], n: number, m: number): Series {
  const out: Series = new Array(c.length).fill(undefined); if (c.length < n) return out; let s = c.slice(0, n).reduce((a, b) => a + b, 0) / n; out[n - 1] = s;
  for (let i = n; i < c.length; i++) { s = (c[i] * m + s * (n - m + 1)) / (n + 1); out[i] = s; } return out;
}
export function rsiWilder(c: number[], n: number): Series {
  const out: Series = new Array(c.length).fill(undefined); if (c.length <= n) return out; let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; g += Math.max(d, 0); l += Math.max(-d, 0); } g /= n; l /= n; out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; out[i] = l === 0 ? 100 : g === 0 ? 0 : 100 - 100 / (1 + g / l); }
  return out;
}
export function macdText(c: number[], f: number, s: number, g: number): { dif: Series; dea: Series; hist: Series } {
  const ef = emaSeed(c, f), es = emaSeed(c, s); const dif: Series = c.map((_, i) => (ef[i] != null && es[i] != null ? (ef[i] as number) - (es[i] as number) : undefined));
  const first = dif.findIndex((x) => x != null); const dea: Series = new Array(c.length).fill(undefined); const hist: Series = new Array(c.length).fill(undefined);
  if (first >= 0 && c.length >= first + g) { let e = (dif.slice(first, first + g) as number[]).reduce((a, b) => a + b, 0) / g; dea[first + g - 1] = e; for (let i = first + g; i < c.length; i++) { e = ((dif[i] as number) * 2) / (g + 1) + (e * (g - 1)) / (g + 1); dea[i] = e; } }
  for (let i = 0; i < c.length; i++) if (dif[i] != null && dea[i] != null) hist[i] = (dif[i] as number) - (dea[i] as number);
  return { dif, dea, hist };
}
export function bollText(c: number[], n: number, k: number): { mid: Series; up: Series; dn: Series } {
  const mid = rollMean(c, n); const up: Series = [], dn: Series = [];
  c.forEach((_, i) => { if (mid[i] == null) { up.push(undefined); dn.push(undefined); return; } const m = mid[i] as number; const sd = Math.sqrt(c.slice(i - n + 1, i + 1).reduce((a, b) => a + (b - m) * (b - m), 0) / n); up.push(m + k * sd); dn.push(m - k * sd); });
  return { mid, up, dn };
}
/** Wilder's Parabolic SAR. */
export function sarWilder(h: number[], l: number[], cl: number[], start: number, step: number, max: number): Series {
  const out: Series = new Array(h.length).fill(undefined); if (h.length < 3) return out;
  let up = cl[1] >= cl[0]; let sar = up ? l[0] : h[0]; let ep = up ? h[0] : l[0]; let af = start; out[0] = sar;
  for (let i = 1; i < h.length; i++) {
    sar = sar + af * (ep - sar);
    if (up) {
      if (i >= 2) sar = Math.min(sar, l[i - 1], l[i - 2]); else sar = Math.min(sar, l[i - 1]);
      if (l[i] < sar) { up = false; sar = ep; ep = l[i]; af = start; } else if (h[i] > ep) { ep = h[i]; af = Math.min(af + step, max); }
    } else {
      if (i >= 2) sar = Math.max(sar, h[i - 1], h[i - 2]); else sar = Math.max(sar, h[i - 1]);
      if (h[i] > sar) { up = true; sar = ep; ep = h[i]; af = start; } else if (l[i] < ep) { ep = l[i]; af = Math.min(af + step, max); }
    }
    out[i] = sar;
  }
  return out;
}
/** The app's documented S/R rule (lib/srLevels.ts header): swing highs/lows 3 bars each side over the last 200 bars, clustered within 0.3 %, the 3 most-touched on each side of the price. */
export function srOracle(h: number[], l: number[], price: number): Array<{ price: number; type: 'support' | 'resistance'; touches: number }> {
  const H = h.slice(-200), L = l.slice(-200); const sh: number[] = [], sl: number[] = [];
  for (let i = 3; i < H.length - 3; i++) {
    let isH = true, isL = true; for (let k = 1; k <= 3; k++) { if (H[i - k] > H[i] || H[i + k] > H[i]) isH = false; if (L[i - k] < L[i] || L[i + k] < L[i]) isL = false; }
    if (isH) sh.push(H[i]); if (isL) sl.push(L[i]);
  }
  const cluster = (ps: number[]) => { const cs: Array<{ price: number; count: number }> = []; for (const p of [...ps].sort((a, b) => a - b)) { const ex = cs.find((c) => Math.abs(c.price - p) / p < 0.003); if (ex) { ex.price = (ex.price * ex.count + p) / (ex.count + 1); ex.count++; } else cs.push({ price: p, count: 1 }); } return cs.sort((a, b) => b.count - a.count); };
  return [
    ...cluster(sh).filter((c) => c.price > price * 0.999).slice(0, 3).map((c) => ({ price: c.price, type: 'resistance' as const, touches: c.count })),
    ...cluster(sl).filter((c) => c.price < price * 1.001).slice(0, 3).map((c) => ({ price: c.price, type: 'support' as const, touches: c.count })),
  ];
}

export type Cmp = { n: number; maxRel: number; lastApp: number | null; lastOracle: number | null; lastRel: number | null; within: number };
/** Compare two series over the last `win` closed bars (the live last two are skipped): relative error against `scale(i)`. */
export function cmpSeries(app: Series, ora: Series, scale: (i: number) => number, win = 300, tol = 1e-6): Cmp {
  let n = 0, mx = 0, ok = 0; let lastApp: number | null = null, lastOra: number | null = null, lastRel: number | null = null;
  const end = Math.min(app.length, ora.length) - 2;
  for (let i = Math.max(0, end - win); i < end; i++) {
    const a = app[i], b = ora[i]; if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    const rel = Math.abs(a - b) / Math.max(scale(i), 1e-12); n++; if (rel > mx) mx = rel; if (rel <= tol) ok++; lastApp = a; lastOra = b; lastRel = rel;
  }
  return { n, maxRel: mx, lastApp, lastOracle: lastOra, lastRel, within: n ? ok / n : 0 };
}
/** A chart indicator's per-bar result aligned to the full data-list index. */
export function figureSeries(ind: ChartState['inds'][number], key: string, n: number): Series {
  const out: Series = new Array(n).fill(undefined); ind.result.forEach((r, j) => { const v = r?.[key]; if (typeof v === 'number') out[ind.offset + j] = v; }); return out;
}
/** Pick up to `k` evenly spaced data indexes inside the visible window, away from the live edge. */
export function sampleIdx(vr: { from: number; to: number }, n: number, k = 24): number[] {
  const lo = Math.max(1, Math.ceil(vr.from) + 1), hi = Math.min(n - 4, Math.floor(vr.to) - 2); if (hi <= lo) return []; const step = Math.max(1, Math.floor((hi - lo) / k)); const o: number[] = []; for (let i = lo; i <= hi; i += step) o.push(i); return o;
}
export const fmt = (x: number | null | undefined, d = 6) => (x == null || !Number.isFinite(x) ? 'n/a' : Math.abs(x) >= 1000 ? x.toFixed(2) : x.toPrecision(d));

/** Move the crosshair to data index `i`, return the legend tokens the chart painted (key -> last value text). */
export async function legendAt(page: Page, st: ChartState, i: number): Promise<Record<string, string>> {
  const pos = await page.evaluate(([ts]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ch = (window as any).__qaChart; const c = ch.convertToPixel({ timestamp: ts }, { paneId: 'candle_pane', absolute: true }) as { x?: number }; const main = ch.getSize('candle_pane', 'main'); const root = ch.getSize('candle_pane', 'root');
    const cr = (document.querySelector('.klc-canvas') as HTMLElement).getBoundingClientRect(); if (c.x == null) return null; return { x: cr.left + c.x + main.left, y: cr.top + root.top + root.height * 0.5 };
  }, [st.ts[i]] as [number]);
  if (!pos) return {};
  await page.evaluate(() => { (window as unknown as { __ft: unknown[] }).__ft.length = 0; });
  await page.mouse.move(pos.x - 8, pos.y); await page.mouse.move(pos.x, pos.y, { steps: 3 }); await page.waitForTimeout(700);
  const toks = await page.evaluate(() => (window as unknown as { __ft: Array<[number, string]> }).__ft.map((t) => t[1]));
  const out: Record<string, string> = {};
  for (let j = 0; j < toks.length - 1; j++) { const m = /^\s*([A-Za-z][A-Za-z0-9 ]{0,12}):\s*$/.exec(toks[j]); if (m) out[m[1].trim()] = toks[j + 1].trim(); }
  return out;
}
/** Parse a legend number ("12,345.67", "1.23K", "0.0029") into {value, tol}: tol = half a unit of the last printed digit (relative 0.6 % when abbreviated). */
export function parseLegend(s: string | undefined): { v: number; tol: number } | null {
  if (!s) return null; const m = /^(-?[\d,]*\.?\d+)\s*([KMB])?$/i.exec(s.replace(/\s/g, '')); if (!m) return null; const raw = m[1].replace(/,/g, ''); const dec = (raw.split('.')[1] ?? '').length; let v = Number(raw);
  if (m[2]) { const mul = { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase() as 'K' | 'M' | 'B']; v *= mul; return { v, tol: Math.abs(v) * 0.006 + 1e-9 }; }
  return { v, tol: 0.5 * Math.pow(10, -dec) * 1.01 + 1e-12 };
}
