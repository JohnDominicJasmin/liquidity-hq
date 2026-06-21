import { NextResponse } from 'next/server';

export interface CyclePoint { day: number; ratio: number; }

export interface CycleData {
  '2016': CyclePoint[];
  '2020': CyclePoint[];
  '2024': CyclePoint[];
  currentDay: number;
}

// Pre-sampled biweekly price ratios (price / halving-day price).
// 2016 halving: Jul 9 2016 ~$650; ATH Dec 2017 ~$19800 (30x); trough Dec 2018 ~$3200 (5x)
const CYCLE_2016: CyclePoint[] = [
  {day:0,ratio:1.0},{day:14,ratio:0.92},{day:28,ratio:0.91},{day:42,ratio:0.93},
  {day:56,ratio:0.94},{day:70,ratio:0.96},{day:84,ratio:0.97},{day:98,ratio:1.0},
  {day:112,ratio:1.05},{day:126,ratio:1.1},{day:140,ratio:1.15},{day:154,ratio:1.2},
  {day:168,ratio:1.25},{day:182,ratio:1.38},{day:196,ratio:1.46},{day:210,ratio:1.54},
  {day:224,ratio:1.62},{day:238,ratio:1.7},{day:252,ratio:1.85},{day:266,ratio:2.1},
  {day:280,ratio:2.4},{day:294,ratio:2.7},{day:308,ratio:3.0},{day:322,ratio:3.5},
  {day:336,ratio:3.85},{day:350,ratio:3.9},{day:364,ratio:4.3},{day:378,ratio:5.2},
  {day:392,ratio:5.7},{day:406,ratio:6.2},{day:420,ratio:6.8},{day:434,ratio:8.4},
  {day:448,ratio:9.2},{day:462,ratio:9.5},{day:476,ratio:11.5},{day:490,ratio:14.6},
  {day:504,ratio:19.0},{day:518,ratio:27.0},{day:532,ratio:30.2},{day:546,ratio:24.0},
  {day:560,ratio:19.2},{day:574,ratio:14.0},{day:588,ratio:13.1},{day:602,ratio:12.8},
  {day:616,ratio:12.0},{day:630,ratio:11.5},{day:644,ratio:11.0},{day:658,ratio:11.0},
  {day:672,ratio:10.5},{day:686,ratio:10.8},{day:700,ratio:11.5},{day:714,ratio:10.8},
  {day:728,ratio:10.3},{day:742,ratio:10.0},{day:756,ratio:9.8},{day:770,ratio:9.5},
  {day:784,ratio:8.5},{day:798,ratio:7.5},{day:812,ratio:6.5},{day:826,ratio:6.9},
  {day:840,ratio:5.8},{day:854,ratio:5.2},{day:868,ratio:4.9},{day:882,ratio:5.0},
  {day:896,ratio:5.3},{day:910,ratio:5.7},{day:924,ratio:6.0},{day:938,ratio:7.2},
  {day:952,ratio:7.7},{day:966,ratio:8.5},{day:980,ratio:10.0},{day:994,ratio:12.0},
  {day:1008,ratio:16.5},{day:1022,ratio:18.5},{day:1036,ratio:15.5},{day:1050,ratio:14.8},
  {day:1064,ratio:14.0},{day:1078,ratio:13.5},{day:1092,ratio:12.8},{day:1100,ratio:12.3},
];

// 2020 halving: May 11 2020 ~$8700; ATH Nov 2021 ~$69000 (7.9x) at day ~548; trough Nov 2022 ~$15500 (1.78x)
const CYCLE_2020: CyclePoint[] = [
  {day:0,ratio:1.0},{day:14,ratio:1.05},{day:28,ratio:1.05},{day:42,ratio:1.06},
  {day:56,ratio:1.06},{day:70,ratio:1.08},{day:84,ratio:1.06},{day:98,ratio:1.12},
  {day:112,ratio:1.3},{day:126,ratio:1.25},{day:140,ratio:1.32},{day:154,ratio:1.42},
  {day:168,ratio:1.62},{day:182,ratio:1.95},{day:196,ratio:2.5},{day:210,ratio:2.99},
  {day:224,ratio:3.2},{day:238,ratio:3.35},{day:252,ratio:4.2},{day:266,ratio:5.5},
  {day:280,ratio:6.3},{day:294,ratio:7.0},{day:308,ratio:6.2},{day:322,ratio:5.5},
  {day:336,ratio:5.0},{day:350,ratio:4.6},{day:364,ratio:4.1},{day:378,ratio:3.7},
  {day:392,ratio:3.6},{day:406,ratio:4.5},{day:420,ratio:4.8},{day:434,ratio:4.9},
  {day:448,ratio:5.5},{day:462,ratio:6.0},{day:476,ratio:6.4},{day:490,ratio:6.0},
  {day:504,ratio:6.6},{day:518,ratio:7.0},{day:532,ratio:7.6},{day:546,ratio:7.9},
  {day:560,ratio:7.0},{day:574,ratio:6.6},{day:588,ratio:5.8},{day:602,ratio:5.2},
  {day:616,ratio:5.0},{day:630,ratio:5.2},{day:644,ratio:4.8},{day:658,ratio:4.5},
  {day:672,ratio:3.8},{day:686,ratio:3.5},{day:700,ratio:3.0},{day:714,ratio:2.8},
  {day:728,ratio:2.8},{day:742,ratio:3.0},{day:756,ratio:2.8},{day:770,ratio:2.4},
  {day:784,ratio:2.6},{day:798,ratio:2.6},{day:812,ratio:2.4},{day:826,ratio:2.4},
  {day:840,ratio:2.3},{day:854,ratio:2.0},{day:868,ratio:1.9},{day:882,ratio:1.85},
  {day:896,ratio:1.78},{day:910,ratio:1.78},{day:924,ratio:1.85},{day:938,ratio:1.90},
  {day:952,ratio:2.0},{day:966,ratio:2.15},{day:980,ratio:2.5},{day:994,ratio:2.64},
  {day:1008,ratio:2.8},{day:1022,ratio:3.1},{day:1036,ratio:3.2},{day:1050,ratio:3.22},
  {day:1064,ratio:3.15},{day:1078,ratio:3.1},{day:1092,ratio:3.2},{day:1100,ratio:3.45},
];

const HALVING_2024_MS = new Date('2024-04-19T00:00:00Z').getTime();

async function fetchCycle2024(): Promise<CyclePoint[]> {
  const now = Date.now();
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=W&start=${HALVING_2024_MS}&end=${now}&limit=200`;
  const r = await fetch(url, { next: { revalidate: 3600 } });
  if (!r.ok) throw new Error(`Bybit ${r.status}`);
  const d = await r.json();
  if (d.retCode !== 0) throw new Error(`Bybit retCode ${d.retCode}: ${d.retMsg}`);

  const candles = (d.result?.list as string[][] | undefined);
  if (!candles || candles.length === 0) return [];

  // Bybit returns newest first — reverse to chronological
  const sorted = [...candles].reverse();
  const halvingClose = parseFloat(sorted[0][4]);
  if (!halvingClose) return [];

  return sorted.map(c => ({
    day: Math.round((parseInt(c[0]) - HALVING_2024_MS) / 86400000),
    ratio: parseFloat(c[4]) / halvingClose,
  })).filter(p => p.day >= 0);
}

export async function GET() {
  const currentDay = Math.floor((Date.now() - HALVING_2024_MS) / 86400000);

  try {
    const cycle2024 = await fetchCycle2024();
    return NextResponse.json({
      '2016': CYCLE_2016,
      '2020': CYCLE_2020,
      '2024': cycle2024,
      currentDay,
    } satisfies CycleData);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'fetch failed' },
      { status: 500 }
    );
  }
}
