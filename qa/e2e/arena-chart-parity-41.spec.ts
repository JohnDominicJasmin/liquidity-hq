/* QA #1263 owner item 41, on a DEPLOYED site, GETs only: the chart half of an AI read as the browser builds it (the site's klines route, the Arena's own source for the coin) against the same builder fed the candles the
 * server version reads (Binance futures), taken at the same moment. The one builder (lib/arenaChartServer.ts, a line-for-line mirror of the Arena) is used for both, so every difference is the data's. Prints [P41] lines. */
import { test } from '@playwright/test';
import { chartFromCandles } from '../../lib/arenaChartServer';
import { binanceKlineSource } from '../../lib/coins';
import { BINANCE_SYMS } from '../../lib/coins';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
type Row = (string | number)[];
const candles = (raw: Row[]) => raw.map((k) => ({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
const pct = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? '-' : `${(((a - b) / b) * 100).toFixed(3)}%`);

test('P41 browser chart data against server chart data', async ({ request }) => {
  test.setTimeout(420_000);
  for (const coin of ['btc', 'eth', 'sol', 'doge', 'spx']) for (const tf of ['15m', '1h', '4h', '1d']) {
    const sym = (BINANCE_SYMS as Record<string, string>)[coin];
    const read = async (source: string) => { const r = await request.get(`/api/market/klines?source=${source}&symbol=${sym}&interval=${tf}&limit=300`, { timeout: 60_000 }); return r.ok() ? (await r.json()) as Row[] : null; };
    const source = binanceKlineSource(coin);
    const [b, s] = await Promise.all([read(source), read('binance-futures')]);
    if (!b || !s) { console.log(`[P41] ${coin} ${tf}: no answer (browser ${source} ${!!b}, futures ${!!s})`); continue; }
    const bc = chartFromCandles(tf, candles(b)), sc = chartFromCandles(tf, candles(s));
    if (!bc || !sc) { console.log(`[P41] ${coin} ${tf}: too few candles`); continue; }
    const bv = candles(b).slice(-15, -1), sv = candles(s).slice(-15, -1);
    const sameTimes = bv.every((c, i) => c.time === sv[i].time);
    const maxClose = Math.max(...bv.map((c, i) => Math.abs((sv[i].close - c.close) / c.close) * 100));
    const volRatio = sv.reduce((a, c) => a + c.volume, 0) / Math.max(1e-9, bv.reduce((a, c) => a + c.volume, 0));
    console.log(`[P41] ${coin} ${tf} browser=${source}: ema9 ${pct(sc.ema9, bc.ema9)} sma200 ${pct(sc.sma200, bc.sma200)} rsi ${bc.rsi?.toFixed(1)} vs ${sc.rsi?.toFixed(1)} hi ${pct(sc.hi, bc.hi)} lo ${pct(sc.lo, bc.lo)} last ${pct(sc.lastClose, bc.lastClose)} | 14 closed candles: same times=${sameTimes} widest close gap ${maxClose.toFixed(3)}% volume server/browser ${volRatio.toFixed(2)}x | patterns same=${(bc.detectedPatterns ?? '') === (sc.detectedPatterns ?? '')}${(bc.detectedPatterns ?? '') === (sc.detectedPatterns ?? '') ? '' : ` [browser: ${bc.detectedPatterns ?? 'none'} | server: ${sc.detectedPatterns ?? 'none'}]`}`);
  }
});
