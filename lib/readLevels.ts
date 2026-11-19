/* THE LEVELS A READ QUOTES ARE COMPUTED HERE, NOT CHOSEN BY THE MODEL (PM, 2026-11-19, #1651: two BTC reads three minutes apart said "cancels above $64,800" and
 * "cancels above $65,500", with a taker threshold of 55% and 60%, for the same coin and timeframe: each read invented its own numbers).
 *
 * From the CLOSED candles of the read's timeframe, the nearest support / resistance level the chart draws (lib/srLevels.ts through srPrices) above and below the last
 * close, and the one taker-ratio threshold. Same function for Quick and Deep, nothing live in it (the last CLOSE, not the ticking price), so every read of one coin and
 * timeframe carries the same numbers until a candle closes. The prompt hands them over as fixed numbers and tells the model to quote them (lib/grok.ts withReadLevels). */
import { dropForming } from './candles.ts';
import { nearestLevel, srPrices } from './strategies/shared.ts';
import type { OHLCV } from './strategyCore.ts';

/** The one taker-ratio threshold every read states for confirming a lean (a share of taker volume, in percent). */
export const READ_TAKER_CONFIRM_PCT = 60;
export const READ_LEVELS_MIN_CANDLES = 60;

export interface ReadLevels {
  /** The last closed candle's close, the price the levels are measured from. */
  close: number;
  /** The nearest resistance above the close (a close above it cancels a bearish lean), or null when the chart has none. */
  above: number | null;
  /** The nearest support below the close (a close below it confirms a bearish break), or null. */
  below: number | null;
}

export function readLevels(candles: readonly OHLCV[], tfMs: number, nowMs: number): ReadLevels | null {
  if (!(tfMs > 0)) return null;
  const closed = dropForming(candles, tfMs, nowMs);
  if (closed.length < READ_LEVELS_MIN_CANDLES) return null;
  const close = closed[closed.length - 1].close;
  if (!Number.isFinite(close) || close <= 0) return null;
  const prices = srPrices(closed, close);
  return { close, above: nearestLevel(prices, close, 'long'), below: nearestLevel(prices, close, 'short') };
}
