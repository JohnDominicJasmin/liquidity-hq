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
  /* LIVE DERIVATIVES INPUTS (phase-2 strategies, owner decision 2026-11-17). They are live values, not part of the candles, so the CALLER supplies them and a strategy that needs them says so with `needsLive` / `needsTaker`. Absent means NOT KNOWN, never 'no signal'.
     fundingClass: "paying heavily" judged against THE COIN'S OWN last 90 days (liveInputs.ts fundingClassRelative: longs_heavy = a positive rate above 95% of its settlements, shorts_heavy = a negative rate below 95% of them), absent when that history is not available; fundingPct: the rate in percent; oiChange6Pct: open interest change over the last 6 candles of this timeframe, in percent;
     taker: per-candle taker buy / sell volume by candle open time, Binance klines only (absent for a coin without the split). */
  fundingClass?: 'longs_heavy' | 'shorts_heavy' | 'none';
  fundingPct?: number;
  oiChange6Pct?: number | null;
  /** Open interest's change over the last 6 candles is in the TOP 20% of that coin's own changes on this timeframe (liveInputs.ts oiRelative): true / false, null = no reading (too little history). */
  oiExtreme?: boolean | null;
  taker?: ReadonlyMap<number, { buy: number; sell: number }>;
}

/* WHAT THE STRATEGY DRAWS ON THE CHART (owner, 2026-11-15: picking a strategy must change the chart, not only the text). PURE data from the SAME closed candles as the verdict, so a test can assert it and the
 * server never needs the chart. It is the LATEST state only: no history. A WAIT carries the levels the strategy is WATCHING; a BUY / SELL adds the signal candle's marker and the "wrong if" line. A level or zone
 * starts at `fromTs` (the candle it stood on) and runs to the right edge. Text comes from `labelKey` through t(), never from here. */
export type OverlayRole = 'watch' | 'confirm' | 'invalid' | 'ref';
export interface OverlayLevel { price: number; role: OverlayRole; fromTs: number; labelKey: LabelKey; labelParams?: Record<string, string> }
export interface OverlayZone { top: number; bottom: number; fromTs: number; toTs: number; kind: 'supply' | 'demand'; labelKey: LabelKey }
export interface OverlayLine { points: Array<{ ts: number; price: number }>; role: OverlayRole; labelKey: LabelKey; labelParams?: Record<string, string> }
export interface StrategyOverlay {
  levels: OverlayLevel[];
  zones: OverlayZone[];
  lines: OverlayLine[];
  /** The arrow on the signal candle, BUY / SELL only. */
  marker: { ts: number; dir: 'long' | 'short' } | null;
}
export const EMPTY_OVERLAY: StrategyOverlay = { levels: [], zones: [], lines: [], marker: null };

export interface StrategyResult {
  verdict: Verdict;
  /** Open time of the closed candle the signal formed on (null for wait). With signalDir it is the signal's IDENTITY: a different identity is a NEW signal. */
  signalTimestamp: number | null;
  signalDir: 'long' | 'short' | null;
  /** Numbers for the plain-language sentence; the card formats them and the label carries the words. */
  params: Record<string, number | boolean>;
  /** What to draw on the main price chart for this state (see StrategyOverlay). Absent when the strategy cannot say anything yet (too few candles, an unsupported timeframe). */
  overlay?: StrategyOverlay;
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
  /** True when the detector reads the live funding / open-interest values in the context (see StrategyContext). The caller fetches them; absent means the strategy answers wait with its own 'needs live data' reason. */
  needsLive?: boolean;
  /** True when the detector reads per-candle taker volume (ctx.taker); a coin without it answers wait with 'needs taker data'. */
  needsTaker?: boolean;
  reasonKeyFor?: (r: StrategyResult) => LabelKey | null;
  /** Closed candles the detector needs before it will say anything but wait. */
  minCandles: number;
  /** How many candles the caller fetches (default 300). A strategy that reads long averages needs more: the EMA 200 of a 300-candle view still carries about 5% of its first close (QA's real-data audit: 44.6% of bars changed answer between a 299 and a 300 window). */
  candleLimit?: number;
  /** The indicator chips the strategy menu switches on when this strategy is picked. ONLY chips that actually draw (SELECTABLE_INDICATOR_IDS: SMA, SAR, MACD, BOLL): the EMA ribbon, RSI,
   *  S/R and liquidity clusters are always-on chart layers, not chips, and VWAP / Divergence have no chart calculation yet, so a strategy that reads only those maps to none. */
  chips: readonly string[];
  /** Timeframes the server logs it on (the card works on any timeframe the Arena offers). */
  logTfs: readonly string[];
  /** `candles` are CLOSED candles, oldest first. */
  detect(candles: readonly OHLCV[], ctx: StrategyContext): StrategyResult;
}

export const WAIT: StrategyResult = { verdict: 'wait', signalTimestamp: null, signalDir: null, params: {} };
