/* QA's ORACLE for #2604 "a strategy that cannot run on this coin or timeframe says so": the written rule, in arithmetic, independent of lib/strategies/availability.ts.
 *   NY open breakout: 5m to 30m (its 30-minute opening range must be a whole number of candles; #2687: 1m is greyed, nothing could be drawn there).  Session sweep: 5m to 1h (#2687: 1m greyed).  VWAP reclaim: 1h or lower.  Funding + OI squeeze: 5m or higher AND a coin with Binance FUTURES funding/OI.
 *   CVD absorption: a coin with Binance FUTURES taker volume.  Every other strategy: always available.
 * The English text a user sees is what the PR's labels say (STRAT_NA_*): the oracle returns it so the call box, the menu tooltip and the server read can be compared with ONE expected string. */
export const TF_MS: Record<string, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '1d': 86_400_000 };
/** the coins of the test matrix that have a TRADING Binance futures contract (checked against Binance's own exchangeInfo by audit_availability.mts: xau = XAUUSDT and on = ONUSDT trade although their generated rows say binance: null; anthropic's row claims ANTHROPICUSDT but Binance does not trade it) */
export const HAS_FUTURES = new Set(['btc', 'eth', 'sol', 'hype', 'pepe', 'aapl', 'xau', 'on']);
export function unavailableByRule(id: string, coin: string, tfMs: number): string | null {
  const up = coin.toUpperCase();
  if ((id === 'ny_open_breakout' || id === 'session_sweep') && tfMs < 300_000) return 'Works on 5m or higher.';
  if (id === 'ny_open_breakout') return tfMs > 1_800_000 ? 'Works on 30m or lower.' : null;
  if (id === 'vwap_reclaim' || id === 'session_sweep') return tfMs > 3_600_000 ? 'Works on 1h or lower.' : null;
  if (id === 'funding_oi_squeeze') { if (tfMs < 300_000) return 'Works on 5m or higher.'; return HAS_FUTURES.has(coin) ? null : `Needs futures funding and open interest, not available for ${up}.`; }
  if (id === 'cvd_absorption') return HAS_FUTURES.has(coin) ? null : `Needs futures trade data, not available for ${up}.`;
  return null;
}
