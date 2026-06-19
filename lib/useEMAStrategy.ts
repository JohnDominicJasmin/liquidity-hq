'use client';
import { useState, useEffect, useRef } from 'react';
import { CoinId, BINANCE_SYMS, BYBIT_SYMS } from './marketStore';

/* ── Math helpers ─────────────────────────────────────────────────────────── */
function emaArr(closes: number[], period: number): number[] {
  const result = new Array<number>(closes.length).fill(NaN);
  if (closes.length < period) return result;
  const k = 2 / (period + 1);
  let e = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = e;
  for (let i = period; i < closes.length; i++) {
    e = closes[i] * k + e * (1 - k);
    result[i] = e;
  }
  return result;
}

function smaArr(values: number[], period: number): number[] {
  return values.map((_, i) => {
    if (i < period - 1) return NaN;
    return values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  });
}

function volMA(volumes: number[], period = 20): number {
  const slice = volumes.slice(-period).filter(v => !isNaN(v));
  return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
}


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
  coin:        CoinId,
  tf:          string,
  fundingRate: number | null,
  oiPct:       number | null,
): StrategySignal {
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
          fetchOHLCV(coin, bnInterval, byInterval, 200),
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
        const e9arr   = emaArr(cl4,  9);
        const e20arr  = emaArr(cl4, 20);
        const e50arr  = emaArr(cl4, 50);
        const s200arr = smaArr(cl1d, 200);

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
            label: 'EMA 9/20 Cross',
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
            label: 'OI Confirming',
            pass:  oiOK,
            detail: oiPct == null
              ? 'OI data unavailable'
              : `OI ${oiPct >= 0 ? '+' : ''}${oiPct.toFixed(2)}% in 1h — ${oiOK ? 'stable or rising (healthy)' : 'sharp drop (abort — position covering cascade)'}`,
          },
          {
            label: 'Volume Above MA',
            pass:  volAboveMA,
            detail: volma20 > 0
              ? `Candle vol ${(lastVol / 1e6).toFixed(2)}M vs MA ${(volma20 / 1e6).toFixed(2)}M (${(lastVol / volma20 * 100).toFixed(0)}%)`
              : 'Volume data unavailable',
          },
        ];

        // Find most recent candle where EMA 9/20 crossed AND close confirmed above/below EMA 50
        let signalTimestamp: number | null = null;
        let signalAnchorPrice: number | null = null;
        let signalDir: 'long' | 'short' | null = null;

        // Primary signal: gated by 200 SMA (used for EMA ribbon card + Grok context)
        if (above200D) {
          for (let i = cRibbon.length - 1; i >= 1; i--) {
            if (e9arr[i] > e20arr[i] && e9arr[i - 1] <= e20arr[i - 1] && cRibbon[i].close > (e50arr[i] ?? 0)) {
              signalTimestamp   = cRibbon[i].time;
              signalAnchorPrice = cRibbon[i].low;
              signalDir         = 'long';
              break;
            }
          }
        } else {
          for (let i = cRibbon.length - 1; i >= 1; i--) {
            if (e9arr[i] < e20arr[i] && e9arr[i - 1] >= e20arr[i - 1] && cRibbon[i].close < (e50arr[i] ?? Infinity)) {
              signalTimestamp   = cRibbon[i].time;
              signalAnchorPrice = cRibbon[i].high;
              signalDir         = 'short';
              break;
            }
          }
        }

        // Chart markers: EMA9/20 cross + close confirms direction vs EMA50
        const signalLongs:  Array<{ timestamp: number; anchorPrice: number }> = [];
        const signalShorts: Array<{ timestamp: number; anchorPrice: number }> = [];

        for (let i = 1; i < cRibbon.length; i++) {
          const e9 = e9arr[i], e20 = e20arr[i], e50 = e50arr[i];
          if (!isFinite(e9) || !isFinite(e20) || !isFinite(e50)) continue;
          const cls = cRibbon[i].close;

          if (e9 > e20 && e9arr[i - 1] <= e20arr[i - 1] && cls > e50) {
            signalLongs.push({ timestamp: cRibbon[i].time, anchorPrice: cRibbon[i].low });
          }

          if (e9 < e20 && e9arr[i - 1] >= e20arr[i - 1] && cls < e50) {
            signalShorts.push({ timestamp: cRibbon[i].time, anchorPrice: cRibbon[i].high });
          }
        }

        if (!mountedRef.current) return;
        setSig({
          verdict, phase, conditions,
          ema9_4h: ema9, ema20_4h: ema20, ema50_4h: ema50, sma200_1d: sma200,
          volMA20: volma20, lastVol, priceInValueZone: inValueZone,
          sl, tp, loading: false, error: null,
          signalTimestamp, signalAnchorPrice, signalDir,
          signalLongs, signalShorts,
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
  }, [coin, tf, fundingRate, oiPct]);

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
