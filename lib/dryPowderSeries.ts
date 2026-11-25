/* The stablecoin supply series behind /api/dry-powder, kept apart from the AI text so the numbers can be answered on their own (#research slow: the card waited ~20 s because the series read and the AI call ran
 * one after the other behind a single one-hour cache). DeFi Llama's series only moves once a day, so it is cached for a day, and the server warms it at start (instrumentation.ts) so the first visitor does not pay for it. */
import { cached } from './apiCache.ts';
import { readSnapshot, writeSnapshot } from './marketSnapshot.ts';

export const DRY_POWDER_SERIES_TTL_MS = 24 * 60 * 60_000;

interface LlamaEntry { date: string; totalCirculatingUSD: Record<string, number> }

async function fetchStablecoinSeries(): Promise<number[]> {
  const res = await fetch('https://stablecoins.llama.fi/stablecoincharts/all', {
    headers: { 'User-Agent': 'LiquidityHQ/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`DeFi Llama ${res.status}`);
  const data = (await res.json()) as LlamaEntry[];
  /* A DAY THE SOURCE LEFT OUT IS DROPPED, NOT COUNTED AS $0 (PM audit 2026-11-17: a zero day gave "Infinity%" or -100% and an AI verdict of CONTRACTING, cached for 24 hours). */
  return data.slice(-91)
    .map(d => d.totalCirculatingUSD?.peggedUSD)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
}

export interface DryPowderNumbers { current: number; prev30: number; prev90: number; series: number[] }

/* THE NUMBERS ARE STORED BY THE SCHEDULED INGEST, SO A PRO VISIT DOES NOT FETCH THEM (#1651 L103; PM, 2026-11-20: QA timed /research Pro on a warm qa: the AI text lands 0-1.7 s after the numbers, and the numbers are the slow part, a live
 * DeFi Llama read of 4.7-10.2 s). The ingest (every five minutes) calls `ensureDryPowderNumbers`, which refreshes the stored row hourly (the source only moves once a day) in `lhq_market_snapshot`, key `dry-powder-numbers`. `getDryPowderNumbers` answers from that
 * row (one fast read) and only falls back to the live read when nothing usable is stored (first deploy, or the ingest has been down for more than 36 h). No AI call is involved. The live read below is unchanged. */
export const DRY_POWDER_NUMBERS_KEY = 'dry-powder-numbers';
/** The ingest refreshes the stored row when it is older than this. */
export const DRY_POWDER_NUMBERS_REFRESH_MS = 60 * 60_000;
/** A stored row older than this is not served (the ingest has been failing): the route reads live instead. */
export const DRY_POWDER_NUMBERS_MAX_AGE_MS = 36 * 60 * 60_000;
export interface StoredDryPowderNumbers { numbers: DryPowderNumbers; at: number }

const isNumbers = (n: unknown): n is DryPowderNumbers => {
  const o = n as Partial<DryPowderNumbers> | null;
  return !!o && [o.current, o.prev30, o.prev90].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0) && Array.isArray(o.series) && o.series.length > 0;
};

/** The stored numbers, or null when none are stored, they are unreadable, or they are too old to serve. Never throws. */
export async function readStoredDryPowderNumbers(nowMs = Date.now(), maxAgeMs = DRY_POWDER_NUMBERS_MAX_AGE_MS): Promise<StoredDryPowderNumbers | null> {
  const snap = await readSnapshot(DRY_POWDER_NUMBERS_KEY);
  const p = snap?.payload as Partial<StoredDryPowderNumbers> | null | undefined;
  if (!p || typeof p.at !== 'number' || !isNumbers(p.numbers)) return null;
  return nowMs - p.at <= maxAgeMs ? { numbers: p.numbers, at: p.at } : null;
}

let numbersLastFailAt = 0;
let numbersInflight: Promise<'fresh' | 'refreshed' | 'failed' | 'skipped'> | null = null;
/** Called by the scheduled ingest: writes the stored numbers when they are missing or older than an hour. Safe to call every run (a cheap read when nothing is due) and never throws. */
export function ensureDryPowderNumbers(nowMs = Date.now()): Promise<'fresh' | 'refreshed' | 'failed' | 'skipped'> {
  numbersInflight ??= (async () => {
    try {
      const stored = await readStoredDryPowderNumbers(nowMs);
      if (stored && nowMs - stored.at < DRY_POWDER_NUMBERS_REFRESH_MS) return 'fresh' as const;
      /* After a failed attempt this instance waits before asking again, so a down provider is not read every five minutes. */
      if (nowMs - numbersLastFailAt < 30 * 60_000) return 'skipped' as const;
      const numbers = await liveDryPowderNumbers();
      await writeSnapshot(DRY_POWDER_NUMBERS_KEY, { numbers, at: nowMs } satisfies StoredDryPowderNumbers, 'defillama');
      return 'refreshed' as const;
    } catch {
      numbersLastFailAt = nowMs;
      return 'failed' as const;
    } finally {
      numbersInflight = null;
    }
  })();
  return numbersInflight;
}

/** The figures, and the UTC day they were stored when they are the LAST SAVED ones: nothing fresh is stored and the live read failed (#1651).
 *  A caller shows that day. Throws only when there is no saved row at all. */
export async function getDryPowderNumbersOrSaved(nowMs = Date.now()): Promise<{ numbers: DryPowderNumbers; savedDay?: string }> {
  try {
    return { numbers: await getDryPowderNumbers() };
  } catch (e) {
    const old = await readStoredDryPowderNumbers(nowMs, Number.POSITIVE_INFINITY);
    if (!old) throw e;
    return { numbers: old.numbers, savedDay: new Date(old.at).toISOString().slice(0, 10) };
  }
}

/** The figures the card shows: the stored row when there is one, else a live read. Throws 'Insufficient stablecoin data' only from the live path. */
export async function getDryPowderNumbers(): Promise<DryPowderNumbers> {
  const stored = await readStoredDryPowderNumbers();
  if (stored) return stored.numbers;
  return liveDryPowderNumbers();
}

/** The last 91 daily totals reduced to the figures the card shows, read live (cached a day in memory). Throws 'Insufficient stablecoin data' when the series is too short to read a 30-day change. */
export async function liveDryPowderNumbers(): Promise<DryPowderNumbers> {
  /* failTtlMs: a DeFi Llama outage is held for a minute instead of every card refetching a multi-MB body it cannot get. */
  const series = await cached('dry-powder-series', DRY_POWDER_SERIES_TTL_MS, fetchStablecoinSeries, { failTtlMs: 60_000 });
  if (series.length < 32) throw new Error('Insufficient stablecoin data');
  return {
    current: series[series.length - 1],
    prev30: series[Math.max(0, series.length - 31)],
    prev90: series[0],
    series: series.slice(-30),
  };
}

/** Fills the series cache at server start. Never throws. */
export function warmDryPowderSeries(): void {
  void getDryPowderNumbers().catch(() => { /* a cold cache is only slower */ });
}
