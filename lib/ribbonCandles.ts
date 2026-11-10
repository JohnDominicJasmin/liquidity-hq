// Candle source for every signal the app fires on.
//
// Extracted from app/api/telegram/alert so the /alerts "Check Alerts Now"
// preview evaluates EXACTLY the same bars the alert cron does. A preview that
// sourced its candles differently would answer a subtly different question
// than the one the user is asking ("what would my alerts say right now"), and
// the disagreement would be invisible - two plausible-looking numbers with no
// way to tell which one the cron will act on.
//
// Binance-first with a Bybit fallback for Bybit-only coins (e.g. HYPE), which
// matches how the Arena chart itself sources candles (lib/useEMAStrategy.ts) -
// a gap the old Binance-only checkEMASetup silently had.
import { BINANCE_SYMS, BYBIT_SYMS, bybitSymbolPriceFactor } from '@/lib/coins';
import type { OHLCV } from '@/lib/strategyCore';
import { reportHealth, healthError } from '@/lib/apiHealth';
import { exchangeFetch } from './exchangeGuard.ts';

export const EMA_SIGNAL_TFS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'] as const;
export type EMASignalTF = typeof EMA_SIGNAL_TFS[number];

const BYBIT_TF_INTERVAL: Record<EMASignalTF, string> = {
  '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '1d': 'D',
};

const TF_MS: Record<EMASignalTF, number> = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '1d': 86_400_000,
};

/** The candles that have CLOSED by `nowMs`: one that opened at `time` closes at time + one timeframe. Binance and Bybit both return the
 *  still-forming candle last. An EMA alert built on it could fire on a close that never happened - a candle above EMA50 mid-way that
 *  then closed back below - and a sent message cannot be taken back (owner decision 2026-10-22, QA's #1651 finding 2). So alerts, and the
 *  /alerts preview that predicts them, judge closed candles only. The Arena chart still draws its live marker on the forming candle. */
export function closedCandles(candles: readonly OHLCV[], tf: EMASignalTF, nowMs = Date.now()): OHLCV[] {
  return candles.filter(c => c.time + TF_MS[tf] <= nowMs);
}

/** Coins not listed on Binance perp - use Bybit for klines, open interest and
 *  whale checks. Exported because the alert cron's OI/whale paths need the same
 *  "is this a Bybit-only coin" answer this file uses for candles. */
export const BYBIT_KLINE_SYMS: Record<string, string> = Object.fromEntries(
  Object.entries(BYBIT_SYMS).filter(([c]) => !BINANCE_SYMS[c])
);

/** Returns [] rather than throwing: one coin's feed failing must never take
 *  down a whole alert run, and the callers all treat an empty series as
 *  "nothing to say about this coin this tick".
 *
 *  That tolerance is exactly why this needs health reporting. If Binance
 *  started refusing Render's IP, every EMA and structure signal in the app
 *  would quietly stop - no error, no alert, no empty state anywhere, just a
 *  cron that reports `fired=0` forever and looks like a calm market. This is
 *  the single funnel both the alert cron and /api/alerts/preview go through,
 *  so one hook covers every signal the product fires on.
 *
 *  Reported per exchange, not per coin: a per-coin source would put ~50 rows on
 *  the /ops card that all fail together, and the question anyone actually has
 *  is "is Binance answering us". A coin with no symbol on either exchange is
 *  NOT a failure - there is nothing to ask - so it reports nothing at all. */
/** Shared Bybit fetch, used both as the primary source for Bybit-only coins
 *  and as the #1077 failover for Binance-listed coins whose Binance fetch
 *  failed. `healthSource` distinguishes the two in /ops - 'bybit:klines' for
 *  genuinely Bybit-primary coins (unchanged from before #1077), vs
 *  'bybit:klines-fallback' when this is standing in for a failed Binance -
 *  so a spike in the fallback key alone is visible as "Binance is down",
 *  never conflated with Bybit's own normal traffic. */
async function fetchFromBybit(bySym: string, tf: EMASignalTF, healthSource: string): Promise<OHLCV[]> {
  try {
    const res = await exchangeFetch(
      `https://api.bybit.com/v5/market/kline?category=linear&symbol=${bySym}&interval=${BYBIT_TF_INTERVAL[tf]}&limit=300`,
      { cache: 'no-store', signal: AbortSignal.timeout(9_000) }
    );
    if (!res.ok) {
      reportHealth(healthSource, 'market', false, `HTTP ${res.status}`);
      return [];
    }
    const d = await res.json() as { result?: { list?: string[][] } };
    const list = [...(d.result?.list ?? [])].reverse();
    // 1000PEPEUSDT / 1000BONKUSDT quote per 1000 tokens. Without this the EMA
    // and structure signals built from these candles carried entry/SL/TP and
    // swing levels 1000x the price shown everywhere else in the app - the
    // Telegram alert said PEPE entry $0.0027 while the ticker said $0.0000027 -
    // and lhq_alert_fires stored price_at_fire in whichever unit the rule
    // happened to use, so outcome maths compared different scales.
    //
    // Price fields only. Volume on a 1000x contract is in units of 1000 tokens,
    // but every use of it here is a RATIO against the same series' own average
    // (see lib/priceAction), so a constant factor cancels and rescaling it
    // would only invite confusion about what the number means.
    const pf = bybitSymbolPriceFactor(bySym);
    const out = list.map(k => ({
      time: +k[0], open: +k[1] * pf, high: +k[2] * pf, low: +k[3] * pf, close: +k[4] * pf, volume: +k[5],
    }));
    reportHealth(healthSource, 'market', out.length > 0,
      out.length > 0 ? `${out.length} candles` : 'no candles', out.length);
    return out;
  } catch (e) {
    reportHealth(healthSource, 'market', false, healthError(e));
    return [];
  }
}

/* ── CLOSED-CANDLE CACHE (#1651) ───────────────────────────────────────────────────────────────
 *
 * WHY: the Telegram alert pass runs every 5 minutes and made 299 exchange calls each time -
 * measured on production 2026-11-08, where it tripped Bybit's rate limiter twice and the breaker
 * took every Bybit call out for 10 then 20 minutes. Three consecutive passes reported `fired=0`,
 * so a paying user's alerts were silently off for ~25 minutes with nothing but a log line saying so.
 *
 * Most of those calls could not have returned anything new. A 1h candle closes twelve times slower
 * than the pass runs, so eleven of every twelve fetches re-ask for a series that cannot have changed.
 *
 * THE KEY IS THE CANDLE BOUNDARY, NOT A TTL. `bucket` is the open time of the candle currently
 * forming, so the entry is valid for exactly as long as the closed series behind it is: when a new
 * candle closes the bucket changes and the key misses. No clock skew, no stale window to tune, and
 * `closedCandles()` filters the same way it always did.
 *
 * ONLY SAFE BECAUSE EVERY CALLER READS CLOSED CANDLES. All three - the alert route's EMA-signal and
 * structure scans and /api/alerts/preview - wrap this in `closedCandles(...)`. The alert route's
 * OTHER two exchange paths deliberately do NOT come through here and must not: the frame scan reads
 * `ohlc[ohlc.length - 1]`, the forming candle, to evaluate its %-move threshold, and the RSI scan
 * takes `price` from the live candle one line below its closed `rsi` read. Caching either would
 * change when alerts fire or quote a stale price as current. If a future caller needs the forming
 * candle, it must not use this function.
 *
 * A FAILED FETCH IS NEVER CACHED. `fetchRibbonCandles` returns [] for a refused or empty response,
 * and storing that would turn one upstream blip into a whole candle period of silence - the outage
 * this change exists to shorten, made longer and harder to see. Only a non-empty result is kept. */
const CANDLE_CACHE = new Map<string, OHLCV[]>();

/** The open time of the candle currently forming: everything before it is closed and immutable. */
function bucketOf(tf: EMASignalTF, nowMs: number): number {
  return Math.floor(nowMs / TF_MS[tf]) * TF_MS[tf];
}

export async function fetchRibbonCandles(coin: string, tf: EMASignalTF, nowMs = Date.now()): Promise<OHLCV[]> {
  const key = `${coin}|${tf}|${bucketOf(tf, nowMs)}`;
  const hit = CANDLE_CACHE.get(key);
  if (hit) return hit;

  const fresh = await fetchRibbonCandlesUncached(coin, tf);
  if (fresh.length > 0) {
    /* Evict this coin+tf's older buckets rather than growing without bound. Scoped to the series
       being replaced, so one coin's eviction never drops another's still-valid entry. */
    const prefix = `${coin}|${tf}|`;
    for (const k of CANDLE_CACHE.keys()) if (k !== key && k.startsWith(prefix)) CANDLE_CACHE.delete(k);
    CANDLE_CACHE.set(key, fresh);
  }
  return fresh;
}

/** Test seam: how many series are held right now. Exported so a cell can assert eviction rather
 *  than infer it from call counts. */
export function candleCacheSize(): number {
  return CANDLE_CACHE.size;
}

/** Test seam: drop everything, so one cell cannot leak state into the next. */
export function clearCandleCache(): void {
  CANDLE_CACHE.clear();
}

async function fetchRibbonCandlesUncached(coin: string, tf: EMASignalTF): Promise<OHLCV[]> {
  const bnSym = BINANCE_SYMS[coin];
  if (bnSym) {
    try {
      const res = await exchangeFetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${bnSym}&interval=${tf}&limit=300`,
        { cache: 'no-store', signal: AbortSignal.timeout(9_000) }
      );
      if (res.ok) {
        const raw = await res.json() as Array<(string | number)[]>;
        const out = raw.map(k => ({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
        // A 200 carrying no candles is not health - same reasoning as the RSS
        // feed that served an HTML shell behind a 200. Treated as a failure
        // worth trying Bybit for below, same as a non-2xx status.
        if (out.length > 0) {
          reportHealth('binance:klines', 'market', true, `${out.length} candles`, out.length);
          return out;
        }
        reportHealth('binance:klines', 'market', false, 'no candles');
      } else {
        reportHealth('binance:klines', 'market', false, `HTTP ${res.status}`);
      }
    } catch (e) {
      reportHealth('binance:klines', 'market', false, healthError(e));
    }
    // #1077: reaching here means Binance failed - non-ok, threw, or a 200
    // carrying no candles. Fail over to Bybit for the same coin rather than
    // the silent "fired=0 looks like a calm market" outcome this function's
    // own doc comment warns about, but only if this coin actually has a
    // Bybit symbol; otherwise there is nothing to fail over to, and this
    // returns [] exactly as it always has for a Binance failure.
    const bySymFallback = BYBIT_SYMS[coin];
    if (bySymFallback) return fetchFromBybit(bySymFallback, tf, 'bybit:klines-fallback');
    return [];
  }
  const bySym = BYBIT_KLINE_SYMS[coin];
  if (!bySym) return [];
  return fetchFromBybit(bySym, tf, 'bybit:klines');
}
