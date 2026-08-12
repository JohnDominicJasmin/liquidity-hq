'use client';
import { useEffect, useState } from 'react';
import { BINANCE_SYMS } from './coins';
import { computePerpSpot, type PerpSpotReading } from './perpSpot';

/* One source for the perps-vs-spot reading (#340).
 *
 * Extracted from PerpSpotCard when the owner asked for the same fact on five
 * surfaces - the dashboard card, Quick Research, Deep Research, Ask AI, and the
 * chart signal's confidence. Two fetches of the same thing would eventually
 * disagree on screen, and "the card says futures-led while the AI says spot
 * confirming" is a worse bug than either being wrong on its own.
 *
 * The module-level cache is what makes that guarantee real rather than
 * incidental: every consumer of the same coin within the TTL gets the identical
 * object, so they cannot drift even mid-hour.
 */

const HOUR = 3600_000;
const BARS = 168;   // 7 days of hourly bars - enough for a stable median

type Kline = [number, string, string, string, string, string, number, string, ...unknown[]];

interface Entry { reading: PerpSpotReading; fetchedAt: number }
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<PerpSpotReading>>();

async function fetchBars(source: 'binance' | 'binance-futures', symbol: string) {
  const r = await fetch(
    `/api/market/klines?source=${source}&symbol=${symbol}&interval=1h&limit=${BARS}`,
    { signal: AbortSignal.timeout(12_000) },
  );
  if (!r.ok) throw new Error(`${source} ${r.status}`);
  const rows = (await r.json()) as Kline[];
  // Index 7 is quote-asset volume (USDT) - comparable across the two venues in
  // a way base volume is not. Index 0 is the bar's open time.
  return rows.map(k => ({ time: k[0], quoteVolume: parseFloat(k[7]) }));
}

/**
 * Read perps-vs-spot for a coin. Never throws; an unmeasurable state is a
 * value, not an exception.
 *
 * Single-flight per coin: five surfaces mounting at once must not become five
 * pairs of upstream calls. Same reasoning as #201 on the klines route.
 */
export async function readPerpSpot(coin: string): Promise<PerpSpotReading> {
  const hit = cache.get(coin);
  // Valid until the hour turns, matching the bar interval the reading is built
  // from - a fresh fetch inside the same hour returns the same closed bar.
  if (hit && Math.floor(hit.fetchedAt / HOUR) === Math.floor(Date.now() / HOUR)) {
    return hit.reading;
  }
  const running = inflight.get(coin);
  if (running) return running;

  const sym = BINANCE_SYMS[coin];
  const job = (async (): Promise<PerpSpotReading> => {
    // No Binance spot pair means the question cannot be answered for this coin.
    // computePerpSpot([], []) is the explicit "cannot tell" reading - never a
    // number derived from the perp side alone.
    if (!sym) return computePerpSpot([], []);
    try {
      const [spot, perp] = await Promise.all([
        fetchBars('binance', sym), fetchBars('binance-futures', sym),
      ]);
      return computePerpSpot(spot, perp, HOUR, Date.now());
    } catch {
      return computePerpSpot([], []);   // a failed fetch is not a quiet market
    }
  })();

  inflight.set(coin, job);
  try {
    const reading = await job;
    cache.set(coin, { reading, fetchedAt: Date.now() });
    return reading;
  } finally {
    inflight.delete(coin);
  }
}

/** React binding. Re-reads when the hour turns, since the bar has changed. */
export function usePerpSpot(coin: string): PerpSpotReading | null {
  const [reading, setReading] = useState<PerpSpotReading | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    readPerpSpot(coin).then(r => { if (!cancelled) setReading(r); });
    return () => { cancelled = true; };
  }, [coin, tick]);

  useEffect(() => {
    const id = setTimeout(() => setTick(t => t + 1), HOUR - (Date.now() % HOUR) + 3_000);
    return () => clearTimeout(id);
  }, [tick]);

  return reading;
}
