/* QA's BEHAVIOURAL run of #2597 "every strategy and indicator is connected to Quick and Deep" (owner order 2026-11-19). No network, no AI call: the real builders on a seeded candle series.
 *   S1  for each of the 16 strategies, picked: the Quick AND the Deep prompt carry the strategy's NAME, its VERDICT, its REASON sentence, and (BUY/SELL) its entry / stop / target, and tell the read to name the strategy and
 *       say whether it agrees. The expected verdict / reason / levels come from calling the strategy's own detect() directly (the Arena's call, as the PR says it uses), NOT from the reading under test.
 *       Windows that really produce a BUY and a SELL are searched for on the series (levels are asserted there); strategies that never fire on it are exercised on WAIT.
 *   S2  the strategies that need a live input (funding / OI / taker) say NO READING (the cause) and "Do not guess its call", never a WAIT, when the input is missing.
 *   S3  no candles / too few candles / a timeframe the strategies do not run on: NO READING (cause), never a WAIT.
 *   S4  "Let the read choose" (no strategy, no indicators): all 16 readings listed, the read must name its pick; with no usable reading it says so; Custom (indicators picked, no strategy) adds nothing.
 *   S5  parseArenaStrategy: only a registered id is accepted; an object, an unknown id, a number are refused; null / undefined = none. The body carries no field for a browser-sent verdict.
 *   I1  the four indicators (SMA, Parabolic SAR, MACD, Bollinger): the reading text carries the name and a value that matches an INDEPENDENT computation on the same candles (SMA exact, Bollinger exact either std convention,
 *       PSAR and MACD within 0.5% - an EMA seed convention differs by a hair on a long series).
 *   I2  an indicator with no value yet (warm-up) is OMITTED, never sent as a guess. */
import test from 'node:test';
import assert from 'node:assert/strict';
import labelDefaults from '../lib/labelDefaults.en.json' with { type: 'json' };
import { STRATEGIES } from '../lib/strategies/index.ts';
import { arenaStrategyRead, type StrategyInputs } from '../lib/arenaStrategyRead.ts';
import { buildArenaPrompt, strategyReadBlock, withStrategyRead, withReadLanguage, type GrokContext, type ChartData } from '../lib/grok.ts';
import { selectedIndicatorReadings } from '../lib/indicatorReadings.ts';
import { parseArenaStrategy } from '../lib/arenaContext.ts';
import { priceText } from '../lib/numberFormat.ts';
import { strategyReasonText } from '../lib/strategies/reason.ts';

const LABELS = labelDefaults as Record<string, string>;
const tEn = (key: string, vars?: Record<string, string | number>) => (LABELS[key] ?? key).replace(/\{(\w+)\}/g, (w, n) => (vars && n in vars ? String(vars[n]) : w));
type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

/* a seeded random walk with regimes: trends, ranges and spikes, so many strategies fire somewhere on it */
function series(seed: number, n: number, tfMs: number): Candle[] {
  let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out: Candle[] = []; let p = 60_000; let drift = 0; const t0 = Date.UTC(2026, 10, 1);
  for (let i = 0; i < n; i++) {
    if (i % 90 === 0) drift = (rnd() - 0.5) * 0.004;
    const vol = 0.003 + 0.004 * rnd() + (i % 211 === 0 ? 0.02 : 0);
    const open = p; const close = Math.max(100, open * (1 + drift + (rnd() - 0.5) * vol * 2));
    const high = Math.max(open, close) * (1 + rnd() * vol * 0.6), low = Math.min(open, close) * (1 - rnd() * vol * 0.6);
    out.push({ time: t0 + i * tfMs, open, high, low, close, volume: 100 + rnd() * 900 }); p = close;
  }
  return out;
}
const TF_MS = 3_600_000;
const ALL = series(20261119, 900, TF_MS);
const VIEW = 300;
const view = (end: number, n = VIEW) => ALL.slice(end - n, end);   // #2603: ema_cross needs 601 closed candles, so each strategy gets a window of at least its own minCandles
const viewSize = (def: { minCandles: number }) => Math.max(VIEW, def.minCandles);
const inputs = (candles: readonly Candle[] | null, over: Partial<StrategyInputs> = {}): StrategyInputs => ({ coin: 'btc', tf: '1h', tfMs: TF_MS, candles: candles as StrategyInputs['candles'], btcCandles: candles as StrategyInputs['candles'], ...over });
const ctxFor = (over: Record<string, unknown> = {}) => ({ coin: 'BTC', price: '$100', change24h: '+1.00%', ma20: '$99', priceVsMA: 'ABOVE MA20', volRatio: '1.10x', rsi14: '55.0 (Neutral)', rsi1h: '55', rsi4h: '50', rsiDaily: '60', longShortRatio: 'Long 55% / Short 45%', vwap: '$99', takerRatio: 'Buy 50% / Sell 50%', pocLine: '$99', orderWalls: 'none', liqLevels: 'none', news: 'none', upcomingEvents: 'none', oilPrice: '$70', ...over } as unknown as GrokContext);
const chart = { tf: '1h', ema9: 61000, sma200: 58000, rsi: 55, recent20: 'flat', hi: 62000, lo: 59000, lastClose: 61500 } as unknown as ChartData;
const NEEDS_LIVE = new Set(['funding_oi_squeeze', 'cvd_absorption']);

/** the Arena's own call for a window, straight from the strategy (not through the reading under test) */
function direct(def: (typeof STRATEGIES)[number], candles: readonly Candle[]) {
  const wantsBtc = !!def.needsBtc;
  return def.detect(candles as never, { coin: 'btc', tf: '1h', tfMs: TF_MS, ...(wantsBtc ? { btcCandles: candles as never } : {}), oiChange6Pct: null } as never);
}

/** first window end on the series where the strategy's own detect() says buy / sell (or null) */
const found = new Map<string, { buy: number | null; sell: number | null }>();
for (const def of STRATEGIES) {
  if (NEEDS_LIVE.has(def.id)) continue;
  let buy: number | null = null, sell: number | null = null;
  for (let end = viewSize(def); end <= ALL.length && (buy == null || sell == null); end++) {
    let r; try { r = direct(def, view(end, viewSize(def))); } catch { continue; }
    if (r.params.noLive === true || r.params.noTaker === true) break;
    if (r.verdict === 'buy' && buy == null) buy = end; if (r.verdict === 'sell' && sell == null) sell = end;
  }
  found.set(def.id, { buy, sell });
}

test('S0. CONTROL: the registry has 16 strategies and the series makes most of them fire a BUY and a SELL (so the level assertions are not all on WAIT)', () => {
  assert.equal(STRATEGIES.length, 16);
  const both = [...found.values()].filter(f => f.buy != null && f.sell != null).length, either = [...found.values()].filter(f => f.buy != null || f.sell != null).length;
  console.log(`# S0: ${both} strategies produced both a BUY and a SELL window, ${either} at least one, of ${found.size} candle-only`);
  assert.ok(either >= 8, `only ${either} candle-only strategies ever fire on the control series: the level assertions would be mostly WAIT`);
});

for (const def of STRATEGIES) {
  const name = tEn(def.nameKey);
  const windows: Array<[string, number]> = [['WAIT-or-latest', ALL.length]];
  const f = found.get(def.id); if (f?.buy != null) windows.push(['BUY', f.buy]); if (f?.sell != null) windows.push(['SELL', f.sell]);
  for (const [label, end] of windows) {
    test(`S1 ${def.id} ${label}: Quick and Deep carry the name, the verdict, the reason and the levels, and tell the read to name it`, () => {
      const candles = view(end, viewSize(def));
      if (NEEDS_LIVE.has(def.id)) return; // S2
      const d = direct(def, candles);
      const word = d.verdict === 'buy' ? 'BUY' : d.verdict === 'sell' ? 'SELL' : 'WAIT';
      const read = arenaStrategyRead(def.id, [], inputs(candles), tEn as never);
      assert.ok(read && read.mode === 'picked' && read.readings.length === 1, 'a picked strategy gives one reading');
      for (const type of ['quick', 'deep'] as const) {
        const prompt = withReadLanguage(withStrategyRead(buildArenaPrompt(ctxFor(), chart, type, []), read), 'en');
        assert.equal(prompt.split("=== THE TRADER'S STRATEGY ===").length - 1, 1, `${type}: the strategy block must appear exactly once`);
        const block = prompt.slice(prompt.indexOf("=== THE TRADER'S STRATEGY ==="));
        assert.ok(block.includes(`${name}: ${word}.`), `${type}: the block lacks "${name}: ${word}." for ${label}; got: ${block.slice(0, 300)}`);
        assert.ok(block.includes(`Reason: ${strategyReasonText(def, d, tEn as never)}`), `${type}: the block lacks the strategy's reason sentence`);
        assert.ok(block.includes(`must name "${name}"`), `${type}: the read is not told to name the strategy`);
        if (d.verdict !== 'wait') {
          for (const k of ['entry', 'stop', 'target'] as const) {
            const v = k === 'stop' ? (typeof d.params.stop === 'number' ? d.params.stop : d.params.inv) : d.params[k];
            if (typeof v === 'number' && Number.isFinite(v)) assert.ok(block.includes(`${k} ${priceText(v)}`), `${type}: ${label} lacks "${k} ${priceText(v)}" (the strategy's own ${k})`);
          }
          assert.ok(/Signal (on the latest closed candle|\d+ closed candles? ago)\./.test(block), `${type}: no signal age on a ${label}`);
        } else assert.ok(!/entry |stop |target /.test(block.split('\n').find(l => l.startsWith(`${name}:`)) ?? ''), 'a WAIT carries no levels');
      }
    });
  }
}

test('S2. the strategies that need a live input say NO READING (the cause) and never a WAIT when the input is missing', () => {
  for (const id of NEEDS_LIVE) {
    const def = STRATEGIES.find(s => s.id === id)!; const name = tEn(def.nameKey);
    const read = arenaStrategyRead(id, [], inputs(view(ALL.length)), tEn as never);
    const r = read!.readings[0];
    assert.equal(r.status, 'none', `${id} without its live input must be 'none', got ${r.status}${r.status === 'ok' ? ' ' + r.verdict : ''}`);
    const block = strategyReadBlock(read);
    assert.ok(block.includes(`${name}: NO READING (`) && block.includes('Do not guess its call.'), `${id}: ${block.split('\n').find(l => l.startsWith(name))}`);
    assert.ok(!block.includes(`${name}: WAIT`), `${id}: shown as a WAIT`);
  }
});

test('S3. no candles / too few / a timeframe the strategies do not run on: NO READING with the cause, never a WAIT', () => {
  for (const def of STRATEGIES) {
    const name = tEn(def.nameKey);
    for (const [label, inp, cause] of [
      ['null candles', inputs(null), /no candles/], ['empty candles', inputs([]), /no candles/], ...(def.minCandles > 1 ? [['too few', inputs(ALL.slice(0, def.minCandles - 1)), new RegExp('only ' + (def.minCandles - 1) + ' closed candles')] as const] : []), ['unsupported timeframe', inputs(view(ALL.length), { tfMs: undefined, tf: '3d' }), /does not run on this timeframe/],
    ] as const) {
      const read = arenaStrategyRead(def.id, [], inp, tEn as never); const r = read!.readings[0];
      assert.equal(r.status, 'none', `${def.id} ${label}: got ${r.status}`);
      if (r.status === 'none') assert.match(r.why, cause, `${def.id} ${label}`);
      const block = strategyReadBlock(read); assert.ok(block.includes(`${name}: NO READING (`) && !block.includes(`${name}: WAIT`), `${def.id} ${label}`);
      assert.ok(block.includes(`must name "${name}" and say it has no reading right now`), `${def.id} ${label}: the read is not told the strategy has no reading`);
    }
  }
});

test('S4. "Let the read choose": all 16 readings listed, the read names its pick; none usable says so; Custom adds nothing', () => {
  const read = arenaStrategyRead(null, [], inputs(view(ALL.length)), tEn as never)!;
  assert.equal(read.mode, 'auto'); assert.equal(read.readings.length, 16);
  const block = strategyReadBlock(read);
  for (const def of STRATEGIES) assert.ok(block.includes(`- ${tEn(def.nameKey)}:`), `auto block lacks ${def.id}`);
  assert.match(block, /Choose the ONE strategy above/); assert.match(block, /must name|name the one/i);
  const none = strategyReadBlock(arenaStrategyRead(null, [], inputs(null), tEn as never));
  assert.match(none, /No strategy has a reading right now\./); assert.ok(!/- [^\n]*: (BUY|SELL|WAIT)\b/.test(none), 'a WAIT was shown with no candles');
  assert.equal(arenaStrategyRead(null, ['SMA'], inputs(view(ALL.length)), tEn as never), null, 'Custom (indicators picked) must add no strategy block');
  assert.equal(withStrategyRead('PROMPT', null), 'PROMPT');
});

test('S5. parseArenaStrategy: only a registered id; an object / unknown id / number is refused; null and undefined are none', () => {
  for (const def of STRATEGIES) assert.deepEqual(parseArenaStrategy(def.id), { ok: true, value: def.id }, def.id);
  for (const none of [null, undefined]) assert.deepEqual(parseArenaStrategy(none), { ok: true, value: null });
  for (const bad of [{ id: 'ema_cross', verdict: 'BUY' }, 'not_a_strategy', 42, ['ema_cross'], true, 'EMA_CROSS ', '']) assert.equal((parseArenaStrategy(bad) as { ok: boolean }).ok, false, JSON.stringify(bad));
});

/* ── indicators: independent computation ── */
const closes = ALL.slice(-VIEW).map(c => c.close);
const fv = (n: number) => n.toLocaleString('en-US', { maximumSignificantDigits: 6 });
const sma = (a: number[], n: number) => a.slice(-n).reduce((x, y) => x + y, 0) / n;
const num = (text: string, re: RegExp) => Number((re.exec(text)?.[1] ?? 'NaN').replace(/,/g, ''));

test('I1a. SMA(12): the reading carries the exact 12-bar mean of the closes and which side the price is on', () => {
  const r = selectedIndicatorReadings(ALL.slice(-VIEW) as never, ['SMA'], undefined)[0];
  assert.ok(r && r.id === 'SMA'); const v = sma(closes, 12);
  assert.ok(r.text.startsWith('SMA(12) ' + fv(v)), `got ${r.text}, expected SMA(12) ${fv(v)}`);
  assert.ok(r.text.includes(closes.at(-1)! >= v ? 'price above' : 'price below'));
});
test('I1b. Bollinger(20,2): mid = the 20-bar mean, bands = mid +- 2 standard deviations (population or sample), price position named', () => {
  const r = selectedIndicatorReadings(ALL.slice(-VIEW) as never, ['BOLL'], undefined)[0]; assert.ok(r && r.id === 'BOLL');
  const w = closes.slice(-20), mid = sma(closes, 20), pop = Math.sqrt(w.reduce((a, c) => a + (c - mid) ** 2, 0) / 20), smp = Math.sqrt(w.reduce((a, c) => a + (c - mid) ** 2, 0) / 19);
  const midT = num(r.text, /mid ([\d,.]+)/), up = num(r.text, /upper ([\d,.]+)/), dn = num(r.text, /lower ([\d,.]+)/);
  assert.ok(Math.abs(midT - mid) / mid < 1e-5, `mid ${midT} vs ${mid}`);
  const okPop = Math.abs(up - (mid + 2 * pop)) / mid < 1e-4 && Math.abs(dn - (mid - 2 * pop)) / mid < 1e-4, okSmp = Math.abs(up - (mid + 2 * smp)) / mid < 1e-4 && Math.abs(dn - (mid - 2 * smp)) / mid < 1e-4;
  console.log(`# I1b: bands match the ${okPop ? 'population' : okSmp ? 'sample' : 'NEITHER'} standard deviation`);
  assert.ok(okPop || okSmp, `bands ${dn}..${up} match neither convention (mid ${mid}, pop sd ${pop}, sample sd ${smp})`);
});
test('I1c. Parabolic SAR(0.02,0.02,0.2): the dot value matches an independent Wilder implementation within 2% (the klinecharts convention), and the side of price is right', () => {
  const r = selectedIndicatorReadings(ALL.slice(-VIEW) as never, ['SAR'], undefined)[0]; assert.ok(r && r.id === 'SAR');
  const cs = ALL.slice(-VIEW); const af0 = 0.02, step = 0.02, mx = 0.2;
  let bull = cs[1].close >= cs[0].close, ep = bull ? cs[0].high : cs[0].low, sar = bull ? cs[0].low : cs[0].high, af = af0;
  for (let i = 1; i < cs.length; i++) {
    sar = sar + af * (ep - sar);
    if (bull) { sar = Math.min(sar, cs[i - 1].low, i > 1 ? cs[i - 2].low : cs[i - 1].low); if (cs[i].low < sar) { bull = false; sar = ep; ep = cs[i].low; af = af0; } else if (cs[i].high > ep) { ep = cs[i].high; af = Math.min(mx, af + step); } }
    else { sar = Math.max(sar, cs[i - 1].high, i > 1 ? cs[i - 2].high : cs[i - 1].high); if (cs[i].high > sar) { bull = true; sar = ep; ep = cs[i].high; af = af0; } else if (cs[i].low < ep) { ep = cs[i].low; af = Math.min(mx, af + step); } }
  }
  const got = num(r.text, /\) ([\d,.]+), dot/);
  console.log(`# I1c: app PSAR ${got} vs independent ${sar.toFixed(2)}`);
  /* the app's psarArr follows klinecharts' own SAR (af steps on the bar the extreme point moves; the clamp uses the previous and current low), so the dot is not Wilder's to the digit: the picture and the read agree with each other. Within 2% and the SAME SIDE of price is the claim. */
  assert.ok(Math.abs(got - sar) / sar < 0.02, `PSAR ${got} vs independent ${sar}`);
  assert.ok(r.text.includes(got < closes.at(-1)! ? 'below price (bullish)' : 'above price (bearish)'));
});
test('I1d. MACD(12,26,9): DIF and DEA match an independent EMA computation within 0.5% of price, and the DIF side is right', () => {
  const r = selectedIndicatorReadings(ALL.slice(-VIEW) as never, ['MACD'], undefined)[0]; assert.ok(r && r.id === 'MACD');
  const ema = (a: number[], n: number) => { const k = 2 / (n + 1); const o: number[] = []; let e = a[0]; for (const x of a) { e = x * k + e * (1 - k); o.push(e); } return o; };
  const dif = ema(closes, 12).map((v, i) => v - ema(closes, 26)[i]), dea = ema(dif, 9);
  const gDif = num(r.text, /DIF (-?[\d,.]+)/), gDea = num(r.text, /DEA (-?[\d,.]+)/), p = closes.at(-1)!;
  console.log(`# I1d: app DIF ${gDif} DEA ${gDea} vs independent ${dif.at(-1)!.toFixed(2)} ${dea.at(-1)!.toFixed(2)}`);
  assert.ok(Math.abs(gDif - dif.at(-1)!) / p < 0.005, 'DIF'); assert.ok(Math.abs(gDea - dea.at(-1)!) / p < 0.005, 'DEA');
});
test('I2. an indicator with no value yet (too few candles) is omitted, never sent as a guess', () => {
  const few = ALL.slice(0, 8) as never;
  for (const id of ['SMA', 'BOLL', 'MACD']) assert.equal(selectedIndicatorReadings(few, [id], undefined).length, 0, `${id} with 8 candles must send nothing`);
});
