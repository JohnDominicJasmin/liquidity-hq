'use client';
import { useState, useEffect, useRef } from 'react';
import { CoinId, BINANCE_SYMS, BYBIT_SYMS } from './marketStore';
import {
  emaArr, smaArr, volMA, atrArr, detectEMASignals,
  SignalFilterParams, DEFAULT_FILTER_PARAMS, ANTICHOP_DISABLED_PARAMS,
} from './strategyCore';
import { getWaveTrendConfirmation } from './waveTrend';

export type { SignalFilterParams } from './strategyCore';
export { DEFAULT_FILTER_PARAMS, ANTICHOP_DISABLED_PARAMS } from './strategyCore';

/* ── Types ───────────────────────────────────────────────────────────────── */
export type StrategyVerdict =
  | 'LONG_SETUP'
  | 'SHORT_SETUP'
  | 'TRENDING_LONG'
  | 'TRENDING_SHORT'
  | 'FREEZE'
  | 'LOADING';

export interface StrategyCondition {
  label: string;
  pass: boolean | null; // null = not yet relevant / n/a
  detail: string;
}

export interface StrategySignal {
  verdict:           StrategyVerdict;
  phase:             string;
  conditions:        StrategyCondition[];
  ema9_4h:           number | null;
  ema20_4h:          number | null;
  ema50_4h:          number | null;
  sma200_1d:         number | null;
  volMA20:           number | null;
  lastVol:           number | null;
  priceInValueZone:  boolean;
  sl:                number | null;
  tp:                number | null;
  loading:           boolean;
  error:             string | null;
  signalTimestamp:   number | null;
  signalAnchorPrice: number | null;
  signalDir:         'long' | 'short' | null;
  signalLongs:  Array<{ timestamp: number; anchorPrice: number }>;
  signalShorts: Array<{ timestamp: number; anchorPrice: number }>;
  atrLast:    number | null;  // last ATR(14) — for Grok context
  ema50Slope: number | null;  // EMA50 slope over last 5 bars as a fraction
}

interface OHLCV { time: number; open: number; high: number; low: number; close: number; volume: number }

/* ── Fetch helpers ───────────────────────────────────────────────────────── */
async function fetchBinanceFuturesKlines(sym: string, interval: string, limit: number): Promise<OHLCV[]> {
  const r = await fetch(
    `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`,
    { signal: AbortSignal.timeout(12_000) }
  );
  if (!r.ok) throw new Error(`Binance futures klines ${r.status}`);
  const raw = await r.json() as (string | number)[][];
  return raw.map(k => ({
    time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
}

async function fetchBybitKlines(sym: string, interval: string, limit: number): Promise<OHLCV[]> {
  const r = await fetch(
    `https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=${interval}&limit=${limit}`,
    { signal: AbortSignal.timeout(12_000) }
  );
  if (!r.ok) throw new Error(`Bybit klines ${r.status}`);
  const d = await r.json() as { result?: { list?: string[][] } };
  const list = [...(d?.result?.list ?? [])].reverse();
  return list.map(k => ({
    time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
}

async function fetchOHLCV(coin: CoinId, bnInterval: string, bybitInterval: string, limit: number): Promise<OHLCV[]> {
  const bnSym = BINANCE_SYMS[coin];
  const bySym = BYBIT_SYMS[coin];
  if (bnSym) return fetchBinanceFuturesKlines(bnSym, bnInterval, limit);
  if (bySym) return fetchBybitKlines(bySym, bybitInterval, limit);
  throw new Error(`No symbol for ${coin}`);
}

/* ── Initial / loading state ─────────────────────────────────────────────── */
export const STRATEGY_LOADING: StrategySignal = {
  verdict: 'LOADING', phase: 'Loading…', conditions: [],
  ema9_4h: null, ema20_4h: null, ema50_4h: null, sma200_1d: null,
  volMA20: null, lastVol: null, priceInValueZone: false,
  sl: null, tp: null, loading: true, error: null,
  signalTimestamp: null, signalAnchorPrice: null, signalDir: null,
  signalLongs: [], signalShorts: [],
  atrLast: null, ema50Slope: null,
};

/* ── TF → exchange interval strings ─────────────────────────────────────── */
const TF_BN: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '4h': '4h', '1d': '1d',
};
const TF_BY: Record<string, string> = {
  '1m': '1', '5m': '5', '15m': '15', '30m': '30',
  '1h': '60', '4h': '240', '1d': 'D',
};

/* ── Main hook ───────────────────────────────────────────────────────────── */
export function useEMAStrategy(
  coin:         CoinId,
  tf:           string,
  fundingRate:  number | null,
  oiPct:        number | null,
  filterParams: SignalFilterParams = DEFAULT_FILTER_PARAMS,
): StrategySignal {
  const { spreadMinPct, atrMult, persistBoost } = filterParams;
  const [sig, setSig] = useState<StrategySignal>(STRATEGY_LOADING);
  const mountedRef    = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setSig(STRATEGY_LOADING);

    const bnInterval = TF_BN[tf] ?? '4h';
    const byInterval = TF_BY[tf] ?? '240';

    const load = async () => {
      try {
        const [cRibbon, c1d] = await Promise.all([
          fetchOHLCV(coin, bnInterval, byInterval, 500),
          fetchOHLCV(coin, '1d', 'D', 220),
        ]);
        if (!mountedRef.current) return;
        if (cRibbon.length < 55 || c1d.length < 205) {
          setSig({ ...STRATEGY_LOADING, loading: false, error: 'Not enough candle data', signalTimestamp: null, signalAnchorPrice: null, signalDir: null });
          return;
        }

        const cl4  = cRibbon.map(c => c.close);
        const vol4 = cRibbon.map(c => c.volume);
        const cl1d = c1d.map(c => c.close);

        // Indicator arrays
        const e9arr    = emaArr(cl4,  9);
        const e20arr   = emaArr(cl4, 20);
        const e50arr   = emaArr(cl4, 50);
        const s200arr  = smaArr(cl1d, 200); // Daily SMA200 — used for strategy card
        const atr14    = atrArr(cRibbon, 14);

        const ema9   = e9arr[e9arr.length - 1];
        const ema20  = e20arr[e20arr.length - 1];
        const ema50  = e50arr[e50arr.length - 1];
        const sma200 = s200arr[s200arr.length - 1];

        const price   = cl4[cl4.length - 1];
        const lastVol = vol4[vol4.length - 1];
        const volma20 = volMA(vol4, 20);
        const priceD  = cl1d[cl1d.length - 1];

        // Strategy rules
        const above200D  = priceD > sma200;
        const ribbonBull = ema9 > ema20 && ema20 > ema50;
        const ribbonBear = ema50 > ema20 && ema20 > ema9;

        // Value zone: price between the 9 and 20 EMA (from the correct side)
        const inVZoneLong  = ribbonBull && price <= ema9 && price >= ema20;
        const inVZoneShort = ribbonBear && price >= ema9 && price <= ema20;
        const inValueZone  = inVZoneLong || inVZoneShort;

        // Funding: for longs ≤ +0.05%; for shorts ≥ -0.05%
        const fundingOK = fundingRate == null ? null
          : ribbonBull ? fundingRate <= 0.0005
          : ribbonBear ? fundingRate >= -0.0005
          : null;

        // OI: not sharply dropping (> -5% in 1h is OK)
        const oiOK = oiPct == null ? null : oiPct > -5;

        // Volume on current 4H candle above MA
        const volAboveMA = volma20 > 0 && lastVol >= volma20 * 0.7;

        // Verdict
        let verdict: StrategyVerdict = 'FREEZE';
        let phase = 'No clear setup';

        if (above200D && ribbonBull) {
          if (inVZoneLong) {
            verdict = 'LONG_SETUP';
            phase   = 'In Value Zone — price pulled back to 20 EMA, entry eligible';
          } else if (price > ema9) {
            verdict = 'TRENDING_LONG';
            phase   = 'Trending long — above 9 EMA, wait for pullback into value zone';
          } else if (price < ema50) {
            verdict = 'FREEZE';
            phase   = 'Price sliced below 50 EMA — ribbon may be breaking, wait';
          } else {
            verdict = 'TRENDING_LONG';
            phase   = 'Between 20 and 50 EMA — ribbon aligned, not yet in entry zone';
          }
        } else if (!above200D && ribbonBear) {
          if (inVZoneShort) {
            verdict = 'SHORT_SETUP';
            phase   = 'In Value Zone — dead-cat bounce to 20 EMA, entry eligible';
          } else if (price < ema9) {
            verdict = 'TRENDING_SHORT';
            phase   = 'Trending short — below 9 EMA, wait for rally into value zone';
          } else if (price > ema50) {
            verdict = 'FREEZE';
            phase   = 'Price above 50 EMA — bearish breakdown not confirmed yet';
          } else {
            verdict = 'TRENDING_SHORT';
            phase   = 'Between 20 and 50 EMA — ribbon aligned bearish, not in entry zone';
          }
        } else {
          verdict = 'FREEZE';
          phase   = above200D
            ? 'Daily above 200 SMA but 4H ribbon not bullish — wait for EMA alignment'
            : 'Daily below 200 SMA but 4H ribbon not bearish — wait for EMA alignment';
        }

        // WaveTrend (Cipher B) confirmation — cross-from-extreme or divergence agreeing
        // with the verdict direction. A separate, orthogonal momentum confirmation
        // layered on top of the EMA ribbon, not a replacement for it.
        const wtDir: 'long' | 'short' | null =
          (verdict === 'LONG_SETUP' || verdict === 'TRENDING_LONG') ? 'long' :
          (verdict === 'SHORT_SETUP' || verdict === 'TRENDING_SHORT') ? 'short' : null;
        const wtConfirm = getWaveTrendConfirmation(cRibbon, wtDir);

        // SL / TP (0.5% buffer beyond 50 EMA)
        const BUF = 0.005;
        let sl: number | null = null;
        let tp: number | null = null;
        if (verdict === 'LONG_SETUP') {
          sl = ema50 * (1 - BUF);
          tp = price + (price - sl) * 2;
        } else if (verdict === 'SHORT_SETUP') {
          sl = ema50 * (1 + BUF);
          tp = price - (sl - price) * 2;
        }

        // Conditions checklist
        const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
        const conditions: StrategyCondition[] = [
          {
            label: '200 SMA Filter (Daily)',
            pass:  above200D ? true : (ribbonBear ? true : false),
            detail: above200D
              ? `Price $${fmt(priceD)} above Daily 200 SMA $${fmt(sma200)} — LONG only`
              : `Price below Daily 200 SMA — SHORT only`,
          },
          {
            label: 'Ribbon Aligned',
            pass:  ribbonBull || ribbonBear,
            detail: ribbonBull
              ? `Bullish: EMA9 ${fmt(ema9)} > EMA20 ${fmt(ema20)} > EMA50 ${fmt(ema50)}`
              : ribbonBear
                ? `Bearish: EMA50 ${fmt(ema50)} > EMA20 ${fmt(ema20)} > EMA9 ${fmt(ema9)}`
                : `Not aligned — ribbon tangled`,
          },
          {
            label: 'Trend Signal (fast/slow cross)',
            pass:  above200D ? ema9 > ema20 : ema9 < ema20,
            detail: above200D
              ? (ema9 > ema20
                ? `EMA9 ${fmt(ema9)} crossed above EMA20 ${fmt(ema20)} — bullish cross confirmed`
                : `EMA9 ${fmt(ema9)} still below EMA20 ${fmt(ema20)} — waiting for bullish cross`)
              : (ema9 < ema20
                ? `EMA9 ${fmt(ema9)} crossed below EMA20 ${fmt(ema20)} — bearish cross confirmed`
                : `EMA9 ${fmt(ema9)} still above EMA20 ${fmt(ema20)} — waiting for bearish cross`),
          },
          {
            label: 'Close vs EMA 50',
            pass:  above200D ? price > ema50 : price < ema50,
            detail: above200D
              ? (price > ema50
                ? `Close $${fmt(price)} above EMA50 $${fmt(ema50)} — long entry confirmed`
                : `Close $${fmt(price)} below EMA50 $${fmt(ema50)} — wait for candle close above EMA 50`)
              : (price < ema50
                ? `Close $${fmt(price)} below EMA50 $${fmt(ema50)} — short entry confirmed`
                : `Close $${fmt(price)} above EMA50 $${fmt(ema50)} — wait for candle close below EMA 50`),
          },
          {
            label: 'Price in Value Zone',
            pass:  (verdict === 'LONG_SETUP' || verdict === 'SHORT_SETUP') ? inValueZone : null,
            detail: inValueZone
              ? `Price in EMA9–EMA20 zone — entry eligible`
              : `Not in value zone yet — wait for pullback to 20 EMA`,
          },
          {
            label: 'Funding Rate',
            pass:  fundingOK,
            detail: fundingRate == null
              ? 'Funding unavailable'
              : `${(fundingRate * 100).toFixed(4)}% — ${fundingOK ? 'safe, proceed' : 'excessive, skip entry (bleed/squeeze risk)'}`,
          },
          {
            label: 'Open Interest Confirming',
            pass:  oiOK,
            detail: oiPct == null
              ? 'Open interest data unavailable'
              : `Open interest ${oiPct >= 0 ? '+' : ''}${oiPct.toFixed(2)}% in 1h — ${oiOK ? 'stable or rising (healthy)' : 'sharp drop (abort — position covering cascade)'}`,
          },
          {
            label: 'Volume Above MA',
            pass:  volAboveMA,
            detail: volma20 > 0
              ? `Candle vol ${(lastVol / 1e6).toFixed(2)}M vs MA ${(volma20 / 1e6).toFixed(2)}M (${(lastVol / volma20 * 100).toFixed(0)}%)`
              : 'Volume data unavailable',
          },
          {
            label: 'WaveTrend Confirming',
            pass:  wtConfirm.pass,
            detail: wtConfirm.detail,
          },
        ];

        // Find most recent candle where EMA 9/20 crossed AND close confirmed above/below EMA 50
        let signalTimestamp: number | null = null;
        let signalAnchorPrice: number | null = null;
        let signalDir: 'long' | 'short' | null = null;

        // Anti-chop filters applied to all signal scans:
        //   ATR buffer:    close must clear EMA50 by ≥ 35% of ATR(14) — rejects marginal grazes
        //   Slope filter:  EMA50 must be trending in signal direction over last 5 bars (≥ 0.1%)
        //                  Flat EMA50 = ranging market = skip
        //   Spread filter: EMA9 and EMA20 must be ≥ 0.3% of price apart at confirmation candle.
        //                  Tangled ribbons (tight spread) = chop = skip. Trending ribbons are clearly
        //                  separated. This is the primary filter against sideways whipsaw signals.
        const ATR_MULT       = atrMult;
        const SLOPE_BARS     = 5;
        const SLOPE_MIN      = 0.001;
        const SPREAD_MIN_PCT = spreadMinPct;

        const slopeOK = (k: number, dir: 'long' | 'short'): boolean => {
          if (k < SLOPE_BARS || !isFinite(e50arr[k - SLOPE_BARS])) return true;
          const s = (e50arr[k] - e50arr[k - SLOPE_BARS]) / e50arr[k - SLOPE_BARS];
          return dir === 'long' ? s > -SLOPE_MIN : s < SLOPE_MIN;
        };

        const spreadOK = (k: number): boolean => {
          const p = cRibbon[k].close;
          return p > 0 && Math.abs(e9arr[k] - e20arr[k]) / p >= SPREAD_MIN_PCT;
        };

        // Primary signal: gated by 200 SMA (used for EMA ribbon card + Grok context)
        if (above200D) {
          for (let i = cRibbon.length - 1; i >= 1; i--) {
            const e50i = e50arr[i] ?? 0;
            const atrBuf = (atr14[i] ?? 0) * ATR_MULT;
            if (e9arr[i] > e20arr[i] && e9arr[i - 1] <= e20arr[i - 1]
                && cRibbon[i].close > e50i + atrBuf
                && slopeOK(i, 'long')) {
              signalTimestamp   = cRibbon[i].time;
              signalAnchorPrice = cRibbon[i].low;
              signalDir         = 'long';
              break;
            }
          }
        } else {
          for (let i = cRibbon.length - 1; i >= 1; i--) {
            const e50i = e50arr[i] ?? Infinity;
            const atrBuf = (atr14[i] ?? 0) * ATR_MULT;
            if (e9arr[i] < e20arr[i] && e9arr[i - 1] >= e20arr[i - 1]
                && cRibbon[i].close < e50i - atrBuf
                && slopeOK(i, 'short')) {
              signalTimestamp   = cRibbon[i].time;
              signalAnchorPrice = cRibbon[i].high;
              signalDir         = 'short';
              break;
            }
          }
        }

        // Chart markers — delegated to the shared core (lib/strategyCore.ts) so live
        // signals and the backtest engine run the exact same detection logic and can
        // never silently drift apart. See strategyCore.ts for the full rule writeup:
        // 2-step arm/confirm, ATR buffer, EMA50 slope, ribbon spread, whipsaw persistence,
        // and strict buy/sell alternation.
        const detected = detectEMASignals(cRibbon, tf, filterParams);
        const signalLongs  = detected.signalLongs.map(s => ({ timestamp: s.timestamp, anchorPrice: s.anchorPrice }));
        const signalShorts = detected.signalShorts.map(s => ({ timestamp: s.timestamp, anchorPrice: s.anchorPrice }));

        // Expose ATR and EMA50 slope for Grok context (Quick/Deep Research + chatbot)
        const atrLast = isFinite(atr14[atr14.length - 1]) ? atr14[atr14.length - 1] : null;
        const slopeIdx = e50arr.length - 1;
        const ema50Slope = (slopeIdx >= SLOPE_BARS && isFinite(e50arr[slopeIdx - SLOPE_BARS]))
          ? (e50arr[slopeIdx] - e50arr[slopeIdx - SLOPE_BARS]) / e50arr[slopeIdx - SLOPE_BARS]
          : null;

        if (!mountedRef.current) return;
        setSig({
          verdict, phase, conditions,
          ema9_4h: ema9, ema20_4h: ema20, ema50_4h: ema50, sma200_1d: sma200,
          volMA20: volma20, lastVol, priceInValueZone: inValueZone,
          sl, tp, loading: false, error: null,
          signalTimestamp, signalAnchorPrice, signalDir,
          signalLongs, signalShorts,
          atrLast, ema50Slope,
        });
      } catch (err) {
        if (!mountedRef.current) return;
        setSig({ ...STRATEGY_LOADING, loading: false, error: String(err) });
      }
    };

    load();
    const iv = setInterval(load, 5 * 60_000);
    return () => {
      mountedRef.current = false;
      clearInterval(iv);
    };
  }, [coin, tf, fundingRate, oiPct, spreadMinPct, atrMult, persistBoost]);

  return sig;
}

/* ── Grok context summary line ───────────────────────────────────────────── */
export function strategyToGrokLine(sig: StrategySignal, tf = '4h'): string {
  if (sig.loading || sig.verdict === 'LOADING') return 'Loading…';
  if (sig.error) return `Error: ${sig.error}`;
  const passing = sig.conditions.filter(c => c.pass === true).length;
  const total   = sig.conditions.filter(c => c.pass !== null).length;
  const condStr = `${passing}/${total} conditions passing`;
  const sltp    = sig.sl && sig.tp
    ? ` · SL $${sig.sl.toFixed(4)} · TP $${sig.tp.toFixed(4)}`
    : '';
  return `[${tf.toUpperCase()} ribbon + 1D SMA200 filter] ${sig.verdict} · ${sig.phase} · ${condStr}${sltp}`;
}
