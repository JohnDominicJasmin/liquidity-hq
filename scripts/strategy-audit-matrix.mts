/* THE 20-ASSET x 8-TIMEFRAME x 16-STRATEGY REAL-DATA AUDIT (owner order via PM, 2026-11-19; part of #2601). Read-only, never shipped, never imported by the app. Runs on GitHub Actions (.github/workflows/strategy-audit.yml),
 * one job per coin, never on the owner's laptop. No key, no auth, no user data.
 *
 *   node --import ./qa/alias-register.mjs scripts/strategy-audit-matrix.mts --coin btc [--tfs 1h,4h] [--days 30] [--out .work/matrix]
 *   node --import ./qa/alias-register.mjs scripts/strategy-audit-matrix.mts --merge .work/matrix     (merges the per-coin files into the tables)
 *
 * DATA: Binance's public archive (https://data.binance.vision), because US-hosted runners are often refused (HTTP 451) by the live Binance / Bybit APIs. Futures USD-M monthly and daily kline zips (the same candles the app's
 *   Binance-futures fallback reads; the app reads Bybit first, so prices differ by the basis and signal TIMES can differ by a candle), the monthly fundingRate zips, and the daily metrics zips (5-minute open interest). The archive
 *   publishes a day after it ends, so the newest partial day is missing: the walk ends at the last archived day. A coin with no Binance futures symbol (xau) or no archive file is reported as `no data`, never as silent.
 * HOW IT MIRRORS THE APP: at each closed candle k the detector gets the closed candles ending at k, as many as the app fetches (300, a strategy's `candleLimit` where it has one, minus the forming candle), with the same context
 *   (coin, tf, tfMs; BTC's candles at the same time for supply / demand; taker volume by open time; for the squeeze the relative funding and open-interest rules of lib/strategies/liveInputs.ts with the OI window limited to the
 *   newest 500 candles within 30 days, as Binance serves it). Signal identity is the app's `dir:signalTimestamp`; a signal that stays current counts once.
 * THREE KINDS OF CELL, kept apart: `n/a` = unsupported BY DESIGN (lib/strategies/availability.ts: the exact line the app shows), `no data` = the archive had no candles, a number = the count of signals (0 is a real zero:
 *   a supported strategy that was silent). Span: DAYS days (default 30); 1d candles use 180 days. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { STRATEGIES } from '../lib/strategies/index.ts';
import type { StrategyContext } from '../lib/strategies/types.ts';
import { strategyUnavailable } from '../lib/strategies/availability.ts';
import { fundingClassRelative, oiRelative, OI_ROWS, type FundingPoint } from '../lib/strategies/liveInputs.ts';
import { binanceFuturesSymbol } from '../lib/coins.ts';
import { TF_MS } from '../lib/candles.ts';
import type { OHLCV } from '../lib/strategyCore.ts';

const ALL_TFS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'] as const;
export const AUDIT_COINS = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'doge', 'ada', 'avax', 'link', 'sui', 'hype', 'tao', 'pepe', 'wif', 'xau', 'aapl', 'nvda', 'tsla', 'mstr', 'coin'];
const DAY = 86_400_000;
const arg = (n: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/* ── the archive ─────────────────────────────────────────────────────────────────────────────────────────────── */
const BASE = 'https://data.binance.vision/data/futures/um';
async function getZip(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (!r.ok) { await sleep(1000 * (attempt + 1)); continue; }
      return unzipFirst(Buffer.from(await r.arrayBuffer()));
    } catch { await sleep(1000 * (attempt + 1)); }
  }
  return null;
}
/** The first file of a zip as text (the archive's zips hold one CSV): read from the central directory, which always carries the sizes. */
function unzipFirst(buf: Buffer): string | null {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) return null;
  const cd = buf.readUInt32LE(e + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) return null;
  const method = buf.readUInt16LE(cd + 10), csize = buf.readUInt32LE(cd + 20), lho = buf.readUInt32LE(cd + 42);
  const nameLen = buf.readUInt16LE(lho + 26), extraLen = buf.readUInt16LE(lho + 28);
  const data = buf.subarray(lho + 30 + nameLen + extraLen, lho + 30 + nameLen + extraLen + csize);
  return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
}
const ym = (t: number) => new Date(t).toISOString().slice(0, 7);
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const monthStart = (t: number) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const nextMonth = (t: number) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };

type Row = (string | number)[];
const csvRows = (txt: string | null): Row[] => (txt ? txt.split('\n').map(l => l.trim()).filter(l => l && /^\d/.test(l)).map(l => l.split(',')) : []);

/** Closed klines of `sym` at `interval` from `fromMs` up to the last archived day: monthly zips for whole months before the current one, daily zips for the current month. */
async function archiveKlines(sym: string, interval: string, fromMs: number, nowMs: number): Promise<Row[]> {
  const out: Row[] = [];
  const thisMonth = monthStart(nowMs);
  const yesterday = Math.floor(nowMs / DAY) * DAY - DAY;
  for (let m = monthStart(fromMs); m < thisMonth; m = nextMonth(m)) {
    out.push(...csvRows(await getZip(`${BASE}/monthly/klines/${sym}/${interval}/${sym}-${interval}-${ym(m)}.zip`)));
  }
  for (let d = Math.max(thisMonth, Math.floor(fromMs / DAY) * DAY); d <= yesterday; d += DAY) {
    out.push(...csvRows(await getZip(`${BASE}/daily/klines/${sym}/${interval}/${sym}-${interval}-${ymd(d)}.zip`)));
  }
  return out;
}
async function archiveFunding(sym: string, fromMs: number, nowMs: number): Promise<FundingPoint[]> {
  const pts: FundingPoint[] = [];
  for (let m = monthStart(fromMs); m <= monthStart(nowMs); m = nextMonth(m)) {
    for (const r of csvRows(await getZip(`${BASE}/monthly/fundingRate/${sym}/${sym}-fundingRate-${ym(m)}.zip`))) pts.push({ time: +r[0], rate: +r[2] });
  }
  return pts.filter(p => Number.isFinite(p.time) && Number.isFinite(p.rate)).sort((a, b) => a.time - b.time);
}
/** 5-minute open interest from the daily metrics zips: [time, sum_open_interest]. */
async function archiveOi(sym: string, fromMs: number, nowMs: number): Promise<Array<[number, number]>> {
  const out: Array<[number, number]> = [];
  const yesterday = Math.floor(nowMs / DAY) * DAY - DAY;
  for (let d = Math.floor(fromMs / DAY) * DAY; d <= yesterday; d += DAY) {
    const txt = await getZip(`${BASE}/daily/metrics/${sym}/${sym}-metrics-${ymd(d)}.zip`);
    if (!txt) continue;
    for (const l of txt.split('\n')) {
      const c = l.trim().split(',');
      if (c.length < 3 || !/^\d{4}-/.test(c[0])) continue;
      const t = Date.parse(c[0].replace(' ', 'T') + 'Z');
      if (Number.isFinite(t)) out.push([t, +c[2]]);
    }
  }
  return out;
}

const toOhlcv = (k: Row): OHLCV => ({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });

/* ── one coin ────────────────────────────────────────────────────────────────────────────────────────────────── */
interface Cell { status: 'ok' | 'n/a' | 'no data'; count: number; steps: number; reason?: string; ms?: number; examples: Array<{ iso: string; dir: string }> }
async function auditCoin(coin: string, tfs: readonly string[], days: number, out: string) {
  const now = Date.now();
  const sym = binanceFuturesSymbol(coin);
  const cells: Record<string, Record<string, Cell>> = {};
  const set = (id: string, tf: string, c: Cell) => { (cells[id] ??= {})[tf] = c; };
  const btcCache = new Map<string, OHLCV[]>();
  for (const tf of tfs) {
    const tfMs = TF_MS[tf];
    const spanDays = tf === '1d' ? 180 : days;
    const spanStart = now - spanDays * DAY;
    const warm = 1000;   // the longest window any strategy reads (candleLimit)
    const fetchFrom = spanStart - (warm + 5) * tfMs;
    const needBtc = STRATEGIES.some(s => s.needsBtc);
    const rows = sym ? await archiveKlines(sym, tf, fetchFrom, now).catch(() => []) : [];
    const all: OHLCV[] = rows.map(toOhlcv).filter(c => c.time + tfMs <= now);
    const taker = new Map<number, { buy: number; sell: number }>(rows.map(k => [+k[0], { buy: +k[9], sell: +k[5] - +k[9] }] as const));
    let btc: OHLCV[] | undefined;
    if (needBtc && coin !== 'btc') {
      if (!btcCache.has(tf)) { const bs = binanceFuturesSymbol('btc'); btcCache.set(tf, bs ? (await archiveKlines(bs, tf, fetchFrom, now)).map(toOhlcv).filter(c => c.time + tfMs <= now) : []); }
      btc = btcCache.get(tf);
    }
    const needsSqueeze = STRATEGIES.some(s => s.id === 'funding_oi_squeeze') && !strategyUnavailable('funding_oi_squeeze', coin, tfMs);
    const funding = needsSqueeze && sym ? await archiveFunding(sym, spanStart - 100 * DAY, now) : [];
    const oi5 = needsSqueeze && sym ? await archiveOi(sym, spanStart - 31 * DAY, now) : [];
    const first = all.findIndex(c => c.time >= spanStart);
    process.stdout.write(`${coin} ${tf}: ${all.length} closed candles, walking ${first < 0 ? 0 : all.length - first}\n`);
    for (const def of STRATEGIES) {
      const na = strategyUnavailable(def.id, coin, tfMs);
      if (na) { set(def.id, tf, { status: 'n/a', count: 0, steps: 0, reason: `${na.reasonKey} ${JSON.stringify(na.vars)}`, examples: [] }); continue; }
      if (!sym || first < 0 || all.length - first < 1) { set(def.id, tf, { status: 'no data', count: 0, steps: 0, reason: sym ? 'no archived candles' : 'no Binance futures symbol', examples: [] }); continue; }
      const win = (def.candleLimit ?? 300) - 1;
      const seen = new Set<string>();
      const examples: Cell['examples'] = [];
      let count = 0, steps = 0;
      const t0 = performance.now();
      for (let k = first; k < all.length; k++) {
        const w = all.slice(Math.max(0, k - win + 1), k + 1);
        if (w.length < def.minCandles) continue;
        const ctx: StrategyContext = { coin, tf, tfMs };
        if (def.needsBtc && coin !== 'btc') {
          if (!btc) continue;
          const end = btc.findIndex(c => c.time > all[k].time);
          ctx.btcCandles = btc.slice(0, end < 0 ? btc.length : end).slice(-win);
        }
        if (def.needsTaker) ctx.taker = taker;
        if (def.needsLive) {
          const at = all[k].time + tfMs;
          const prior = funding.filter(f => f.time <= at);
          const cur = prior[prior.length - 1];
          const fc = cur ? fundingClassRelative(cur.rate, prior.slice(0, -1), at) : null;
          if (fc) Object.assign(ctx, fc);
          // 5-minute OI folded to this timeframe (the last value in each candle), the newest OI_ROWS within 30 days, as Binance serves it
          const buckets = new Map<number, number>();
          for (const [t, v] of oi5) if (t <= at && t > at - 30 * DAY) buckets.set(Math.floor(t / tfMs) * tfMs, v);
          const oiRows = [...buckets.entries()].sort((a, b) => a[0] - b[0]).slice(-OI_ROWS).map(([timestamp, sumOpenInterest]) => ({ timestamp, sumOpenInterest }));
          const rel = oiRelative(oiRows, tfMs);
          ctx.oiChange6Pct = rel?.oiChange6Pct ?? null;
          ctx.oiExtreme = rel?.oiExtreme ?? null;
        }
        steps++;
        let r;
        try { r = def.detect(w, ctx); } catch { continue; }
        if (r.verdict === 'wait' || r.signalTimestamp == null || !r.signalDir) continue;
        const id = `${r.signalDir}:${r.signalTimestamp}`;
        if (seen.has(id)) continue;
        seen.add(id);
        count++;
        if (examples.length < 3) examples.push({ iso: new Date(r.signalTimestamp).toISOString(), dir: r.signalDir });
      }
      /* A strategy that never got enough candles to run once is not a silent strategy: the coin has too little history for it (a recent listing, a coarse timeframe). Reported as `no data`. */
      if (steps === 0) set(def.id, tf, { status: 'no data', count: 0, steps: 0, reason: `only ${all.length - first} walkable candles, ${all.length} in total, it needs ${def.minCandles}`, examples: [] });
      else set(def.id, tf, { status: 'ok', count, steps, ms: Math.round(performance.now() - t0), examples });
    }
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/${coin}.json`, JSON.stringify({ coin, symbol: sym ?? null, generatedAt: new Date().toISOString(), days, cells }, null, 1));
  console.log(`wrote ${out}/${coin}.json`);
}

/* ── merge ───────────────────────────────────────────────────────────────────────────────────────────────────── */
function merge(dir: string) {
  const files = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'matrix.json');
  const data = files.map(f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as { coin: string; cells: Record<string, Record<string, Cell>> });
  const order = AUDIT_COINS.filter(c => data.some(d => d.coin === c));
  const get = (coin: string) => data.find(d => d.coin === coin)!;
  const lines: string[] = [];
  const cellText = (c: Cell | undefined) => (!c ? '' : c.status === 'n/a' ? 'n/a' : c.status === 'no data' ? 'no data' : String(c.count));
  for (const tf of ALL_TFS) {
    lines.push(`\n### ${tf}  (n/a = unsupported by design, no data = no archived candles, 0 = supported and silent)\n`);
    lines.push(`| strategy | ${order.map(c => c.toUpperCase()).join(' | ')} |`);
    lines.push(`|---|${order.map(() => '---').join('|')}|`);
    for (const s of STRATEGIES) lines.push(`| ${s.id} | ${order.map(c => cellText(get(c).cells[s.id]?.[tf])).join(' | ')} |`);
  }
  const silent: string[] = [], nodata: string[] = [];
  for (const d of data) for (const s of STRATEGIES) {
    const tfs = Object.keys(d.cells[s.id] ?? {});
    const ok = tfs.filter(t => d.cells[s.id][t].status === 'ok');
    if (ok.length && ok.every(t => d.cells[s.id][t].count === 0)) silent.push(`${s.id} on ${d.coin} (${ok.join(', ')})`);
    if (tfs.some(t => d.cells[s.id][t].status === 'no data')) nodata.push(`${s.id} on ${d.coin}: ${[...new Set(tfs.filter(t => d.cells[s.id][t].status === 'no data').map(t => d.cells[s.id][t].reason))].join('; ')}`);
  }
  lines.push(`\n### Silent: supported, zero signals on every supported timeframe (${silent.length})\n`, ...silent.map(s => `- ${s}`));
  lines.push(`\n### No data (${nodata.length})\n`, ...nodata.slice(0, 80).map(s => `- ${s}`));
  const md = lines.join('\n');
  writeFileSync(`${dir}/matrix.md`, md);
  writeFileSync(`${dir}/matrix.json`, JSON.stringify(data, null, 1));
  console.log(md);
}

async function main() {
  const m = arg('merge');
  if (m) { merge(m); return; }
  const coin = arg('coin');
  if (!coin) throw new Error('--coin <id> or --merge <dir>');
  const tfs = (arg('tfs')?.split(',') ?? [...ALL_TFS]).map(s => s.trim());
  await auditCoin(coin, tfs, Number(arg('days') ?? 30), arg('out') ?? '.work/matrix');
}
main().catch(e => { console.error(e); process.exit(1); });
