import { NextResponse } from 'next/server';

function emaArr(closes: number[], period: number): number[] {
  const result = new Array<number>(closes.length).fill(NaN);
  if (closes.length < period) return result;
  const k = 2 / (period + 1);
  let e = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = e;
  for (let i = period; i < closes.length; i++) {
    e = closes[i] * k + e * (1 - k);
    result[i] = e;
  }
  return result;
}

function rsiArr(closes: number[], period = 14): number[] {
  const result = new Array<number>(closes.length).fill(NaN);
  if (closes.length < period + 1) return result;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export interface SignalStat {
  name:       string;
  label:      string;   // short display label
  timeframe:  string;
  direction:  'long' | 'short';
  count:      number;
  accuracy3:  number;   // % wins at +3 candles
  accuracy6:  number;   // % wins at +6 candles
  avgReturn3: number;   // avg % return at +3 candles
  avgReturn6: number;   // avg % return at +6 candles
}

export async function GET() {
  try {
    const r = await fetch(
      'https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=240&limit=300',
      { next: { revalidate: 600 } }
    );
    if (!r.ok) throw new Error(`Bybit ${r.status}`);
    const json = await r.json();
    const raw: string[][] = json.result?.list ?? [];
    if (raw.length < 60) throw new Error('insufficient data');

    // Bybit returns newest first — reverse to chronological
    const candles = [...raw].reverse();
    const closes  = candles.map(c => parseFloat(c[4]));

    const e9  = emaArr(closes, 9);
    const e20 = emaArr(closes, 20);
    const e50 = emaArr(closes, 50);
    const rsi = rsiArr(closes, 14);

    const stats: SignalStat[] = [];

    // ── Signal 1: EMA bullish cross (EMA9 crosses above EMA20, EMA20 > EMA50) ──
    {
      let wins3 = 0, wins6 = 0, sumR3 = 0, sumR6 = 0, count = 0;
      for (let i = 51; i < closes.length - 6; i++) {
        const cross = e9[i - 1] <= e20[i - 1] && e9[i] > e20[i];
        if (!cross || e20[i] <= e50[i]) continue;
        count++;
        const r3 = (closes[i + 3] - closes[i]) / closes[i] * 100;
        const r6 = (closes[i + 6] - closes[i]) / closes[i] * 100;
        if (r3 > 0) wins3++;
        if (r6 > 0) wins6++;
        sumR3 += r3; sumR6 += r6;
      }
      if (count > 0) stats.push({
        name: 'ema_bull_cross', label: 'EMA Bull Cross', timeframe: '4H',
        direction: 'long', count,
        accuracy3:  Math.round(wins3 / count * 100),
        accuracy6:  Math.round(wins6 / count * 100),
        avgReturn3: parseFloat((sumR3 / count).toFixed(2)),
        avgReturn6: parseFloat((sumR6 / count).toFixed(2)),
      });
    }

    // ── Signal 2: EMA bearish cross (EMA9 crosses below EMA20, EMA20 < EMA50) ──
    {
      let wins3 = 0, wins6 = 0, sumR3 = 0, sumR6 = 0, count = 0;
      for (let i = 51; i < closes.length - 6; i++) {
        const cross = e9[i - 1] >= e20[i - 1] && e9[i] < e20[i];
        if (!cross || e20[i] >= e50[i]) continue;
        count++;
        const r3 = (closes[i] - closes[i + 3]) / closes[i] * 100; // short = down is win
        const r6 = (closes[i] - closes[i + 6]) / closes[i] * 100;
        if (r3 > 0) wins3++;
        if (r6 > 0) wins6++;
        sumR3 += r3; sumR6 += r6;
      }
      if (count > 0) stats.push({
        name: 'ema_bear_cross', label: 'EMA Bear Cross', timeframe: '4H',
        direction: 'short', count,
        accuracy3:  Math.round(wins3 / count * 100),
        accuracy6:  Math.round(wins6 / count * 100),
        avgReturn3: parseFloat((sumR3 / count).toFixed(2)),
        avgReturn6: parseFloat((sumR6 / count).toFixed(2)),
      });
    }

    // ── Signal 3: RSI oversold exit (RSI crosses back above 30 from below) ──
    {
      let wins3 = 0, wins6 = 0, sumR3 = 0, sumR6 = 0, count = 0;
      for (let i = 15; i < closes.length - 6; i++) {
        if (isNaN(rsi[i]) || isNaN(rsi[i - 1])) continue;
        const crossUp = rsi[i - 1] < 30 && rsi[i] >= 30;
        if (!crossUp) continue;
        count++;
        const r3 = (closes[i + 3] - closes[i]) / closes[i] * 100;
        const r6 = (closes[i + 6] - closes[i]) / closes[i] * 100;
        if (r3 > 0) wins3++;
        if (r6 > 0) wins6++;
        sumR3 += r3; sumR6 += r6;
      }
      if (count > 0) stats.push({
        name: 'rsi_oversold', label: 'RSI Oversold Exit', timeframe: '4H',
        direction: 'long', count,
        accuracy3:  Math.round(wins3 / count * 100),
        accuracy6:  Math.round(wins6 / count * 100),
        avgReturn3: parseFloat((sumR3 / count).toFixed(2)),
        avgReturn6: parseFloat((sumR6 / count).toFixed(2)),
      });
    }

    // ── Signal 4: RSI overbought exit (RSI crosses back below 70 from above) ──
    {
      let wins3 = 0, wins6 = 0, sumR3 = 0, sumR6 = 0, count = 0;
      for (let i = 15; i < closes.length - 6; i++) {
        if (isNaN(rsi[i]) || isNaN(rsi[i - 1])) continue;
        const crossDown = rsi[i - 1] > 70 && rsi[i] <= 70;
        if (!crossDown) continue;
        count++;
        const r3 = (closes[i] - closes[i + 3]) / closes[i] * 100;
        const r6 = (closes[i] - closes[i + 6]) / closes[i] * 100;
        if (r3 > 0) wins3++;
        if (r6 > 0) wins6++;
        sumR3 += r3; sumR6 += r6;
      }
      if (count > 0) stats.push({
        name: 'rsi_overbought', label: 'RSI Overbought Exit', timeframe: '4H',
        direction: 'short', count,
        accuracy3:  Math.round(wins3 / count * 100),
        accuracy6:  Math.round(wins6 / count * 100),
        avgReturn3: parseFloat((sumR3 / count).toFixed(2)),
        avgReturn6: parseFloat((sumR6 / count).toFixed(2)),
      });
    }

    // ── Signal 5: EMA alignment long (EMA9 > EMA20 > EMA50 — trend confirmation) ──
    {
      let wins3 = 0, wins6 = 0, sumR3 = 0, sumR6 = 0, count = 0;
      for (let i = 51; i < closes.length - 6; i++) {
        // Only count first candle of a new alignment streak
        const aligned    = e9[i] > e20[i] && e20[i] > e50[i];
        const wasAligned = e9[i - 1] > e20[i - 1] && e20[i - 1] > e50[i - 1];
        if (!aligned || wasAligned) continue;
        count++;
        const r3 = (closes[i + 3] - closes[i]) / closes[i] * 100;
        const r6 = (closes[i + 6] - closes[i]) / closes[i] * 100;
        if (r3 > 0) wins3++;
        if (r6 > 0) wins6++;
        sumR3 += r3; sumR6 += r6;
      }
      if (count > 0) stats.push({
        name: 'ema_align_long', label: 'EMA Aligned Long', timeframe: '4H',
        direction: 'long', count,
        accuracy3:  Math.round(wins3 / count * 100),
        accuracy6:  Math.round(wins6 / count * 100),
        avgReturn3: parseFloat((sumR3 / count).toFixed(2)),
        avgReturn6: parseFloat((sumR6 / count).toFixed(2)),
      });
    }

    return NextResponse.json({ stats, candles: closes.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed' },
      { status: 500 }
    );
  }
}
