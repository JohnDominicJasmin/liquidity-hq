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

export const EMA_SIGNAL_TFS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'] as const;
export type EMASignalTF = typeof EMA_SIGNAL_TFS[number];

const BYBIT_TF_INTERVAL: Record<EMASignalTF, string> = {
  '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '1d': 'D',
};

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
    const res = await fetch(
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

export async function fetchRibbonCandles(coin: string, tf: EMASignalTF): Promise<OHLCV[]> {
  const bnSym = BINANCE_SYMS[coin];
  if (bnSym) {
    try {
      const res = await fetch(
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
