/* REAL-DATA SIGNAL AUDIT FOR EVERY ARENA STRATEGY (owner order via PM, 2026-11-19: prove each strategy fires on real market data; S/R flip passed its synthetic
 * tests and never fired in the app, #2584). Read-only, never shipped, never imported by the app. No key, no auth, no user data: Binance public klines only.
 *
 *   node scripts/strategy-signal-audit.mts                 all strategies, BTC/ETH/SOL x 15m/1h/4h, last 30 days
 *   node scripts/strategy-signal-audit.mts --only sr_flip  one strategy (comma list allowed)
 *   node scripts/strategy-signal-audit.mts --days 14       a shorter span
 *   node scripts/strategy-signal-audit.mts --funding fixed funding_oi_squeeze with the old fixed funding bands instead of the relative 90-day rule
 *
 * HOW IT MIRRORS THE APP (lib/useStrategySignal.ts and app/api/strategies/track/route.ts):
 *   - The app fetches the latest 300 candles and drops the forming one, so every detect() call sees the last 299 CLOSED candles. Here, at each closed candle k, the
 *     detector gets the 299 closed candles ending at k (APP_WINDOW), never all history. A step whose window is shorter than the strategy's minCandles is skipped, as the
 *     app shows an error instead of calling it.
 *   - Context: { coin, tf, tfMs } always. btcCandles (needsBtc, coin other than BTC): BTC's 299 closed candles ending at the same open time. taker (needsTaker): taker buy /
 *     sell volume by open time from Binance FUTURES klines (the app's fetchTakerMap / the fire log read the same field, index 9). liqLevels: not passed: the app's are the
 *     chart's live liquidation estimate, which has no history (only lib/strategies/liquiditySweepMss.ts reads them, for a note, and funding_oi_squeeze, see below).
 *   - funding_oi_squeeze reads live funding, open interest and liquidation clusters that exist only for NOW (its own header says past candles are never marked). Its three
 *     conditions, and what a replay can do with each:
 *       1. funding extreme for the coin (relative to its own 90 days): REPLAYABLE. Stand-in: the last SETTLED rate at the candle against the settlements before it
 *          (fapi fundingRate history), through the app's own lib/strategies/liveInputs.ts fundingClassRelative. (`--funding fixed` replays the old fixed bands instead;
 *          the default is the relative rule when the app has it.)
 *       2. open interest up 3% over 6 candles: REPLAYABLE (openInterestHist, Binance keeps 30 days; the app's own oiChange6).
 *       3. a liquidation cluster within 1.5%: LIVE-ONLY, the chart's estimate has no history. So two rows are printed: `funding_oi_squeeze` (clusters absent, as in a replay:
 *          0 by construction, it proves nothing) and `funding_oi_squeeze +clusters assumed` (a cluster is pretended to sit 1% beyond every close, i.e. condition 3 always
 *          passes: the count of funding + OI + swing-trigger signals, an UPPER BOUND on live because live needs a real cluster too). The few-per-month target is for that row.
 *   - Candles: Binance SPOT klines (api.binance.com). The app reads Bybit linear first, Binance futures second, so prices differ by the basis; signal TIMES should agree
 *     closely but not always exactly. Say which venue a comparison used.
 * DE-DUPLICATION: the app's own identity rule, lib/arenaSoundTriggers.ts signalIdentity = `${signalDir}:${signalTimestamp}`: the panel pings once per identity, and a
 *   signal that stays current over its FRESH_BARS window keeps its signalTimestamp, so it is ONE signal. Each signal is recorded once, at the first step it appeared.
 * Output: a strategy x (coin, tf) count table, time ran per strategy, flags (0 everywhere; more than 1 signal per 3 candles), and the full list as JSON in
 *   .work/strategy-audit/signals-<date>.json (git-ignored). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { STRATEGIES } from '../lib/strategies/index.ts';
import type { StrategyContext } from '../lib/strategies/types.ts';
import * as liveInputs from '../lib/strategies/liveInputs.ts';
import { fundingClassOf, oiRelative, OI_ROWS } from '../lib/strategies/liveInputs.ts';
import { TF_MS } from '../lib/candles.ts';
import type { OHLCV } from '../lib/strategyCore.ts';
import { swingPivots3 } from '../lib/strategies/shared.ts';

const APP_WINDOW = 299;   // 300 fetched, the forming one dropped (lib/useStrategySignal.ts, app/api/strategies/track/route.ts)
const COINS = [{ coin: 'btc', sym: 'BTCUSDT' }, { coin: 'eth', sym: 'ETHUSDT' }, { coin: 'sol', sym: 'SOLUSDT' }] as const;
const TFS = ['15m', '1h', '4h'] as const;
const DELAY_MS = 250;
const TOO_MANY = 1 / 3;
const BUSY = 0.1;         // reported for information: more than 1 signal per 10 candles

const arg = (name: string): string | undefined => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const DAYS = Number(arg('days') ?? 30);
const ONLY = arg('only')?.split(',').map(s => s.trim()).filter(Boolean);
/** The app's relative funding rule, when this checkout has it (looked up by name so the script also runs on a checkout from before the rule existed). */
type FundingPoint = { time: number; rate: number };
const relativeFn = (liveInputs as Record<string, unknown>).fundingClassRelative as undefined | ((rate: number, hist: FundingPoint[], now: number) => { fundingClass: 'longs_heavy' | 'shorts_heavy' | 'none'; fundingPct: number } | null);
const FUNDING_MODE: 'relative' | 'fixed' = arg('funding') === 'fixed' || !relativeFn ? 'fixed' : 'relative';
const FUNDING_HISTORY_DAYS = 91;   // fetched before the walk starts, so the first candle has its 90 days

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(DELAY_MS);
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
    throw new Error(`${r.status} ${url.split('?')[0]}`);
  }
  throw new Error(`gave up: ${url.split('?')[0]}`);
}

type Kline = (string | number)[];
/** Every kline from `startMs` to now, oldest first, 1000 per request, one request at a time. */
async function klines(base: string, sym: string, interval: string, startMs: number): Promise<Kline[]> {
  const out: Kline[] = [];
  let from = startMs;
  for (;;) {
    const page = (await getJson(`${base}?symbol=${sym}&interval=${interval}&startTime=${from}&limit=1000`)) as Kline[];
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    const lastOpen = Number(page[page.length - 1][0]);
    if (page.length < 1000) break;
    from = lastOpen + 1;
  }
  return out;
}
const toOhlcv = (k: Kline): OHLCV => ({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });

interface Signal { strategy: string; coin: string; tf: string; ts: number; iso: string; dir: 'long' | 'short'; verdict: string; entry?: number; stop?: number; target?: number; rr?: number; firstSeenAtCandle: number }

async function main() {
  const now = Date.now();
  const defs = ONLY ? STRATEGIES.filter(s => ONLY.includes(s.id)) : STRATEGIES;
  if (!defs.length) throw new Error(`no strategy matches --only ${ONLY}`);
  const spanStart = now - DAYS * 86_400_000;
  const signals: Signal[] = [];
  const counts = new Map<string, Map<string, number>>();      // strategy -> combo -> count
  const steps = new Map<string, Map<string, number>>();       // strategy -> combo -> candles evaluated
  const timeMs = new Map<string, number>();
  const calls = new Map<string, number>();
  const btcClosed = new Map<string, OHLCV[]>();
  const funnels = new Map<string, Map<string, number[]>>();   // strategy -> combo -> candles reaching each stage
  /* One row per strategy; funding_oi_squeeze gets a second, `+clusters assumed` (see the header). */
  const runs = defs.flatMap(def => (def.id === 'funding_oi_squeeze' ? [{ def, key: def.id, assume: false }, { def, key: `${def.id} +clusters assumed`, assume: true }] : [{ def, key: def.id, assume: false }]));

  for (const tf of TFS) {
    const tfMs = TF_MS[tf];
    const fetchFrom = spanStart - (APP_WINDOW + 5) * tfMs;
    for (const { coin, sym } of COINS) {
      const combo = `${coin.toUpperCase()} ${tf}`;
      const all = (await klines('https://api.binance.com/api/v3/klines', sym, tf, fetchFrom)).map(toOhlcv).filter(c => c.time + tfMs <= now);
      if (coin === 'btc') btcClosed.set(tf, all);
      const needTaker = defs.some(d => d.needsTaker);
      const needLive = defs.some(d => d.needsLive);
      let taker: Map<number, { buy: number; sell: number }> | undefined;
      if (needTaker) {
        const fk = await klines('https://fapi.binance.com/fapi/v1/klines', sym, tf, fetchFrom);
        taker = new Map(fk.map(k => [+k[0], { buy: +k[9], sell: +k[5] - +k[9] }] as const));
      }
      const live = needLive ? await liveHistory(sym, tf, tfMs, fetchFrom, fetchFrom - FUNDING_HISTORY_DAYS * 86_400_000) : null;
      if (live && tf === TFS[0]) {
        const rates = live.rates.filter(r => r.fundingTime >= spanStart).map(r => Number(r.fundingRate) * 100);
        process.stdout.write(`${coin.toUpperCase()} funding over the span: ${rates.length} settlements, min ${Math.min(...rates).toFixed(4)}%, max ${Math.max(...rates).toFixed(4)}%; funding rule: ${FUNDING_MODE}
`);
      }
      const first = all.findIndex(c => c.time >= spanStart);
      process.stdout.write(`${combo}: ${all.length} closed candles, walking ${all.length - first}\n`);
      for (const { def, key, assume } of runs) {
        const seen = new Set<string>();
        let n = 0, evaluated = 0;
        let t = 0;
        for (let k = first; k < all.length; k++) {
          const win = all.slice(Math.max(0, k - APP_WINDOW + 1), k + 1);
          if (win.length < def.minCandles) continue;
          const ctx: StrategyContext = { coin, tf, tfMs, oiChange6Pct: null };
          if (def.needsBtc && coin !== 'btc') {
            const b = btcClosed.get(tf)!;
            const end = b.findIndex(c => c.time > all[k].time);
            ctx.btcCandles = b.slice(0, end < 0 ? b.length : end).slice(-APP_WINDOW);
          }
          if (def.needsTaker) ctx.taker = taker;
          if (def.needsLive && live) {
            const fc = live.classAt(all[k].time + tfMs);
            if (fc) Object.assign(ctx, fc);
            const oiNow = live.oiAt(all[k].time + tfMs);
            ctx.oiChange6Pct = oiNow?.oiChange6Pct ?? null;
            ctx.oiExtreme = oiNow?.oiExtreme ?? null;
            if (assume) { const px = all[k].close; ctx.liqLevels = [px * 0.99, px * 1.01]; }
          }
          const stageOf = assume ? undefined : FUNNELS[def.id]?.stage;
          if (stageOf) {
            if (!funnels.has(def.id)) funnels.set(def.id, new Map());
            const f = funnels.get(def.id)!;
            const fd = FUNNELS[def.id], alone = fd.alone ?? [];
            if (!f.has(combo)) f.set(combo, new Array(fd.stages.length + alone.length).fill(0));
            const reached = stageOf(win, ctx), row = f.get(combo)!;
            for (let s = 0; s <= reached; s++) row[s]++;
            alone.forEach((a, j) => { if (a.test(win, ctx)) row[fd.stages.length + j]++; });
          }
          const t0 = performance.now();
          const r = def.detect(win, ctx);
          t += performance.now() - t0;
          evaluated++;
          if (r.verdict === 'wait' || r.signalTimestamp == null || r.signalDir == null) continue;
          const id = `${r.signalDir}:${r.signalTimestamp}`;
          if (seen.has(id)) continue;
          seen.add(id);
          n++;
          const p = r.params;
          const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
          signals.push({ strategy: key, coin, tf, ts: r.signalTimestamp, iso: new Date(r.signalTimestamp).toISOString(), dir: r.signalDir, verdict: r.verdict,
            entry: num(p.entry), stop: num(p.stop) ?? num(p.inv), target: num(p.target), rr: num(p.rr), firstSeenAtCandle: all[k].time });
        }
        if (!counts.has(key)) { counts.set(key, new Map()); steps.set(key, new Map()); }
        counts.get(key)!.set(combo, n);
        steps.get(key)!.set(combo, evaluated);
        timeMs.set(key, (timeMs.get(key) ?? 0) + t);
        calls.set(key, (calls.get(key) ?? 0) + evaluated);
      }
    }
  }

  const combos = TFS.flatMap(tf => COINS.map(c => `${c.coin.toUpperCase()} ${tf}`));
  const pad = (s: string | number, w: number) => String(s).padStart(w);
  console.log(`\nSignals per strategy, last ${DAYS} days, Binance spot, app window ${APP_WINDOW} closed candles, de-dup by ${'`dir:signalTimestamp`'}\n`);
  console.log(`${'strategy'.padEnd(34)}${combos.map(c => pad(c, 9)).join('')}${pad('total', 7)}${pad('ms/call', 9)}${pad('ran s', 7)}`);
  const zero: string[] = [], tooMany: string[] = [], busy: string[] = [];
  for (const { key } of runs) {
    const row = combos.map(c => counts.get(key)?.get(c) ?? 0);
    const total = row.reduce((a, v) => a + v, 0);
    const ms = timeMs.get(key) ?? 0, nc = calls.get(key) ?? 0;
    console.log(`${key.padEnd(34)}${row.map(v => pad(v, 9)).join('')}${pad(total, 7)}${pad(nc ? (ms / nc).toFixed(2) : '-', 9)}${pad((ms / 1000).toFixed(1), 7)}`);
    if (total === 0) zero.push(key);
    for (const c of combos) {
      const ev = steps.get(key)?.get(c) ?? 0, cnt = counts.get(key)?.get(c) ?? 0;
      if (ev > 0 && cnt / ev > TOO_MANY) tooMany.push(`${key} ${c}: ${cnt} in ${ev} candles`);
      else if (ev > 0 && cnt / ev > BUSY) busy.push(`${key} ${c} ${((cnt / ev) * 100).toFixed(0)}%`);
    }
  }
  console.log(`\nZero signals on all ${combos.length} combos: ${zero.length ? zero.join(', ') : 'none'}`);
  console.log(`More than 1 signal per 3 candles: ${tooMany.length ? tooMany.join('; ') : 'none'}`);
  console.log(`More than 1 per 10 (information only): ${busy.length ? busy.join('; ') : 'none'}`);
  for (const id of [...new Set([...zero, ...(funnels.has('funding_oi_squeeze') ? ['funding_oi_squeeze'] : [])])]) {
    const fdef = FUNNELS[id], f = funnels.get(id);
    if (!fdef || !f) { console.log(`
${id}: no funnel instrument in this script; read its conditions against the candles by hand.`); continue; }
    console.log(`
Funnel for ${id} (candles reaching each condition, cumulative):`);
    console.log(`${'condition'.padEnd(52)}${combos.map(c => pad(c, 9)).join('')}`);
    [...fdef.stages, ...(fdef.alone ?? []).map(a => a.label)].forEach((label, s) => console.log(`${label.padEnd(52)}${combos.map(c => pad(f.get(c)?.[s] ?? 0, 9)).join('')}`));
    if (fdef.note) console.log(fdef.note);
  }

  const day = new Date(now).toISOString().slice(0, 10);
  mkdirSync('.work/strategy-audit', { recursive: true });
  const path = `.work/strategy-audit/signals-${day}${ONLY ? `-${ONLY.join('_')}` : ''}${DAYS !== 30 ? `-${DAYS}d` : ''}.json`;   // a partial run never overwrites the full one
  writeFileSync(path, JSON.stringify({
    generatedAt: new Date(now).toISOString(), days: DAYS, venue: 'binance-spot', appWindow: APP_WINDOW, dedup: 'dir:signalTimestamp (lib/arenaSoundTriggers.ts signalIdentity)',
    counts: Object.fromEntries([...counts].map(([id, m]) => [id, Object.fromEntries(m)])),
    evaluated: Object.fromEntries([...steps].map(([id, m]) => [id, Object.fromEntries(m)])),
    signals,
  }, null, 2));
  console.log(`\nWrote ${signals.length} signals to ${path}`);
}

/** Historical stand-ins for funding_oi_squeeze's live inputs: the funding rate in force at a time, and the open-interest change over the 6 rows before it (Binance futures data, 30 days kept). */
async function liveHistory(sym: string, tf: string, tfMs: number, fromMs: number, fundingFromMs: number) {
  const fr = (await getJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&startTime=${fundingFromMs}&limit=1000`)) as Array<{ fundingTime: number; fundingRate: string }>;
  const oi: Array<{ timestamp: number; sumOpenInterest: string }> = [];
  let end = Date.now();
  const oiFloor = Date.now() - 29.5 * 86_400_000;
  for (;;) {
    const page = (await getJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=${tf}&limit=500&endTime=${end}`)) as Array<{ timestamp: number; sumOpenInterest: string }>;
    if (!Array.isArray(page) || !page.length) break;
    oi.unshift(...page);
    const oldest = Number(page[0].timestamp);
    if (page.length < 500 || oldest <= oiFloor || oldest <= fromMs) break;
    end = oldest - 1;
  }
  const oiSorted = [...new Map(oi.map(r => [Number(r.timestamp), r])).values()].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  return {
    rates: fr,
    /** The funding class at time `ms`. Relative mode: the last settled rate at `ms` is the stand-in for the live rate, judged against the settlements BEFORE it (the app's fundingClassRelative, 90 days). Fixed mode: the old fixed bands on that rate. */
    classAt(ms: number): { fundingClass: 'longs_heavy' | 'shorts_heavy' | 'none'; fundingPct: number } | null {
      let idx = -1;
      for (let i = 0; i < fr.length && fr[i].fundingTime <= ms; i++) idx = i;
      if (idx < 0) return null;
      const cur = Number(fr[idx].fundingRate);
      if (FUNDING_MODE === 'fixed' || !relativeFn) return fundingClassOf(cur);
      return relativeFn(cur, fr.slice(0, idx).map(r => ({ time: r.fundingTime, rate: Number(r.fundingRate) })), ms);
    },
    fundingAt(ms: number): number | null {
      let v: number | null = null;
      for (const r of fr) { if (r.fundingTime <= ms) v = Number(r.fundingRate); else break; }
      return v;
    },
    /** The app's own oiRelative (lib/strategies/liveInputs.ts) on the newest OI_ROWS rows that existed at `ms`: the live change judged against the coin's own changes on this timeframe. */
    oiAt(ms: number): { oiChange6Pct: number; oiExtreme: boolean } | null {
      return oiRelative(oiSorted.filter(r => Number(r.timestamp) <= ms).slice(-OI_ROWS), tfMs);
    },
  };
}

/* FUNNELS: for a strategy that never fires, how many candles get past each condition of its chain, in the detector's own order. Instrumentation only: the count table above
   always comes from the app's detect(). Each stage function returns the index of the LAST condition the candle passed (0 = evaluated). */
interface Funnel { stages: string[]; stage: (c: readonly OHLCV[], ctx: StrategyContext) => number; note?: string; alone?: Array<{ label: string; test: (c: readonly OHLCV[], ctx: StrategyContext) => boolean }> }
/** The detector's trigger: the first close through the last 3-bar swing AGAINST the crowd on one of the last 2 candles (lib/strategies/fundingOiSqueeze.ts). */
function triggered(c: readonly OHLCV[], crowdLong: boolean): boolean {
  const n = c.length;
  for (const k of [n - 1, n - 2]) {
    const sw = swingPivots3(c.slice(0, k), 20);
    const low = sw.lows[sw.lows.length - 1], hi = sw.highs[sw.highs.length - 1];
    if (!low || !hi) continue;
    const x = c[k];
    if (crowdLong ? x.close < low.p && c[k - 1].close >= low.p && hi.p > x.close : x.close > hi.p && c[k - 1].close <= hi.p && low.p < x.close) return true;
  }
  return false;
}
const FUNNELS: Record<string, Funnel> = {
  /* lib/strategies/fundingOiSqueeze.ts, condition by condition. The cluster condition cannot pass here: the app's liquidation clusters are a live chart estimate with no history. */
  funding_oi_squeeze: {
    stages: ['evaluated', 'funding known (needs 90-day history)', '1. funding extreme for the coin (replayable)', '+ 2. OI extreme for the coin (replayable)', '+ swing trigger against the crowd (replayable)', '+ 3. liquidation cluster within 1.5% (LIVE-ONLY)'],
    alone: [
      { label: '(alone) OI extreme for the coin (top 20% of its own 6-candle changes)', test: (_c, ctx) => ctx.oiExtreme === true },
      { label: '(what-if) funding extreme + swing trigger, OI ignored', test: (c, ctx) => !!ctx.fundingClass && ctx.fundingClass !== 'none' && triggered(c, ctx.fundingClass === 'longs_heavy') },
    ],
    note: 'The last stage needs the live liquidation clusters, which have no history, so the plain row is 0 in a replay by construction (it proves nothing); the `+clusters assumed` row passes it by pretending a cluster sits 1% beyond every close, and is the count of replayable conditions (funding + OI + trigger), an upper bound on live.',
    stage(c, ctx) {
      if (ctx.fundingClass == null || ctx.oiExtreme == null) return 0;
      if (ctx.fundingClass === 'none') return 1;
      if (!ctx.oiExtreme) return 2;
      return triggered(c, ctx.fundingClass === 'longs_heavy') ? 4 : 3;
    },
  },
};

main().catch(e => { console.error(e); process.exit(1); });
