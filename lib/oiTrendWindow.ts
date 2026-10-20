import { oiTrend1h, pctChange, type OiTrend } from './oiTrend1h.ts';

/* ONE FIXED OI-TREND WINDOW for the whole app (#1617, after #1613). PURE: no React, no network, no clock but the one passed in.
 *
 * WHAT WAS WRONG. `store.coins[coin].oiTrend` (components/MarketProvider.tsx) was computed over whatever readings the store happened to hold, and the
 * OI and the price were not even over the same stretch: on the first load the OI came from two hourly Bybit points (a 2-hour span while price came from
 * four hourly klines, a 3-hour span), and once the 8-minute poll had filled its own history it was the last four readings (~25 minutes). So Briefing,
 * the Dashboard sidebar chip, the Grok prompt's "OI Trend vs Price" line and the Accumulation / Distribution scores described the same coin over a
 * window that changed between first load and later, and the AI read's input changed meaning.
 *
 * THE RULE NOW. The trend is over a SIXTY-MINUTE window, the same hour the Arena card's "OI % 1h" (lib/useOI1h.ts, lib/oiTrend1h.ts) uses, with the price
 * change over exactly the same two moments, and the same thresholds (OI >= 0.3% AND price >= 0.2%, both required). A baseline must be a reading whose age
 * is 60 minutes give or take WINDOW_TOLERANCE_MS; with none, there is NO new answer and the store keeps what it had (the bootstrap's rolling hour, which is
 * also 60 minutes, and which is the same 13 five-minute samples the Arena card reads). An answer that is "no strong signal" is null, never a stale label and never "flat". */

export const OI_TREND_WINDOW_MS = 60 * 60_000;
/** A baseline reading may be this much older or younger than the window and still count as "an hour ago". Wider than one poll (8 minutes). */
export const WINDOW_TOLERANCE_MS = 10 * 60_000;
/** Readings older than this can never be a baseline again, so they are dropped. */
const KEEP_MS = OI_TREND_WINDOW_MS + WINDOW_TOLERANCE_MS + 5 * 60_000;

export interface OiReading { t: number; oi: number; price: number }

/** The history with `reading` added and everything too old to ever be a baseline removed. Readings with no usable number are not stored. */
export function pushReading(hist: readonly OiReading[], reading: OiReading, now: number): OiReading[] {
  const ok = Number.isFinite(reading.t) && Number.isFinite(reading.oi) && reading.oi > 0 && Number.isFinite(reading.price) && reading.price > 0;
  const next = ok ? [...hist, reading] : [...hist];
  return next.filter((r) => now - r.t <= KEEP_MS).sort((a, b) => a.t - b.t);
}

/** The reading closest to one window ago, if one is within tolerance. Otherwise null: there is no 60-minute answer yet. */
export function pickBaseline(hist: readonly OiReading[], now: number): OiReading | null {
  let best: OiReading | null = null;
  let bestGap = Infinity;
  for (const r of hist) {
    const gap = Math.abs(now - r.t - OI_TREND_WINDOW_MS);
    if (gap <= WINDOW_TOLERANCE_MS && gap < bestGap) { best = r; bestGap = gap; }
  }
  return best;
}

/** The trend between a baseline and the latest reading. null = no strong signal (or an unreadable number). */
export function trendBetween(base: OiReading, last: { oi: number; price: number }): OiTrend | null {
  return oiTrend1h(pctChange(base.oi, last.oi), pctChange(base.price, last.price));
}

/** The live path: given the history and the newest reading, what should the store's oiTrend become?
 *   { trend }  a 60-minute baseline exists: this is the answer (possibly null = no strong signal, which CLEARS an older label)
 *   null       no baseline yet: leave the store as it is. */
export function liveOiTrend(hist: readonly OiReading[], last: OiReading, now: number): { trend: OiTrend | null; history: OiReading[] } & { answered: boolean } {
  const history = pushReading(hist, last, now);
  const base = pickBaseline(history.filter((r) => r !== last && r.t < last.t), now);
  if (!base) return { trend: null, history, answered: false };
  return { trend: trendBetween(base, last), history, answered: true };
}

/** The bootstrap: from Bybit's open-interest points (newest first, each with the interval's start `timestamp`) and klines ([startTime, open, high, low,
 *  close, ...], any order), build the two readings that bound the ROLLING last 60 minutes: the newest OI point, and the point exactly one window before
 *  it (with 5-minute points that is 12 steps back, the same 13 samples the Arena card's "OI % 1h" reads). Each is paired with the price at THAT moment: the
 *  open of the candle that starts then. So the first load answers over the same rolling hour as the card and as every later poll (not "the last
 *  completed clock hour", which ends up to an hour ago and disagreed with the card for the first ~50 minutes of a session).
 *  Anything that does not line up (no point one window back, a missing candle, a bad number) gives null: unknown, not a guess. */
export function bootstrapReadings(
  oiNewestFirst: ReadonlyArray<{ openInterest?: unknown; timestamp?: unknown }> | undefined,
  klines: ReadonlyArray<ReadonlyArray<unknown>> | undefined,
): [OiReading, OiReading] | null {
  if (!oiNewestFirst || oiNewestFirst.length < 2 || !klines) return null;
  const n = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN);
  const t1 = n(oiNewestFirst[0].timestamp);
  const oi1 = n(oiNewestFirst[0].openInterest);
  if (!Number.isFinite(t1) || !Number.isFinite(oi1) || oi1 <= 0) return null;
  // the point one window before the newest, to within a minute
  const older = oiNewestFirst.slice(1).find((p) => Math.abs(t1 - n(p.timestamp) - OI_TREND_WINDOW_MS) <= 60_000);
  if (!older) return null;
  const t0 = n(older.timestamp), oi0 = n(older.openInterest);
  if (!Number.isFinite(t0) || !Number.isFinite(oi0) || oi0 <= 0) return null;
  const openAt = (t: number): number | null => {
    const k = klines.find((c) => Math.abs(n(c[0]) - t) < 1000);
    const p = k ? n(k[1]) : NaN;
    return Number.isFinite(p) && p > 0 ? p : null;
  };
  const p1 = openAt(t1), p0 = openAt(t0);
  if (p1 === null || p0 === null) return null;
  return [{ t: t0, oi: oi0, price: p0 }, { t: t1, oi: oi1, price: p1 }];
}
