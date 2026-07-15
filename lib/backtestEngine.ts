// Historical backtest engine for the EMA ribbon strategy.
// Reuses the exact same signal-detection logic as the live hook (lib/strategyCore.ts)
// so backtest results can never silently diverge from what fires on the live chart.

import { CoinId, BINANCE_SYMS, BYBIT_SYMS } from './marketStore';
import {
  OHLCV, SignalEvent, SignalFilterParams,
  DEFAULT_FILTER_PARAMS, STRICT_FILTER_PARAMS, detectEMASignals,
} from './strategyCore';
import { getWaveTrendConfirmation, WaveTrendParams, DEFAULT_WT_PARAMS } from './waveTrend';
import {
  simpleRSI14, lastClosedIndexBefore, computeVolumeProfile, scoreOrderFlowBias, computeOrderFlowZones,
} from './orderFlowCore';

// Tuning variants for the WaveTrend confirming-layer backtest sweep — each targets a
// specific hypothesis for why the original (DEFAULT_WT_PARAMS) version underperformed:
// EMA confirmation fires late (after the cross + ATR buffer + persistence wait), so by
// the time it fires WaveTrend has often already cycled out of its extreme.
export const WT_VARIANTS: Record<string, WaveTrendParams> = {
  current:          DEFAULT_WT_PARAMS,
  looseRecency:     { ...DEFAULT_WT_PARAMS, crossWindowBars: 20 },
  armWindow:        { ...DEFAULT_WT_PARAMS, useArmWindow: true },
  divergenceOnly:   { ...DEFAULT_WT_PARAMS, requireCross: false },
  looseThresholds:  { ...DEFAULT_WT_PARAMS, obLevel: 45, osLevel: -45, useArmWindow: true },
};

/* ── TF → exchange interval strings + milliseconds ──────────────────────── */
const TF_BN: Record<string, string> = {
  '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d',
};
const TF_BY: Record<string, string> = {
  '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D',
};
const TF_MS: Record<string, number> = {
  '15m': 15 * 60_000, '30m': 30 * 60_000, '1h': 3_600_000, '4h': 4 * 3_600_000, '1d': 86_400_000,
};

/* ── Paginated historical fetch ───────────────────────────────────────────── */
async function fetchBinanceFuturesKlinesRange(sym: string, interval: string, startTime: number, endTime: number): Promise<OHLCV[]> {
  const out: OHLCV[] = [];
  let cursor = startTime;
  const PAGE = 1500;
  let guard = 0;
  while (cursor < endTime && guard < 500) {
    guard++;
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&startTime=${cursor}&endTime=${endTime}&limit=${PAGE}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`Binance futures klines ${r.status}`);
    const raw = await r.json() as (string | number)[][];
    if (!raw.length) break;
    const batch = raw.map(k => ({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
    out.push(...batch);
    const lastTime = batch[batch.length - 1].time;
    if (lastTime <= cursor) break; // no progress — bail to avoid infinite loop
    cursor = lastTime + 1;
    if (batch.length < PAGE) break; // reached the end of available history
    await new Promise(res => setTimeout(res, 150)); // polite pacing against rate limits
  }
  return out;
}

async function fetchBybitKlinesRange(sym: string, interval: string, startTime: number, endTime: number): Promise<OHLCV[]> {
  const out: OHLCV[] = [];
  let cursor = startTime;
  const PAGE = 1000;
  let guard = 0;
  while (cursor < endTime && guard < 500) {
    guard++;
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=${interval}&start=${cursor}&end=${endTime}&limit=${PAGE}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`Bybit klines ${r.status}`);
    const d = await r.json() as { result?: { list?: string[][] } };
    const list = [...(d?.result?.list ?? [])].reverse(); // Bybit returns newest-first
    if (!list.length) break;
    const batch = list.map(k => ({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
    out.push(...batch);
    const lastTime = batch[batch.length - 1].time;
    if (lastTime <= cursor) break;
    cursor = lastTime + 1;
    if (batch.length < PAGE) break;
    await new Promise(res => setTimeout(res, 150));
  }
  return out;
}

/* ── Historical funding rate ──────────────────────────────────────────────── */
export interface FundingPoint { time: number; ratePct: number } // ratePct already ×100

async function fetchBinanceFundingRange(sym: string, startTime: number, endTime: number): Promise<FundingPoint[]> {
  const out: FundingPoint[] = [];
  let cursor = startTime;
  const PAGE = 1000;
  let guard = 0;
  while (cursor < endTime && guard < 100) {
    guard++;
    const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&startTime=${cursor}&endTime=${endTime}&limit=${PAGE}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`Binance funding rate ${r.status}`);
    const raw = await r.json() as Array<{ fundingTime: number; fundingRate: string }>;
    if (!raw.length) break;
    out.push(...raw.map(f => ({ time: f.fundingTime, ratePct: parseFloat(f.fundingRate) * 100 })));
    const lastTime = raw[raw.length - 1].fundingTime;
    if (lastTime <= cursor) break;
    cursor = lastTime + 1;
    if (raw.length < PAGE) break;
    await new Promise(res => setTimeout(res, 150));
  }
  return out;
}

async function fetchBybitFundingRange(sym: string, startTime: number, endTime: number): Promise<FundingPoint[]> {
  const out: FundingPoint[] = [];
  let cursor = startTime;
  const PAGE = 200;
  let guard = 0;
  while (cursor < endTime && guard < 200) {
    guard++;
    const url = `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${sym}&startTime=${cursor}&endTime=${endTime}&limit=${PAGE}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`Bybit funding rate ${r.status}`);
    const d = await r.json() as { result?: { list?: Array<{ fundingRateTimestamp: string; fundingRate: string }> } };
    const list = [...(d?.result?.list ?? [])].reverse(); // Bybit returns newest-first
    if (!list.length) break;
    out.push(...list.map(f => ({ time: +f.fundingRateTimestamp, ratePct: parseFloat(f.fundingRate) * 100 })));
    const lastTime = +list[list.length - 1].fundingRateTimestamp;
    if (lastTime <= cursor) break;
    cursor = lastTime + 1;
    if (list.length < PAGE) break;
    await new Promise(res => setTimeout(res, 150));
  }
  return out;
}

export async function fetchHistoricalFunding(coin: CoinId, yearsBack: number): Promise<FundingPoint[]> {
  const endTime   = Date.now();
  const startTime = endTime - yearsBack * 365 * 24 * 3_600_000;
  const bnSym = BINANCE_SYMS[coin];
  const bySym = BYBIT_SYMS[coin];
  if (bnSym) return fetchBinanceFundingRange(bnSym, startTime, endTime);
  if (bySym) return fetchBybitFundingRange(bySym, startTime, endTime);
  throw new Error(`No symbol for ${coin}`);
}

export async function fetchHistoricalOHLCV(coin: CoinId, tf: string, yearsBack: number): Promise<OHLCV[]> {
  const bnInterval = TF_BN[tf];
  const byInterval = TF_BY[tf];
  if (!bnInterval || !byInterval) throw new Error(`Unsupported backtest timeframe: ${tf}`);
  const endTime   = Date.now();
  const startTime = endTime - yearsBack * 365 * 24 * 3_600_000;
  const bnSym = BINANCE_SYMS[coin];
  const bySym = BYBIT_SYMS[coin];
  if (bnSym) return fetchBinanceFuturesKlinesRange(bnSym, bnInterval, startTime, endTime);
  if (bySym) return fetchBybitKlinesRange(bySym, byInterval, startTime, endTime);
  throw new Error(`No symbol for ${coin}`);
}

/* ── Trade simulation ─────────────────────────────────────────────────────── */
export interface SimulatedTrade {
  coin:       CoinId;
  dir:        'long' | 'short';
  entryTime:  number;
  entryPrice: number;
  sl:         number;
  tp:         number;
  exitTime:   number | null;
  exitPrice:  number | null;
  outcome:    'win' | 'loss' | 'open'; // open = signal fired but neither SL nor TP hit before data ran out
  rMultiple:  number;                  // net of estimated fees + slippage (see ROUND_TRIP_COST_PCT below).
                                        // Gross, a loss is exactly -1R and a win is (reward distance / risk
                                        // distance) — +2 for the EMA strategy's fixed 2:1 rule, variable for
                                        // strategies (like Order Flow) whose TP is found, not fixed. costR is
                                        // subtracted from both so the number reported is realistic, not gross.
}

// Binance/Bybit USDT-perp taker fee is ~0.05% per side; SLIPPAGE_PCT is a conservative
// placeholder for market-order fill slippage (thinner for majors, worse for illiquid
// alts — kept uniform here rather than per-coin to avoid a false sense of precision).
// Applied as entry + exit (round trip), then converted into R-multiple terms per trade
// because the cost is a fixed % of notional but R is measured against each trade's own
// (variable) stop distance — a tight stop eats proportionally more of its R to costs
// than a wide one. Exported so the UI can disclose the assumption instead of silently
// baking it in.
export const TAKER_FEE_PCT = 0.05;
export const SLIPPAGE_PCT  = 0.03;
export const ROUND_TRIP_COST_PCT = (TAKER_FEE_PCT + SLIPPAGE_PCT) * 2; // entry + exit, each fee + slippage

function costInR(entryPrice: number, riskDist: number): number {
  if (riskDist <= 0) return 0;
  return (ROUND_TRIP_COST_PCT / 100 * entryPrice) / riskDist;
}

function simulateTrade(signal: SignalEvent, candles: OHLCV[], coin: CoinId): SimulatedTrade {
  // Enter at the FILL candle — the first candle at which the signal is actually
  // knowable (confirmation + persistence hold) — never at the confirmation candle,
  // whose validity depends on closes that hadn't printed yet at its own close.
  const { dir, fillIndex, fillPrice, sl, tp } = signal;
  const entryPrice = fillPrice;
  const entryTime  = candles[fillIndex]?.time ?? signal.timestamp;
  const riskDist   = Math.abs(entryPrice - sl);
  const rewardDist = Math.abs(tp - entryPrice);
  const winR  = riskDist > 0 ? rewardDist / riskDist : 0;
  const costR = costInR(entryPrice, riskDist);
  for (let j = fillIndex + 1; j < candles.length; j++) {
    const c = candles[j];
    const hitTP = dir === 'long' ? c.high >= tp : c.low <= tp;
    const hitSL = dir === 'long' ? c.low <= sl : c.high >= sl;
    // Conservative same-candle tie-break: with only OHLC data we can't know intracandle
    // order, so assume the worse outcome (SL) hit first.
    if (hitSL) {
      return { coin, dir, entryTime, entryPrice, sl, tp, exitTime: c.time, exitPrice: sl, outcome: 'loss', rMultiple: -1 - costR };
    }
    if (hitTP) {
      return { coin, dir, entryTime, entryPrice, sl, tp, exitTime: c.time, exitPrice: tp, outcome: 'win', rMultiple: winR - costR };
    }
  }
  // Open trades haven't incurred an exit cost yet — leave at 0, matching the existing
  // "unresolved, excluded from win/loss stats" treatment.
  return { coin, dir, entryTime, entryPrice, sl, tp, exitTime: null, exitPrice: null, outcome: 'open', rMultiple: 0 };
}

export function simulateTrades(signals: SignalEvent[], candles: OHLCV[], coin: CoinId): SimulatedTrade[] {
  return signals.map(s => simulateTrade(s, candles, coin));
}

// Keeps only signals where WaveTrend (Cipher B) would have confirmed AT THE TIME the
// signal fired. Slices the candle array to each signal's own index before checking —
// WaveTrend's divergence detection needs a few forward candles to confirm a pivot, so
// computing it on the full array would leak future data into a historical decision.
function filterSignalsByWaveTrend(signals: SignalEvent[], candles: OHLCV[], params: WaveTrendParams): SignalEvent[] {
  return signals.filter(s => {
    const historical = candles.slice(0, s.index + 1);
    return getWaveTrendConfirmation(historical, s.dir, s.armIndex, params).pass === true;
  });
}

/* ── Stats aggregation ─────────────────────────────────────────────────────── */
export interface BacktestStats {
  totalTrades:   number;
  wins:          number;
  losses:        number;
  open:          number;
  winRate:       number; // wins / (wins+losses) — excludes still-open trades
  avgR:          number; // average rMultiple across resolved trades
  profitFactor:  number; // sum(positive R) / abs(sum(negative R))
  maxDrawdownR:  number; // largest peak-to-trough drop in cumulative R
  equityCurve:   number[]; // cumulative R after each resolved trade, chronological
}

export function computeStats(trades: SimulatedTrade[]): BacktestStats {
  const resolved = trades
    .filter(t => t.outcome !== 'open')
    .sort((a, b) => (a.exitTime ?? 0) - (b.exitTime ?? 0));

  const wins   = resolved.filter(t => t.outcome === 'win').length;
  const losses = resolved.filter(t => t.outcome === 'loss').length;
  const open   = trades.length - resolved.length;
  const winRate = (wins + losses) > 0 ? wins / (wins + losses) : 0;

  const sumR = resolved.reduce((a, t) => a + t.rMultiple, 0);
  const avgR = resolved.length > 0 ? sumR / resolved.length : 0;

  const grossWin  = resolved.filter(t => t.rMultiple > 0).reduce((a, t) => a + t.rMultiple, 0);
  const grossLoss = Math.abs(resolved.filter(t => t.rMultiple < 0).reduce((a, t) => a + t.rMultiple, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);

  let cum = 0, peak = 0, maxDD = 0;
  const equityCurve: number[] = [];
  for (const t of resolved) {
    cum += t.rMultiple;
    equityCurve.push(cum);
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  }

  return { totalTrades: trades.length, wins, losses, open, winRate, avgR, profitFactor, maxDrawdownR: maxDD, equityCurve };
}

/* ── Multi-coin orchestrator ──────────────────────────────────────────────── */
export interface BacktestSide {
  stats:   BacktestStats;
  perCoin: Partial<Record<CoinId, BacktestStats>>;
  trades:  SimulatedTrade[];
}

export interface BacktestRunResult {
  tf:               string;
  yearsBack:        number;
  coins:            CoinId[];
  failedCoins:      CoinId[];
  antiChopOn:        BacktestSide;
  antiChopOff:       BacktestSide;
  waveTrendVariants: Record<string, BacktestSide>; // keys match WT_VARIANTS
}

export async function runBacktest(
  coins:      CoinId[],
  tf:         string,
  yearsBack:  number,
  onProgress?: (done: number, total: number, currentCoin: CoinId) => void,
): Promise<BacktestRunResult> {
  const CONCURRENCY = 4;
  const variantNames = Object.keys(WT_VARIANTS);

  const allTradesOn:  SimulatedTrade[] = [];
  const allTradesOff: SimulatedTrade[] = [];
  const perCoinOn:  Partial<Record<CoinId, BacktestStats>> = {};
  const perCoinOff: Partial<Record<CoinId, BacktestStats>> = {};

  // One trade accumulator + per-coin map per variant, keyed by variant name.
  const allTradesByVariant: Record<string, SimulatedTrade[]> = {};
  const perCoinByVariant:   Record<string, Partial<Record<CoinId, BacktestStats>>> = {};
  for (const name of variantNames) { allTradesByVariant[name] = []; perCoinByVariant[name] = {}; }

  const failedCoins: CoinId[] = [];
  let done = 0;

  async function processCoin(coin: CoinId) {
    try {
      const candles = await fetchHistoricalOHLCV(coin, tf, yearsBack);
      if (candles.length > 60) {
        // Fetch + EMA detection happens once per coin — the expensive (network) part.
        // Only the WaveTrend filter + simulate step repeats per variant (no network).
        // "ON" = the stricter, persistence-based filter; "OFF" = raw signals (now the
        // live default — see DEFAULT_FILTER_PARAMS in strategyCore.ts for why).
        const onSignals  = detectEMASignals(candles, tf, STRICT_FILTER_PARAMS);
        const offSignals = detectEMASignals(candles, tf, DEFAULT_FILTER_PARAMS);
        const confirmed = <T extends { pending: boolean }>(arr: T[]) => arr.filter(s => !s.pending);
        const onTrades  = [...simulateTrades(confirmed(onSignals.signalLongs), candles, coin), ...simulateTrades(confirmed(onSignals.signalShorts), candles, coin)];
        const offTrades = [...simulateTrades(confirmed(offSignals.signalLongs), candles, coin), ...simulateTrades(confirmed(offSignals.signalShorts), candles, coin)];
        allTradesOn.push(...onTrades);
        allTradesOff.push(...offTrades);
        perCoinOn[coin]  = computeStats(onTrades);
        perCoinOff[coin] = computeStats(offTrades);

        for (const name of variantNames) {
          const params = WT_VARIANTS[name];
          const wtLongs  = filterSignalsByWaveTrend(confirmed(onSignals.signalLongs), candles, params);
          const wtShorts = filterSignalsByWaveTrend(confirmed(onSignals.signalShorts), candles, params);
          const wtTrades = [...simulateTrades(wtLongs, candles, coin), ...simulateTrades(wtShorts, candles, coin)];
          allTradesByVariant[name].push(...wtTrades);
          perCoinByVariant[name][coin] = computeStats(wtTrades);
        }
      } else {
        failedCoins.push(coin);
      }
    } catch (err) {
      failedCoins.push(coin);
      console.warn(`Backtest: failed to fetch ${coin}`, err);
    } finally {
      done++;
      onProgress?.(done, coins.length, coin);
    }
  }

  let idx = 0;
  async function worker() {
    while (idx < coins.length) {
      const coin = coins[idx++];
      await processCoin(coin);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const waveTrendVariants: Record<string, BacktestSide> = {};
  for (const name of variantNames) {
    waveTrendVariants[name] = {
      stats: computeStats(allTradesByVariant[name]),
      perCoin: perCoinByVariant[name],
      trades: allTradesByVariant[name],
    };
  }

  return {
    tf, yearsBack, coins, failedCoins,
    antiChopOn:  { stats: computeStats(allTradesOn),  perCoin: perCoinOn,  trades: allTradesOn },
    antiChopOff: { stats: computeStats(allTradesOff), perCoin: perCoinOff, trades: allTradesOff },
    waveTrendVariants,
  };
}

/* ── Order Flow Setup backtest ─────────────────────────────────────────────
   Validates the 5 backtestable signals from components/StopLossZone.tsx's
   scoreBias (RSI 15m/1h/4h, POC, VWAP, funding) — OI trend, CVD divergence,
   and taker buy ratio are excluded; see lib/orderFlowCore.ts header for why. */

const OF_EVAL_STRIDE   = 16;  // evaluate every 16 15m-candles (~4h) — matches a realistic check cadence
const OF_VP_WINDOW     = 100; // rolling volume-profile window, matches the live card exactly
const OF_HI24_WINDOW   = 96;  // ~24h of 15m candles, approximates the live 24h ticker high/low

async function processOrderFlowCoin(coin: CoinId, yearsBack: number): Promise<SimulatedTrade[]> {
  const [c15m, c1h, c4h, funding] = await Promise.all([
    fetchHistoricalOHLCV(coin, '15m', yearsBack),
    fetchHistoricalOHLCV(coin, '1h', yearsBack),
    fetchHistoricalOHLCV(coin, '4h', yearsBack),
    fetchHistoricalFunding(coin, yearsBack),
  ]);
  if (c15m.length < 200 || c1h.length < 20 || c4h.length < 20) return [];

  const signals: SignalEvent[] = [];
  let lastDir: 'long' | 'short' | null = null;
  const startIdx = Math.max(OF_VP_WINDOW, OF_HI24_WINDOW, 16);

  for (let i = startIdx; i < c15m.length; i += OF_EVAL_STRIDE) {
    const candle = c15m[i];
    const t = candle.time;
    const price = candle.close;

    const rsi15m = simpleRSI14(c15m.slice(Math.max(0, i - 14), i + 1).map(c => c.close));

    const idx1h = lastClosedIndexBefore(c1h, t, TF_MS['1h']);
    const idx4h = lastClosedIndexBefore(c4h, t, TF_MS['4h']);
    const rsi1h = idx1h >= 14 ? simpleRSI14(c1h.slice(Math.max(0, idx1h - 14), idx1h + 1).map(c => c.close)) : null;
    const rsi4h = idx4h >= 14 ? simpleRSI14(c4h.slice(Math.max(0, idx4h - 14), idx4h + 1).map(c => c.close)) : null;

    const vp = computeVolumeProfile(c15m.slice(Math.max(0, i - OF_VP_WINDOW + 1), i + 1));
    if (!vp) continue;

    const fundingIdx = lastClosedIndexBefore(funding, t, 0);
    const fundingRatePct = fundingIdx >= 0 ? funding[fundingIdx].ratePct : null;

    const { bias } = scoreOrderFlowBias(rsi15m, rsi1h, rsi4h, price, vp.poc, vp.vwap, fundingRatePct);
    if (bias === 'neutral' || bias === lastDir) continue;

    const hi24Window = c15m.slice(Math.max(0, i - OF_HI24_WINDOW + 1), i + 1);
    const hi24 = Math.max(...hi24Window.map(c => c.high));
    const lo24 = Math.min(...hi24Window.map(c => c.low));

    const zones = computeOrderFlowZones(bias, price, vp, hi24, lo24);
    if (!zones) continue;

    signals.push({
      // Order-flow signals evaluate at candle i using only past data, so the signal
      // is knowable at its own close — fill index and price equal the eval candle.
      timestamp: t, index: i, fillIndex: i, fillPrice: price, armIndex: i, dir: bias,
      anchorPrice: price, entryPrice: price, sl: zones.sl, tp: zones.tp, pending: false,
    });
    lastDir = bias;
  }

  return simulateTrades(signals, c15m, coin);
}

export interface OrderFlowBacktestResult {
  coins:       CoinId[];
  failedCoins: CoinId[];
  yearsBack:   number;
  side:        BacktestSide;
}

export async function runOrderFlowBacktest(
  coins:      CoinId[],
  yearsBack:  number,
  onProgress?: (done: number, total: number, currentCoin: CoinId) => void,
): Promise<OrderFlowBacktestResult> {
  const CONCURRENCY = 2; // lighter than the EMA sweep — 4 fetches/coin (15m+1h+4h+funding) instead of 1
  const allTrades: SimulatedTrade[] = [];
  const perCoin: Partial<Record<CoinId, BacktestStats>> = {};
  const failedCoins: CoinId[] = [];
  let done = 0;

  async function processCoin(coin: CoinId) {
    try {
      const trades = await processOrderFlowCoin(coin, yearsBack);
      if (trades.length === 0) failedCoins.push(coin);
      allTrades.push(...trades);
      perCoin[coin] = computeStats(trades);
    } catch (err) {
      failedCoins.push(coin);
      console.warn(`Order flow backtest: failed to fetch ${coin}`, err);
    } finally {
      done++;
      onProgress?.(done, coins.length, coin);
    }
  }

  let idx = 0;
  async function worker() {
    while (idx < coins.length) {
      const coin = coins[idx++];
      await processCoin(coin);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  return {
    coins, failedCoins, yearsBack,
    side: { stats: computeStats(allTrades), perCoin, trades: allTrades },
  };
}
