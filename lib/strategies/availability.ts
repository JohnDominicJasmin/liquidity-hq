import { BINANCE_SYMS } from '../coins.ts';
import type { LabelKey } from '../labelKeys.ts';

/* A STRATEGY THAT CANNOT RUN HERE SAYS SO (owner, 2026-11-19: he EXPECTS some strategies not to work on some timeframes and assets; what matters is that the app says so instead of a silent WAIT). Pure: the same answer for the
 * call box ("WAIT" and one line of why), the strategy menu (the option is greyed with the same line as its tooltip), the server's read for Quick / Deep ("NO READING (why)") and the audit script's "unsupported by design" cells, so the
 * four can never disagree. It is about the strategy's own limits, never about a failed read (a failed read is its own error state).
 *   TIMEFRAME: NY open breakout needs candles that divide its 30-minute opening range (30m or lower); VWAP reclaim and the session sweep need 1h or lower (a 4h or daily session holds too few candles); the funding + OI squeeze
 *   reads Binance's open-interest history, which starts at 5m.
 *   ASSET: the funding + OI squeeze needs the coin's futures funding and open interest, and CVD absorption its futures taker volume; both are Binance FUTURES data (lib/coins.ts BINANCE_SYMS), so a coin with no Binance futures listing has neither. */

export interface Unavailable { reasonKey: LabelKey; vars: Record<string, string> }

const MIN = 60_000, HOUR = 3_600_000;

export function strategyUnavailable(id: string, coin: string, tfMs: number | undefined): Unavailable | null {
  const tfOver = (maxMs: number, tf: string): Unavailable | null => (tfMs != null && tfMs > maxMs ? { reasonKey: 'STRAT_NA_TF_MAX', vars: { tf } } : null);
  const hasFutures = !!(BINANCE_SYMS as Record<string, string | undefined>)[coin];
  const sym = coin.toUpperCase();
  switch (id) {
    case 'ny_open_breakout':
      // the 30-minute opening range must be a whole number of candles
      return tfOver(30 * MIN, '30m') ?? (tfMs != null && (30 * MIN) % tfMs !== 0 ? { reasonKey: 'STRAT_NA_TF_MAX', vars: { tf: '30m' } } : null);
    case 'vwap_reclaim':
    case 'session_sweep':
      return tfOver(HOUR, '1h');
    case 'funding_oi_squeeze':
      if (tfMs != null && tfMs < 5 * MIN) return { reasonKey: 'STRAT_NA_TF_MIN', vars: { tf: '5m' } };
      return hasFutures ? null : { reasonKey: 'STRAT_NA_NO_FUTURES', vars: { coin: sym } };
    case 'cvd_absorption':
      return hasFutures ? null : { reasonKey: 'STRAT_NA_NO_TRADES', vars: { coin: sym } };
    default:
      return null;
  }
}
