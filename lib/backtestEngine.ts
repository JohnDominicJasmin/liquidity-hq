// Historical backtest engine for the EMA ribbon strategy.
// Reuses the exact same signal-detection logic as the live hook (lib/strategyCore.ts)
// so backtest results can never silently diverge from what fires on the live chart.

import { CoinId, BINANCE_SYMS, BYBIT_SYMS } from './marketStore';
import {
  OHLCV, SignalEvent, SignalFilterParams,
  DEFAULT_FILTER_PARAMS, ANTICHOP_DISABLED_PARAMS, detectEMASignals,
} from './strategyCore';
import { getWaveTrendConfirmation, WaveTrendParams, DEFAULT_WT_PARAMS } from './waveTrend';

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
  '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d',
};
const TF_BY: Record<string, string> = {
  '30m': '30', '1h': '60', '4h': '240', '1d': 'D',
};
const TF_MS: Record<string, number> = {
  '30m': 30 * 60_000, '1h': 3_600_000, '4h': 4 * 3_600_000, '1d': 86_400_000,
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
  rMultiple:  number;                  // +2 win, -1 loss, 0 open (fixed 2:1 R:R, set at signal confirmation)
}

function simulateTrade(signal: SignalEvent, candles: OHLCV[], coin: CoinId): SimulatedTrade {
  const { dir, index, entryPrice, sl, tp, timestamp } = signal;
  for (let j = index + 1; j < candles.length; j++) {
    const c = candles[j];
    const hitTP = dir === 'long' ? c.high >= tp : c.low <= tp;
    const hitSL = dir === 'long' ? c.low <= sl : c.high >= sl;
    // Conservative same-candle tie-break: with only OHLC data we can't know intracandle
    // order, so assume the worse outcome (SL) hit first.
    if (hitSL) {
      return { coin, dir, entryTime: timestamp, entryPrice, sl, tp, exitTime: c.time, exitPrice: sl, outcome: 'loss', rMultiple: -1 };
    }
    if (hitTP) {
      return { coin, dir, entryTime: timestamp, entryPrice, sl, tp, exitTime: c.time, exitPrice: tp, outcome: 'win', rMultiple: 2 };
    }
  }
  return { coin, dir, entryTime: timestamp, entryPrice, sl, tp, exitTime: null, exitPrice: null, outcome: 'open', rMultiple: 0 };
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
        const onSignals  = detectEMASignals(candles, tf, DEFAULT_FILTER_PARAMS);
        const offSignals = detectEMASignals(candles, tf, ANTICHOP_DISABLED_PARAMS);
        const onTrades  = [...simulateTrades(onSignals.signalLongs, candles, coin), ...simulateTrades(onSignals.signalShorts, candles, coin)];
        const offTrades = [...simulateTrades(offSignals.signalLongs, candles, coin), ...simulateTrades(offSignals.signalShorts, candles, coin)];
        allTradesOn.push(...onTrades);
        allTradesOff.push(...offTrades);
        perCoinOn[coin]  = computeStats(onTrades);
        perCoinOff[coin] = computeStats(offTrades);

        for (const name of variantNames) {
          const params = WT_VARIANTS[name];
          const wtLongs  = filterSignalsByWaveTrend(onSignals.signalLongs, candles, params);
          const wtShorts = filterSignalsByWaveTrend(onSignals.signalShorts, candles, params);
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
