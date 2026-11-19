/* One ARENA INDICATOR CELL: (coin, timeframe, viewport) -> a row per indicator with DRAWN (pixel oracle) and VALUE (independent oracle) verdicts. Used by ind-*.spec.ts.
 * Rows are printed as `[INDJ] {json}` (machine) and `[IND] <coin> <tf> <indicator>: drawn=<bool> value app=<x> oracle=<y> diff=<d>` (human). */
import type { Browser, Page } from '@playwright/test';
import { openArena, readChart, setVisible, snap, drawCheck, sampleIdx, figureSeries, cmpSeries, fmt, legendAt, parseLegend, rollMean, emaSeed, smaNM, rsiWilder, macdText, bollText, sarWilder, srOracle, parseKlines, COIN_INFO, type ChartState, type Series, type Bar, type KlineHit, type DrawRes } from './_ind';

export type Row = { coin: string; tf: string; w: number; ind: string; verdict: 'PASS' | 'FAIL' | 'NOT RUN' | 'NO DATA'; drawn: boolean | null; draw: string; valueOk: boolean | null; app: string; oracle: string; diff: string; legend: string; note: string; known?: string };
const TOL = 1e-6;
const BYBIT_IV: Record<string, string> = { '15m': '15', '1h': '60', '4h': '240', '1d': 'D' };

function mk(coin: string, tf: string, w: number, ind: string): Row { return { coin, tf, w, ind, verdict: 'NOT RUN', drawn: null, draw: '', valueOk: null, app: '', oracle: '', diff: '', legend: '', note: '' }; }
const drawTxt = (rs: DrawRes[]) => rs.map((r) => `${r.hit}/${r.n} (ctrl ${r.ctrlHit}/${r.ctrlN}, off ${r.offscreen}, pane ${r.paneChanged}/${r.paneTotal})`).join(' | ');
/** drawn = on every figure the ink is at the oracle pixel in at least 80 % of the sampled bars AND the control 14 px off the line is inked in at most 30 % */
const isDrawn = (rs: DrawRes[], minN = 6) => rs.length > 0 && rs.every((r) => !r.err && r.n >= minN && r.hit >= 0.8 * r.n && (r.ctrlN === 0 || r.ctrlHit / r.ctrlN <= Math.min(0.6, r.hit / r.n - 0.4)));

async function drawSeries(page: Page, st: ChartState, paneId: string, base: string, cur: string, series: Series[], r: number, idx?: number[], ctrl?: number): Promise<DrawRes[]> {
  const ix = idx ?? sampleIdx(st.vr, st.n); const out: DrawRes[] = [];
  for (const s of series) out.push(await drawCheck(page, { paneId, base, cur, pts: ix.filter((i) => s[i] != null).map((i) => ({ ts: st.ts[i], value: s[i] as number })), r, ctrl }));
  return out;
}
async function hideShot(page: Page, kind: 'ind' | 'ov', key: string, tag: string) {
  await snap(page, `c_${tag}`); const n = await setVisible(page, kind, key, false); await page.waitForTimeout(700); await snap(page, `b_${tag}`); await setVisible(page, kind, key, true); await page.waitForTimeout(500); return n;
}
const scaleClose = (st: ChartState) => (i: number) => Math.abs(st.c[i]) || 1;
const legendCmp = (leg: Record<string, string>, key: string, oracle: number | undefined): { txt: string; ok: boolean | null } => {
  const p = parseLegend(leg[key]); if (!p || oracle == null) return { txt: `${key}=${leg[key] ?? 'n/a'}`, ok: null };
  const ok = Math.abs(p.v - oracle) <= p.tol + Math.abs(oracle) * 1e-9; return { txt: `${key} legend ${leg[key]} vs oracle ${fmt(oracle)} ${ok ? 'ok' : 'MISMATCH'}`, ok };
};

export async function runCell(browser: Browser, coin: string, tf: string, width: number, o: { shots?: boolean; checks?: boolean } = {}): Promise<Row[]> {
  const height = width < 500 ? 844 : 900; const rows: Row[] = []; const info = COIN_INFO[coin];
  const { ctx, page, klines, attach } = await openArena(browser, { coin, tf, width, height, chips: [] });
  try {
    if (attach !== 'ok') { const r = mk(coin, tf, width, 'CHART'); r.verdict = 'FAIL'; r.note = `chart handle: ${attach}`; rows.push(r); return rows; }
    let st = await readChart(page);
    const live = st.ts[st.n - 1]; const ageMin = Math.round((Date.now() - live) / 60000);
    const names = st.inds.map((i) => `${i.name}@${i.paneId}`).join(',');
    const ovn = Array.from(new Set(st.ovs.map((x) => x.name))).join(',');
    console.log(`[IND] ${coin} ${tf} ${width}: bars ${st.n}, last bar ${new Date(live).toISOString()} (${ageMin} min old), indicators ${names}, overlays ${ovn}, panes ${JSON.stringify(st.panes)}, visible ${JSON.stringify(st.vr)}`);
    if (st.n < 150) { const r = mk(coin, tf, width, 'DATA'); r.verdict = 'NO DATA'; r.note = `only ${st.n} bars loaded (market closed / no feed?)`; rows.push(r); return rows; }

    /* ---------------- DATA: the candles the chart holds vs the raw server response, and vs an independent venue ---------------- */
    /* THE CHART'S OWN INITIAL HISTORY REQUEST, picked by its URL (other widgets on /arena call the same route for other venues and intervals, and the first probe compared the wrong one):
       bybit: symbol = the coin's Bybit symbol, interval = the timeframe in Bybit's spelling, no `end`; binance: the timeframe in Binance's spelling, limit 1500, no `end`. */
    const own = klines.filter((k) => { if (k.status !== 200 || k.bars.length < 100) return false; const q = new URL(k.url).searchParams; if (q.get('end')) return false; const src = q.get('source'); const sym = q.get('symbol'); const iv = q.get('interval');
      return (src === 'bybit' && sym === info.bybit && iv === BYBIT_IV[tf]) || ((src === 'binance' || src === 'binance-futures') && iv === tf && (sym === info.fut || sym === info.spot)); });
    const hit: KlineHit | undefined = own[own.length - 1];
    { const r = mk(coin, tf, width, 'CANDLES'); r.drawn = null;
      if (!hit) { r.verdict = 'NO DATA'; r.note = `the chart's own history request was not seen (saw ${klines.map((k) => `${k.status}:${new URL(k.url).search.slice(0, 70)}`).join(' ; ') || 'none'})`; }
      else {
        const m = new Map(hit.bars.map((b) => [b.ts, b])); let n = 0, bad = 0, maxd = 0;
        for (let i = Math.max(0, st.n - 300); i < st.n - 2; i++) { const b = m.get(st.ts[i]); if (!b) continue; n++; const d = Math.max(Math.abs(b.o - st.o[i]) / b.o, Math.abs(b.h - st.h[i]) / b.h, Math.abs(b.l - st.l[i]) / b.l, Math.abs(b.c - st.c[i]) / b.c, Math.abs(b.v - st.v[i]) / (b.v || 1)); if (d > 1e-9) bad++; maxd = Math.max(maxd, d); }
        r.app = `${n} bars compared; chart last bar ${ageMin} min old`; r.oracle = `server ${hit.source}`; r.diff = `maxRel ${maxd.toExponential(2)}, ${bad} differ`; r.valueOk = n > 100 && bad === 0;
        /* independent venue: Bybit (the chart's primary source) direct, else Binance spot (x mult), else Binance futures */
        const tries: Array<{ name: string; url: string; mult: number; tol: number }> = [{ name: 'bybit-direct', url: `https://api.bybit.com/v5/market/kline?category=linear&symbol=${info.bybit}&interval=${BYBIT_IV[tf]}&limit=1000`, mult: 1, tol: 1e-9 }];
        if (info.spot) tries.push({ name: 'binance-spot', url: `https://data-api.binance.vision/api/v3/klines?symbol=${info.spot}&interval=${tf}&limit=1000`, mult: info.mult, tol: 0.02 });
        tries.push({ name: 'binance-futures', url: `https://fapi.binance.com/fapi/v1/klines?symbol=${info.fut}&interval=${tf}&limit=1000`, mult: 1, tol: 0.02 });
        const log: string[] = []; let used = '';
        for (const t of tries) {
          try {
            const res = await ctx.request.get(t.url, { timeout: 20_000 }); log.push(`${t.name}:${res.status()}`); if (res.status() !== 200) continue;
            const bars: Bar[] = parseKlines(t.url, await res.json()); if (bars.length < 100) continue; const mm = new Map(bars.map((b) => [b.ts, b])); const diffs: number[] = [];
            for (let i = Math.max(0, st.n - 300); i < st.n - 2; i++) { const b = mm.get(st.ts[i]); if (b) diffs.push(Math.abs(b.c * t.mult - st.c[i]) / st.c[i]); }
            if (diffs.length < 50) { log.push(`${t.name}:overlap ${diffs.length}`); continue; } diffs.sort((a, b2) => a - b2);
            used = `${t.name} closes: ${diffs.length} bars, median rel ${diffs[Math.floor(diffs.length / 2)].toExponential(2)}, max ${diffs[diffs.length - 1].toExponential(2)}`; r.note = used; if (diffs[Math.floor(diffs.length / 2)] > t.tol && t.tol >= 0.01) r.valueOk = false; if (t.name === 'bybit-direct' && diffs[diffs.length - 1] > 1e-9) { /* the chart's own source: any drift is a finding unless it is the forming bar */ r.valueOk = r.valueOk && diffs[diffs.length - 1] < 1e-6; } break;
          } catch (e) { log.push(`${t.name}:${String(e).slice(0, 40)}`); }
        }
        if (!used) r.note = `no independent venue reachable from the runner (${log.join(', ')}); oracle = the raw server response only`; else r.note += ` [${log.join(', ')}]`;
        r.verdict = r.valueOk ? 'PASS' : 'FAIL';
      } rows.push(r); }

    if (o.checks === false) return rows;
    const clickChip = async (id: string) => { const c = page.getByTestId(`strategy-indicator-${id}`).first(); await c.scrollIntoViewIfNeeded({ timeout: 20_000 }); await c.click({ timeout: 30_000 }); };
    const waitInd = async (name: string, want: boolean) => { for (let k = 0; k < 24; k++) { const s2 = await readChart(page, 5); const has = s2.inds.some((i) => i.name === name); if (has === want) return true; await page.waitForTimeout(500); } return false; };
    const away = () => page.mouse.move(2, 2).catch(() => {});
    const calcDone = async (name: string) => { for (let k = 0; k < 20; k++) { const s2 = await readChart(page, 450); const i = s2.inds.find((x) => x.name === name); if (i && i.result.length > 50 && i.result.some((r) => Object.keys(r).length > 0)) return s2; await page.waitForTimeout(500); } return null; };

    /* ---------------- selectable chips: SMA, SAR, MACD, BOLL ---------------- */
    for (const id of ['SMA', 'SAR', 'MACD', 'BOLL']) {
      const r = mk(coin, tf, width, id);
      try {
        if (!(await page.getByTestId(`strategy-indicator-${id}`).count())) { r.note = 'chip not found on the page'; rows.push(r); continue; }
        await clickChip(id); const appeared = await waitInd(id, true); const s2 = await calcDone(id);
        if (!appeared || !s2) { r.verdict = 'FAIL'; r.drawn = false; r.note = `chip clicked but the chart has no ${id} indicator (appeared=${appeared})`; rows.push(r); continue; }
        st = s2; const ind = st.inds.find((x) => x.name === id)!; const cp = ind.calcParams; const c = st.c; const nn = st.n; let draws: DrawRes[] = []; let vals: string[] = []; let valOk = true; const lg: string[] = []; let lgOk: boolean | null = null;
        const ix = sampleIdx(st.vr, nn); const li = nn - 6; const want: Array<[string, number | undefined]> = [];
        const noteLg = (k: string, v: number | undefined) => { want.push([k, v]); };
        if (id === 'SMA') {
          const app = figureSeries(ind, 'sma', nn); const rec = smaNM(c, cp[0], cp[1]); const roll = rollMean(c, cp[0]); const ema = emaSeed(c, cp[0]);
          const a = cmpSeries(app, rec, scaleClose(st), 300, TOL); const t = cmpSeries(app, roll, scaleClose(st), 300, TOL); const e = cmpSeries(app, ema, scaleClose(st), 300, TOL);
          valOk = a.n > 100 && a.maxRel <= TOL; r.app = fmt(a.lastApp); r.oracle = `${fmt(a.lastOracle)} (recursive SMA(${cp[0]},${cp[1]}))`; r.diff = `${(a.maxRel).toExponential(2)} max rel vs the recursive formula; vs TEXTBOOK rolling SMA(${cp[0]}) last ${fmt(t.lastOracle)} diff ${t.lastRel == null ? 'n/a' : (t.lastRel * 100).toFixed(3) + '%'} (max ${(t.maxRel * 100).toFixed(3)}%); vs EMA(${cp[0]}) max rel ${e.maxRel.toExponential(2)}`;
          if (t.maxRel > 1e-6) { r.note = `KNOWN/DOCUMENTED (registry note, #1007): the "SMA" chip draws klinecharts' recursive SMA(N,M), which at the defaults IS EMA(${cp[0]}); it is not a rolling mean. Textbook SMA(${cp[0]}) differs by up to ${(t.maxRel * 100).toFixed(2)}%.`; r.known = 'SMA chip draws EMA(12) (documented, #1007)'; }
          await hideShot(page, 'ind', 'SMA', 'SMA'); draws = await drawSeries(page, st, ind.paneId, 'b_SMA', 'c_SMA', [rec], 2, ix); noteLg('SMA', rec[li]);
        } else if (id === 'BOLL') {
          const b = bollText(c, cp[0], cp[1]); const A = { up: figureSeries(ind, 'up', nn), mid: figureSeries(ind, 'mid', nn), dn: figureSeries(ind, 'dn', nn) };
          const cs = (['up', 'mid', 'dn'] as const).map((k) => ({ k, cmp: cmpSeries(A[k], b[k], scaleClose(st), 300, TOL) })); valOk = cs.every((x) => x.cmp.n > 100 && x.cmp.maxRel <= TOL);
          r.app = cs.map((x) => `${x.k} ${fmt(x.cmp.lastApp)}`).join(' '); r.oracle = cs.map((x) => `${x.k} ${fmt(x.cmp.lastOracle)}`).join(' ') + ` (BOLL(${cp[0]},${cp[1]}), population std)`; r.diff = cs.map((x) => `${x.k} ${x.cmp.maxRel.toExponential(2)}`).join(' ') + ' max rel';
          await hideShot(page, 'ind', 'BOLL', 'BOLL'); draws = await drawSeries(page, st, ind.paneId, 'b_BOLL', 'c_BOLL', [b.up, b.mid, b.dn], 2, ix); noteLg('UP', b.up[li]); noteLg('MID', b.mid[li]); noteLg('DN', b.dn[li]);
        } else if (id === 'SAR') {
          const orc = sarWilder(st.h, st.l, c, cp[0] / 100, cp[1] / 100, cp[2] / 100); const app = figureSeries(ind, 'sar', nn); const m = cmpSeries(app, orc, scaleClose(st), 300, 1e-6); const m2 = cmpSeries(app, orc, scaleClose(st), 300, 2e-3);
          valOk = m.n > 100 && m.within >= 0.95; r.app = fmt(m.lastApp); r.oracle = `${fmt(m.lastOracle)} (Wilder PSAR ${cp[0] / 100}/${cp[1] / 100}/${cp[2] / 100})`; r.diff = `last rel ${m.lastRel == null ? 'n/a' : m.lastRel.toExponential(2)}; ${(m.within * 100).toFixed(1)}% of ${m.n} bars equal (1e-6), ${(m2.within * 100).toFixed(1)}% within 0.2%, max rel ${m.maxRel.toExponential(2)}`;
          await hideShot(page, 'ind', 'SAR', 'SAR'); draws = await drawSeries(page, st, ind.paneId, 'b_SAR', 'c_SAR', [app], 3, ix); noteLg('SAR', app[li]);
          if (!valOk) r.note = "VALUE DEFECT vs the textbook Parabolic SAR (Wilder): klinecharts' SAR takes the CURRENT bar's extreme point and the already-incremented acceleration factor when it computes that bar's SAR (textbook: SAR(i) comes from bar i-1's EP/AF, which are updated afterwards), and it resets AF to 0 on a flip to a down trend but to the start value on a flip to an up trend. The dots sit up to " + (m.maxRel * 100).toFixed(1) + "% off the textbook value; flip bars agree. A reader comparing with TradingView/Bybit sees different dots.";
          /* draw is judged against the CHART's own SAR values for SAR (the question is "is what it computed drawn"); the value verdict is separate */
        } else {
          const mac = macdText(c, cp[0], cp[1], cp[2]); const A = { dif: figureSeries(ind, 'dif', nn), dea: figureSeries(ind, 'dea', nn), macd: figureSeries(ind, 'macd', nn) };
          const hist2: Series = (mac.hist as Series).map((x) => (x == null ? undefined : x * 2));
          const cd = cmpSeries(A.dif, mac.dif, scaleClose(st), 300, TOL), ce = cmpSeries(A.dea, mac.dea, scaleClose(st), 300, TOL), ch1 = cmpSeries(A.macd, mac.hist, scaleClose(st), 300, TOL), ch2 = cmpSeries(A.macd, hist2, scaleClose(st), 300, TOL);
          valOk = cd.n > 100 && cd.maxRel <= TOL && ce.maxRel <= TOL && ch2.maxRel <= TOL; r.app = `dif ${fmt(cd.lastApp)} dea ${fmt(ce.lastApp)} hist ${fmt(ch1.lastApp)}`; r.oracle = `dif ${fmt(cd.lastOracle)} dea ${fmt(ce.lastOracle)} hist ${fmt(ch1.lastOracle)} (MACD(${cp.join(',')}), histogram = DIF-DEA)`; r.diff = `dif ${cd.maxRel.toExponential(2)} dea ${ce.maxRel.toExponential(2)} (max rel to price) ; histogram vs DIF-DEA ${ch1.maxRel.toExponential(2)}, vs 2x(DIF-DEA) ${ch2.maxRel.toExponential(2)}`;
          if (ch1.maxRel > TOL && ch2.maxRel <= TOL) r.note = 'DOCUMENTED CONVENTION: the MACD histogram bar is klinecharts 2x(DIF-DEA) (Chinese convention), not DIF-DEA as on TradingView/most platforms; DIF and DEA match the textbook.';
          await hideShot(page, 'ind', 'MACD', 'MACD'); draws = await drawSeries(page, st, ind.paneId, 'b_MACD', 'c_MACD', [mac.dif, mac.dea], 2, ix); noteLg('DIF', mac.dif[li]); noteLg('DEA', mac.dea[li]);
        }
        const leg = await legendAt(page, st, li); await away(); for (const [k, v] of want) { const x = legendCmp(leg, k, v); lg.push(x.txt); if (x.ok === false) lgOk = false; else if (x.ok === true && lgOk !== false) lgOk = true; }
        r.draw = drawTxt(draws); r.drawn = isDrawn(draws); r.valueOk = valOk; r.legend = lg.join('; ') + (lgOk === null ? ' (legend value not read)' : lgOk ? ' => legend ok' : ' => LEGEND MISMATCH');
        r.verdict = r.drawn && r.valueOk && lgOk !== false ? 'PASS' : 'FAIL'; if (id === 'SMA' && r.known) r.verdict = 'FAIL';
        await clickChip(id); const gone = await waitInd(id, false); if (!gone) { r.note += ' | tapping the chip again did not remove the indicator'; r.verdict = 'FAIL'; }
      } catch (e) { r.verdict = 'FAIL'; r.note = `cell error: ${String(e).slice(0, 220)}`; }
      rows.push(r);
    }

    /* ---------------- always-on layers: VOL, RSI-14, EMA ribbon, S/R, Liq clusters, GEX ---------------- */
    st = await readChart(page); const nn = st.n; const ix = sampleIdx(st.vr, nn); const li = nn - 6;
    { const r = mk(coin, tf, width, 'VOL'); try {
      const ind = st.inds.find((x) => x.name === 'VOL');
      if (!ind) { r.verdict = 'FAIL'; r.drawn = false; r.note = 'no VOL indicator on the chart'; } else {
        const vv = figureSeries(ind, 'volume', nn); const m1 = cmpSeries(vv, st.v, (i) => Math.abs(st.v[i]) || 1, 300, 1e-12); const rawV: Series = st.ts.map((t) => hit?.bars.find((b) => b.ts === t)?.v); const mr = hit ? cmpSeries(vv, rawV, (i) => Math.abs(rawV[i] as number) || 1, 300, 1e-9) : null;
        const ma = [5, 10, 20].map((p, k) => cmpSeries(figureSeries(ind, `ma${k + 1}`, nn), rollMean(st.v, p), (i) => Math.abs(st.v[i]) || 1, 300, 1e-9));
        r.valueOk = m1.n > 100 && m1.maxRel <= 1e-9 && (mr == null || mr.maxRel <= 1e-9) && ma.every((x) => x.maxRel <= 1e-6); r.app = `vol ${fmt(m1.lastApp)}`; r.oracle = `raw candle volume ${fmt(mr?.lastOracle ?? m1.lastOracle)}`; r.diff = `vs candles ${m1.maxRel.toExponential(2)}, vs raw server ${mr ? mr.maxRel.toExponential(2) : 'n/a'}, MA5/10/20 vs rolling mean ${ma.map((x) => x.maxRel.toExponential(1)).join('/')}`;
        await hideShot(page, 'ind', 'VOL', 'VOL'); const d = await drawSeries(page, st, ind.paneId, 'b_VOL', 'c_VOL', [st.v], 2, ix, -9); r.draw = drawTxt(d); r.drawn = isDrawn(d);
        const leg = await legendAt(page, st, li); await away(); const lv = legendCmp(leg, 'MA5', rollMean(st.v, 5)[li]); r.legend = lv.txt + ` [legend keys: ${Object.keys(leg).join(',')}]`; r.verdict = r.drawn && r.valueOk && lv.ok !== false ? 'PASS' : 'FAIL';
      } } catch (e) { r.verdict = 'FAIL'; r.note = `cell error: ${String(e).slice(0, 220)}`; } rows.push(r); }
    { const r = mk(coin, tf, width, 'RSI14'); try {
      const ind = st.inds.find((x) => x.name === 'RSI');
      if (!ind) { r.verdict = 'FAIL'; r.drawn = false; r.note = 'no RSI pane indicator on the chart'; } else {
        const orc = rsiWilder(st.c, 14); const app = figureSeries(ind, 'rsi1', nn); const m = cmpSeries(app, orc, () => 100, 300, 1e-6);
        r.valueOk = m.n > 100 && m.maxRel <= 1e-6 && ind.calcParams[0] === 14; r.app = fmt(m.lastApp); r.oracle = `${fmt(m.lastOracle)} (Wilder RSI(14))`; r.diff = `max abs ${(m.maxRel * 100).toExponential(2)} RSI points; calcParams ${JSON.stringify(ind.calcParams)}`;
        await hideShot(page, 'ind', 'RSI', 'RSI'); const d = await drawSeries(page, st, ind.paneId, 'b_RSI', 'c_RSI', [orc], 2, ix); r.draw = drawTxt(d); r.drawn = isDrawn(d);
        const leg = await legendAt(page, st, li); await away(); const lv = legendCmp(leg, 'RSI1', orc[li]); r.legend = lv.txt + ` [legend keys: ${Object.keys(leg).join(',')}]`; r.verdict = r.drawn && r.valueOk && lv.ok !== false ? 'PASS' : 'FAIL';
      } } catch (e) { r.verdict = 'FAIL'; r.note = `cell error: ${String(e).slice(0, 220)}`; } rows.push(r); }
    { const r = mk(coin, tf, width, 'EMA_RIBBON'); try {
      const lines = st.ovs.filter((x) => x.name === 'emaRibbonLine');
      if (!lines.length) { r.verdict = 'FAIL'; r.drawn = false; r.note = 'no emaRibbonLine overlays on the chart (layer off, or never created)'; } else {
        const per: string[] = []; const serieses: Series[] = []; let ok = true; const outs: string[] = []; const diffs: string[] = [];
        for (const ln of lines.sort((a, b) => Number(a.ext.period) - Number(b.ext.period))) {
          const p = Number(ln.ext.period); const orc = emaSeed(st.c, p); const app: Series = new Array(nn).fill(undefined); const idxOf = new Map(st.ts.map((t, i) => [t, i])); for (const pt of ln.points) { const i = idxOf.get(pt.timestamp as number); if (i != null && pt.value != null) app[i] = pt.value; }
          const m = cmpSeries(app, orc, scaleClose(st), 300, TOL); ok = ok && (p >= nn ? true : m.n > 50 && m.maxRel <= TOL); per.push(`EMA${p}`); outs.push(`${p}: ${fmt(m.lastApp)}/${fmt(m.lastOracle)}`); diffs.push(`${p}: ${m.maxRel.toExponential(1)}`); serieses.push(orc);
        }
        r.valueOk = ok && per.length === 4; r.app = outs.map((s) => s.split('/')[0]).join(' | '); r.oracle = outs.map((s) => s.split('/')[1]).join(' | ') + ` (${per.join(',')}, SMA-seeded)`; r.diff = diffs.join(' ') + ' max rel'; if (per.length !== 4) r.note = `${per.length} ribbon lines found, expected 4 (9/20/50/200)`;
        await hideShot(page, 'ov', 'emaRibbonLine', 'EMA'); const d = await drawSeries(page, st, 'candle_pane', 'b_EMA', 'c_EMA', serieses, 2, ix); r.draw = drawTxt(d); const off = d.filter((x) => x.n < 6); r.drawn = isDrawn(d.filter((x) => x.n >= 6), 1) && d.some((x) => x.n >= 6); if (off.length) r.note += ` ${off.length} of 4 lines have fewer than 6 sampled bars on screen (off the visible price range or too few bars for the period)`;
        r.verdict = r.drawn && r.valueOk ? 'PASS' : 'FAIL';
      } } catch (e) { r.verdict = 'FAIL'; r.note = `cell error: ${String(e).slice(0, 220)}`; } rows.push(r); }
    { const r = mk(coin, tf, width, 'SR'); try {
      const lines = st.ovs.filter((x) => x.name === 'srLevelLine');
      if (!lines.length) { r.verdict = 'NO DATA'; r.note = 'no srLevelLine overlays (S/R off, or no levels found for this window)'; } else {
        const price = st.c[nn - 1]; const orc = [...srOracle(st.h, st.l, st.c[nn - 3]), ...srOracle(st.h, st.l, price)]; const drawn = lines.map((x) => Number((x.ext as { price?: number }).price ?? x.points[0]?.value)).filter(Number.isFinite);
        const miss = drawn.filter((p) => !orc.some((q) => Math.abs(q.price - p) / p < 0.002)); r.valueOk = miss.length === 0; r.app = drawn.map((p) => fmt(p, 7)).join(', '); r.oracle = srOracle(st.h, st.l, price).map((q) => `${fmt(q.price, 7)}${q.type[0]}${q.touches}`).join(', ') + ' (documented rule: 3-bar swings over 200 bars, 0.3% clusters, top 3 per side)'; r.diff = miss.length ? `${miss.length} of ${drawn.length} drawn levels are not in the oracle set: ${miss.map((p) => fmt(p, 7)).join(',')}` : `all ${drawn.length} drawn levels match an oracle level within 0.2%`;
        await hideShot(page, 'ov', 'srLevelLine', 'SR'); const res: DrawRes[] = []; for (const p of drawn) res.push(await drawCheck(page, { paneId: 'candle_pane', base: 'b_SR', cur: 'c_SR', pts: ix.map((i) => ({ ts: st.ts[i], value: p })), r: 2 }));
        r.draw = drawTxt(res); r.drawn = res.some((x) => x.n >= 6) && res.filter((x) => x.n >= 6).every((x) => x.hit >= 0.4 * x.n); r.verdict = r.drawn && r.valueOk ? 'PASS' : 'FAIL';
      } } catch (e) { r.verdict = 'FAIL'; r.note = `cell error: ${String(e).slice(0, 220)}`; } rows.push(r); }
    for (const [key, nm, ovName] of [['LIQ', 'LIQ_CLUSTERS', 'liqClusterLine'], ['GEX', 'GEX', 'gexLevelLine']] as const) {
      const r = mk(coin, tf, width, nm); try {
        const lines = st.ovs.filter((x) => x.name === ovName);
        if (!lines.length) { r.verdict = 'NO DATA'; r.note = key === 'LIQ' ? 'no liquidation clusters on the chart at this moment (the source is the live liquidation websocket; none had landed, or the layer is off)' : 'no GEX levels for this coin (BTC/ETH only)'; }
        else {
          const prices = lines.map((x) => Number((x.ext as { price?: number }).price ?? x.points[0]?.value)).filter(Number.isFinite); const lo = Math.min(...st.l.slice(-150)), hi = Math.max(...st.h.slice(-150));
          r.app = prices.map((p) => fmt(p, 7)).join(', '); r.oracle = 'n/a: no REST oracle (source is the live liquidation / options feeds); only checked: price is finite and its pixel line is drawn'; r.diff = `${prices.length} lines; price range of the last 150 bars ${fmt(lo, 7)}..${fmt(hi, 7)}`; r.valueOk = null;
          await hideShot(page, 'ov', ovName, key); const res: DrawRes[] = []; for (const p of prices) res.push(await drawCheck(page, { paneId: 'candle_pane', base: `b_${key}`, cur: `c_${key}`, pts: ix.map((i) => ({ ts: st.ts[i], value: p })), r: 2 }));
          r.draw = drawTxt(res); const vis = res.filter((x) => x.n >= 6); r.drawn = vis.length > 0 ? vis.every((x) => x.hit >= 0.4 * x.n) : null; if (vis.length === 0) r.note = 'every line is outside the visible price range, so there is no pixel to test'; r.verdict = r.drawn === false ? 'FAIL' : r.drawn ? 'PASS' : 'NO DATA';
        } } catch (e) { r.verdict = 'FAIL'; r.note = `cell error: ${String(e).slice(0, 220)}`; } rows.push(r); }

    /* ---------------- all four chips on together: they all exist at once, then the shot ---------------- */
    if (o.shots) {
      for (const id of ['SMA', 'SAR', 'MACD', 'BOLL']) { try { if (await page.getByTestId(`strategy-indicator-${id}`).count()) await page.getByTestId(`strategy-indicator-${id}`).first().click({ timeout: 20_000 }); } catch { /* shot is best effort */ } }
      await page.waitForTimeout(3500); const s3 = await readChart(page, 5); const have = ['SMA', 'SAR', 'MACD', 'BOLL'].filter((n) => s3.inds.some((i) => i.name === n));
      console.log(`[IND] ${coin} ${tf} ${width}: all-chips-on indicators present: ${have.join(',')} (want SMA,SAR,MACD,BOLL)`);
      const pressed = await page.evaluate(() => ['SMA', 'SAR', 'MACD', 'BOLL'].map((id) => `${id}=${document.querySelector(`[data-testid="strategy-indicator-${id}"]`)?.getAttribute('aria-pressed')}`).join(' '));
      const notice = await page.evaluate(() => /(couldn.?t draw|cannot draw)[^\n]{0,80}/i.exec(document.body.innerText || '')?.[0] ?? 'none');
      const r = mk(coin, tf, width, 'ALL4_TOGETHER'); r.verdict = have.length === 4 ? 'PASS' : 'FAIL'; r.drawn = have.length === 4; r.note = `chips pressed: ${pressed}; indicators on the chart: ${have.join(',') || 'none'}; "couldn't draw" notice: ${notice}. ${have.length === 4 ? '' : 'DEFECT: chips read ON but the chart draws fewer indicators (klinecharts createIndicator without isStack replaces every indicator already in candle_pane, so SMA/SAR/BOLL evict each other).'}`; rows.push(r);
      await page.mouse.move(2, 2); await page.waitForTimeout(500);
      await page.locator('.klc-wrap').first().scrollIntoViewIfNeeded().catch(() => {}); await page.locator('.klc-wrap').first().screenshot({ path: `qa/.shots/ind-${coin}-${tf}-${width}.png`, timeout: 20_000 }).catch(() => {});
      await page.screenshot({ path: `qa/.shots/ind-${coin}-${tf}-${width}-page.png`, timeout: 20_000 }).catch(() => {});
    }
  } finally { await ctx.close().catch(() => {}); }
  return rows;
}

export function report(rows: Row[]): string[] {
  const fails: string[] = [];
  for (const r of rows) {
    console.log(`[IND] ${r.coin} ${r.tf} ${r.ind}: drawn=${r.drawn} value app=${r.app} oracle=${r.oracle} diff=${r.diff} | draw ${r.draw} | legend ${r.legend} | ${r.verdict}${r.note ? ' | ' + r.note : ''}`);
    console.log(`[INDJ] ${JSON.stringify(r)}`);
    if (r.verdict === 'FAIL' && !r.known) fails.push(`${r.coin} ${r.tf} ${r.w} ${r.ind}: drawn=${r.drawn} valueOk=${r.valueOk} ${r.note}`.slice(0, 300));
  }
  return fails;
}
