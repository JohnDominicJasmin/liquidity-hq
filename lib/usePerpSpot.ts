'use client';
import { deadlineSignal } from './deadlineSignal.ts';
import { useEffect, useState } from 'react';
import { BINANCE_SYMS } from './coins.ts';
import { computePerpSpot, computeAbsorption, type PerpSpotReading, type AbsorptionReading } from './perpSpot.ts';

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

interface Entry {
  reading: PerpSpotReading; absorption: AbsorptionReading; fetchedAt: number;
  /** A read that FAILED for a reason that can pass (network, timeout, 429, 5xx) and had no earlier good reading to fall back on. Never cached for the hour. */
  transient?: boolean;
}
/* Good readings, and a coin that has no spot market (a 4xx answer: a fact, kept for the hour). A transient failure is never written here, so the last good
 * reading survives it and the next try is not blocked until the hour turns. */
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();
const retryAfter = new Map<string, number>();
const RETRY_MS = 60_000;
/* An earlier good reading is kept this long while refreshes fail; past it, "no reading" is more honest than an old one. */
const STALE_KEEP_MS = 6 * HOUR;

async function fetchBars(source: 'binance' | 'binance-futures', symbol: string) {
  const r = await fetch(
    `/api/market/klines?source=${source}&symbol=${symbol}&interval=1h&limit=${BARS}`,
    { signal: deadlineSignal(12_000) },
  );
  if (!r.ok) throw Object.assign(new Error(`${source} ${r.status}`), { status: r.status });
  const rows = (await r.json()) as Kline[];
  // Index 7: quote-asset volume (USDT). Index 10: taker-buy quote volume (#361).
  return rows.map(k => ({
    time: k[0],
    quoteVolume: parseFloat(k[7] as string),
    takerBuyQuoteVolume: parseFloat(k[10] as string),
  }));
}

/** A 4xx other than 408/429 means this coin has no such market (the spot pair does not exist): that is an answer, not an outage. */
function isNoMarket(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

function emptyEntry(transient: boolean): Entry {
  return { reading: computePerpSpot([], []), absorption: computeAbsorption([], []), fetchedAt: Date.now(), ...(transient ? { transient: true } : {}) };
}

/**
 * Fetch both readings for a coin in one network round-trip.
 * Never throws — an unmeasurable state is a value, not an exception.
 * Single-flight per coin so five surfaces do not become five pairs of calls.
 *
 * A FAILED read is not the answer for the rest of the hour (#1185 D22). It used to be cached like a success, so one dropped request showed "cannot measure" until
 * the next UTC hour and replaced the good reading. Now a transient failure returns the last good reading (up to 6 h old) or a `transient` entry, and is tried again
 * after a minute.
 */
async function fetchEntry(coin: string): Promise<Entry> {
  const now = Date.now();
  const hit = cache.get(coin);
  if (hit && Math.floor(hit.fetchedAt / HOUR) === Math.floor(now / HOUR)) return hit;
  const stale = hit && hit.reading.lean !== 'unknown' && now - hit.fetchedAt < STALE_KEEP_MS ? hit : null;
  if ((retryAfter.get(coin) ?? 0) > now) return stale ?? emptyEntry(true);
  const running = inflight.get(coin);
  if (running) return running;

  const sym = BINANCE_SYMS[coin];
  const job = (async (): Promise<Entry> => {
    if (!sym) {
      const empty = emptyEntry(false);
      cache.set(coin, empty);
      return empty;
    }
    try {
      const [spot, perp] = await Promise.all([
        fetchBars('binance', sym), fetchBars('binance-futures', sym),
      ]);
      const t = Date.now();
      const entry: Entry = {
        reading:   computePerpSpot(spot, perp, HOUR, t),
        absorption: computeAbsorption(spot, perp, HOUR, t),
        fetchedAt: t,
      };
      cache.set(coin, entry);
      retryAfter.delete(coin);
      return entry;
    } catch (e) {
      if (isNoMarket(e)) {
        const empty = emptyEntry(false);
        cache.set(coin, empty);
        retryAfter.delete(coin);
        return empty;
      }
      retryAfter.set(coin, Date.now() + RETRY_MS);
      return stale ?? emptyEntry(true);
    }
  })();

  inflight.set(coin, job);
  try {
    return await job;
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

/* One read per coin, re-read when the hour turns and again a minute after a failed read, so a dropped request heals on its own. null until the first answer. */
function useEntry(coin: string): Entry | null {
  const [got, setGot] = useState<{ coin: string; entry: Entry } | null>(null);
  const tick = useHourTick();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    fetchEntry(coin).then(entry => {
      if (cancelled) return;
      setGot({ coin, entry });
      if (entry.transient || retryAfter.has(coin)) timer = setTimeout(() => setRetry(n => n + 1), RETRY_MS + 1_000);
    });
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [coin, tick, retry]);
  return got && got.coin === coin ? got.entry : null;
}

/** React binding for perps-vs-spot. Re-reads when the hour turns. null while the first read is out and while a failed read has nothing earlier to show (the card hides). */
export function usePerpSpot(coin: string): PerpSpotReading | null {
  const entry = useEntry(coin);
  return entry && !entry.transient ? entry.reading : null;
}

/** React binding for spot/perp absorption. Shares the same fetch as usePerpSpot. */
export function useAbsorption(coin: string): AbsorptionReading | null {
  const entry = useEntry(coin);
  return entry && !entry.transient ? entry.absorption : null;
}

/** When the reading on screen for this coin was taken (ms), or null. A reading older than the hour means a refresh is failing and the card says how old it is. */
export function perpSpotFetchedAt(coin: string): number | null {
  return cache.get(coin)?.fetchedAt ?? null;
}
