import type { OHLCV } from '../strategyCore.ts';
import type { LabelKey } from '../labelKeys.ts';

/* THE ARENA STRATEGY CONTRACT (owner-requested, 2026-11-14). A strategy is a PURE function: closed candles in, a deterministic verdict out. No React, no network, no
 * clock, so the SAME function runs in the browser (the panel card and the sound ping) and on the server (the fire log that grades it), and a test can hand it fixture
 * candles. Honest framing everywhere: these are signals, not predictions; no strategy carries a win rate until its logged fires have one. */

export type Verdict = 'buy' | 'sell' | 'wait';

export interface StrategyContext {
  coin: string;
  tf: string;
  tfMs: number;
  /** Optional liquidation-cluster prices for the coin (client only). A detector may use them to strengthen the reason, never to create a signal. */
  liqLevels?: readonly number[];
  /** Closed BTC candles on the same timeframe, supplied only to a strategy with needsBtc and only for a coin other than BTC. */
  btcCandles?: readonly OHLCV[];
}

export interface StrategyResult {
  verdict: Verdict;
  /** Open time of the closed candle the signal formed on (null for wait). With signalDir it is the signal's IDENTITY: a different identity is a NEW signal. */
  signalTimestamp: number | null;
  signalDir: 'long' | 'short' | null;
  /** Numbers for the plain-language sentence; the card formats them and the label carries the words. */
  params: Record<string, number | boolean>;
}

export interface StrategyDef {
  id: string;
  nameKey: LabelKey;
  descKey: LabelKey;
  reasonBuyKey: LabelKey;
  reasonSellKey: LabelKey;
  reasonWaitKey: LabelKey;
  /** Optional: a different sentence for the same verdict (e.g. which of two triggers fired). Return null to use the default key. */
  /** True when the detector reads BTC candles (ctx.btcCandles). The caller fetches them; a failed fetch is an error, never a quiet wait. */
  needsBtc?: boolean;
  reasonKeyFor?: (r: StrategyResult) => LabelKey | null;
  /** Closed candles the detector needs before it will say anything but wait. */
  minCandles: number;
  /** Timeframes the server logs it on (the card works on any timeframe the Arena offers). */
  logTfs: readonly string[];
  /** `candles` are CLOSED candles, oldest first. */
  detect(candles: readonly OHLCV[], ctx: StrategyContext): StrategyResult;
}

export const WAIT: StrategyResult = { verdict: 'wait', signalTimestamp: null, signalDir: null, params: {} };
