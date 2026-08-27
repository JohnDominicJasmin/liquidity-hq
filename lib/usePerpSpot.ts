'use client';
import { useEffect, useState } from 'react';
import { BINANCE_SYMS } from './coins';
import { computePerpSpot, computeAbsorption, type PerpSpotReading, type AbsorptionReading } from './perpSpot';

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

interface Entry { reading: PerpSpotReading; absorption: AbsorptionReading; fetchedAt: number }
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

async function fetchBars(source: 'binance' | 'binance-futures', symbol: string) {
  const r = await fetch(
    `/api/market/klines?source=${source}&symbol=${symbol}&interval=1h&limit=${BARS}`,
    { signal: AbortSignal.timeout(12_000) },
  );
  if (!r.ok) throw new Error(`${source} ${r.status}`);
  const rows = (await r.json()) as Kline[];
  // Index 7: quote-asset volume (USDT). Index 10: taker-buy quote volume (#361).
  return rows.map(k => ({
    time: k[0],
    quoteVolume: parseFloat(k[7] as string),
    takerBuyQuoteVolume: parseFloat(k[10] as string),
  }));
}

/**
 * Fetch both readings for a coin in one network round-trip.
 * Never throws — an unmeasurable state is a value, not an exception.
 * Single-flight per coin so five surfaces do not become five pairs of calls.
 */
async function fetchEntry(coin: string): Promise<Entry> {
  const now = Date.now();
  const hit = cache.get(coin);
  if (hit && Math.floor(hit.fetchedAt / HOUR) === Math.floor(now / HOUR)) return hit;
  const running = inflight.get(coin);
  if (running) return running;

  const sym = BINANCE_SYMS[coin];
  const job = (async (): Promise<Entry> => {
    if (!sym) {
      const empty = computePerpSpot([], []);
      return { reading: empty, absorption: computeAbsorption([], []), fetchedAt: Date.now() };
    }
    try {
      const [spot, perp] = await Promise.all([
        fetchBars('binance', sym), fetchBars('binance-futures', sym),
      ]);
      const t = Date.now();
      return {
        reading:   computePerpSpot(spot, perp, HOUR, t),
        absorption: computeAbsorption(spot, perp, HOUR, t),
        fetchedAt: t,
      };
    } catch {
      const empty = computePerpSpot([], []);
      return { reading: empty, absorption: computeAbsorption([], []), fetchedAt: Date.now() };
    }
  })();

  inflight.set(coin, job);
  try {
    const entry = await job;
    cache.set(coin, entry);
    return entry;
  } finally {
    inflight.delete(coin);
  }
}

export async function readPerpSpot(coin: string): Promise<PerpSpotReading> {
  return (await fetchEntry(coin)).reading;
}

export async function readAbsorption(coin: string): Promise<AbsorptionReading> {
  return (await fetchEntry(coin)).absorption;
}

function useHourTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setTick(t => t + 1), HOUR - (Date.now() % HOUR) + 3_000);
    return () => clearTimeout(id);
  }, [tick]);
  return tick;
}

/** React binding for perps-vs-spot. Re-reads when the hour turns. */
export function usePerpSpot(coin: string): PerpSpotReading | null {
  const [reading, setReading] = useState<PerpSpotReading | null>(null);
  const tick = useHourTick();
  useEffect(() => {
    let cancelled = false;
    readPerpSpot(coin).then(r => { if (!cancelled) setReading(r); });
    return () => { cancelled = true; };
  }, [coin, tick]);
  return reading;
}

/** React binding for spot/perp absorption. Shares the same fetch as usePerpSpot. */
export function useAbsorption(coin: string): AbsorptionReading | null {
  const [reading, setReading] = useState<AbsorptionReading | null>(null);
  const tick = useHourTick();
  useEffect(() => {
    let cancelled = false;
    readAbsorption(coin).then(r => { if (!cancelled) setReading(r); });
    return () => { cancelled = true; };
  }, [coin, tick]);
  return reading;
}
