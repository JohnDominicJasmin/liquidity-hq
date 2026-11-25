import { emaArr, smaArr, bollingerBandsArr, psarArr, macdArr, type OHLCV } from './strategyCore.ts';
import { rsiArr } from './divergence.ts';
import { notEnoughMovement } from './deadSeries.ts';

/* THE SELECTED INDICATORS' LATEST VALUES, FOR THE AI READ (#1631). Moved out of lib/useEMAStrategy.ts unchanged (owner order 2026-11-19: every
 * indicator reaches Quick and Deep) so the wording can be produced and checked outside the React hook; the hook calls this with the same candles.
 *
 * A value-bearing selected indicator is one that both was picked and has a finite reading on the latest bar. A warm-up bar (no value yet) is
 * OMITTED, never sent as a guess: the read must not be told to weigh a number we do not have. bollingerBandsArr returns {mid, up, dn} (not
 * upper/lower) and its elements can be null, hence the field names and the null guards. price is the latest candle's close.
 *
 * THE READINGS USE THE TRADER'S OWN SETTINGS and say so ("RSI(21) 38.2"), owner 2026-11-17. The ribbon verdict and its gates keep the standard
 * settings, so a strategy signal never depends on what a trader typed into a box. A saved value is clamped like the chart clamps it, and a
 * missing or non-numeric one falls to the default. */
export type IndicatorParams = Readonly<Record<string, Readonly<Record<string, string | number | boolean>>>>;

export function selectedIndicatorReadings(candles: readonly OHLCV[], selection: readonly string[], ip: IndicatorParams | undefined): Array<{ id: string; text: string }> {
  const cl4 = candles.map(c => c.close);
  const price = cl4[cl4.length - 1];
  const fvNum = (n: number) => n.toLocaleString('en-US', { maximumSignificantDigits: 6 });
  const selectedReadings: Array<{ id: string; text: string }> = [];
  if (notEnoughMovement(candles)) return selectedReadings;   // nothing to weigh on a series that did not move (#1651)
  const pn = (id: string, key: string, def: number, lo: number, hi: number) => {
    const v = ip?.[id]?.[key]; const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
  };
  const pi = (id: string, key: string, def: number, lo: number, hi: number) => Math.round(pn(id, key, def, lo, hi));
  if (selection.includes('SMA')) {
    const len = pi('SMA', 'length', 12, 2, 400);
    const v = smaArr(cl4, len).at(-1);
    if (v != null && isFinite(v)) selectedReadings.push({ id: 'SMA', text: `SMA(${len}) ${fvNum(v)}, price ${price >= v ? 'above' : 'below'}` });
  }
  if (selection.includes('BOLL')) {
    const len = pi('BOLL', 'length', 20, 2, 400), mult = pn('BOLL', 'mult', 2, 0.5, 5);
    const b = bollingerBandsArr(cl4, len, mult).at(-1);
    if (b != null) {
      const pos = price > b.up ? 'above the upper band'
        : price < b.dn ? 'below the lower band'
        : price >= b.mid ? 'between mid and upper' : 'between lower and mid';
      selectedReadings.push({ id: 'BOLL', text: `Bollinger(${len},${mult}) mid ${fvNum(b.mid)} upper ${fvNum(b.up)} lower ${fvNum(b.dn)}, price ${pos}` });
    }
  }
  if (selection.includes('SAR')) {
    const st = pn('SAR', 'start', 0.02, 0.001, 1), sp = pn('SAR', 'step', 0.02, 0.001, 1), mx = pn('SAR', 'max', 0.2, 0.01, 1);
    const v = psarArr(candles as OHLCV[], st, sp, mx).at(-1);
    if (v != null && isFinite(v)) selectedReadings.push({ id: 'SAR', text: `PSAR(${st},${sp},${mx}) ${fvNum(v)}, dot ${v < price ? 'below price (bullish)' : 'above price (bearish)'}` });
  }
  if (selection.includes('MACD')) {
    const f = pi('MACD', 'fast', 12, 2, 400), s = pi('MACD', 'slow', 26, 2, 400), g = pi('MACD', 'signal', 9, 2, 400);
    const m = macdArr(cl4, f, s, g).at(-1);
    if (m != null && isFinite(m.dif) && isFinite(m.dea)) selectedReadings.push({ id: 'MACD', text: `MACD(${f},${s},${g}) DIF ${fvNum(m.dif)} / DEA ${fvNum(m.dea)}, DIF ${m.dif >= m.dea ? 'above (bullish)' : 'below (bearish)'} DEA` });
  }
  /* RSI and the EMA ribbon are chart layers, not chips, so they are in the read only when the trader changed their settings (a reading at the standard 14 / 9-20-50-200 is already in the read's own fields, so repeating it would only add words). */
  const rsiLenU = pi('RSI', 'length', 14, 2, 100), rsiObU = pi('RSI', 'overbought', 70, 50, 95), rsiOsU = pi('RSI', 'oversold', 30, 5, 50);
  if (rsiLenU !== 14 || rsiObU !== 70 || rsiOsU !== 30) {
    const r = rsiArr(cl4, rsiLenU).at(-1);
    if (r != null && isFinite(r)) selectedReadings.push({ id: 'RSI', text: `RSI(${rsiLenU}) ${r.toFixed(1)} (overbought line ${rsiObU}, oversold line ${rsiOsU}): ${r >= rsiObU ? 'overbought' : r <= rsiOsU ? 'oversold' : 'between the lines'}` });
  }
  const emaLens = [pi('EMA_RIBBON', 'e1', 9, 2, 400), pi('EMA_RIBBON', 'e2', 20, 2, 400), pi('EMA_RIBBON', 'e3', 50, 2, 400), pi('EMA_RIBBON', 'e4', 200, 2, 400)];
  if (emaLens.join(',') !== '9,20,50,200') {
    const parts = emaLens.flatMap(n => { const v = emaArr(cl4, n).at(-1); return v != null && isFinite(v) ? [`EMA(${n}) ${fvNum(v)}`] : []; });
    const longest = emaArr(cl4, emaLens[3]).at(-1);
    if (parts.length) selectedReadings.push({ id: 'EMA_RIBBON', text: `EMA ribbon at the trader's lengths: ${parts.join(', ')}${longest != null && isFinite(longest) ? `, price ${price >= longest ? 'above' : 'below'} the longest` : ''}` });
  }
  return selectedReadings;
}
