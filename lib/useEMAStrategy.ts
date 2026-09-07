'use client';
import { useState, useEffect, useRef } from 'react';
import { CoinId, BINANCE_SYMS, BYBIT_SYMS } from './marketStore.ts';
import { bybitSymbolPriceFactor } from './coins.ts';
import {
  emaArr, smaArr, smaNMArr, bollingerBandsArr, psarArr, macdArr, volMA, atrArr, detectEMASignals,
  choppinessIndexArr, chopRegimeFor, ChopRegime,
  SignalFilterParams, DEFAULT_FILTER_PARAMS, STRICT_FILTER_PARAMS,
  SPREAD_MIN_BY_TF,
} from './strategyCore.ts';
import { detectRSIDivergence, rsiArr } from './divergence.ts';
import { describeSelection } from './strategyRegistry.ts';
import { simulateTrades } from './backtestEngine.ts';
import { TF_MS, CLOSE_SKEW_MS, dropForming, msUntilNextClose, sameCandle } from './candles.ts';
import { getWaveTrendConfirmation } from './waveTrend.ts';

export type { SignalFilterParams } from './strategyCore.ts';
export { DEFAULT_FILTER_PARAMS, STRICT_FILTER_PARAMS } from './strategyCore.ts';

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
  signalLongs:  Array<{ timestamp: number; anchorPrice: number; pending: boolean }>;
  signalShorts: Array<{ timestamp: number; anchorPrice: number; pending: boolean }>;
  atrLast:    number | null;  // last ATR(14) - for Grok context
  ema50Slope: number | null;  // EMA50 slope over last 5 bars as a fraction
  chopIndex:  number | null;  // Choppiness Index (0-100) - high = range-bound
  chopRegime: ChopRegime | null;
  // RSI divergence - a LEADING possible-reversal warning (momentum fading while
  // price still pushes to a new extreme), distinct from the ribbon's lagging
  // trend-continuation signal. 'bullish' = possible reversal up, 'bearish' = down.
  reversalWarnings: Array<{ timestamp: number; anchorPrice: number; dir: 'bullish' | 'bearish' }>;
  // Outcome of every signal detected in the loaded candle window, simulated with the
  // backtest engine's fill rules (entry after the persistence hold, SL at the EMA50
  // buffer, 2:1 TP). Free to compute - reuses the candles already fetched.
  recentStats: { total: number; wins: number; losses: number; open: number; netR: number } | null;
  // True when recentStats has enough closed trades to be meaningful (>=5) and the win
  // rate is clearly sub-coinflip (<40%). Surfaced so a confident-looking LONG/SHORT
  // SETUP badge doesn't overstate a setup this coin+timeframe has recently lost on -
  // no amount of entry-timing filtering fixes a track record like that (tested and
  // reverted: neither a Choppiness Index gate nor a range-position gate at the
  // confirmation candle moved the needle, because a genuine EMA50 breakout is by
  // definition already near the edge of its own recent range).
  weakEdge: boolean;
  // #985 gap 1: null when nothing is selected (the standard, unpersonalised
  // signal - same as what Telegram/push alerts fire on). Non-null names what
  // the trader chose, via the same describeSelection helper QUICK/DEEP/
  // LiquidityAI already use. Naming the selection is not the same claim as
  // the call having moved - see verdictChangedBySelection below for that.
  selectionLabel: string | null;
  // #997/SMA (second indicator): true only when a gating indicator (SMA
  // today) actually downgraded a SETUP to its matching TRENDING state THIS
  // render - not "a gating-capable indicator is selected", which could be
  // selected and simply agree with the ribbon, changing nothing. The
  // distinction matters for what EMASignal.tsx is allowed to say: "your
  // selection changed this call" is only true when this is true, and RSI
  // alone (advisory-only) can never make it true.
  verdictChangedBySelection: boolean;
}

interface OHLCV { time: number; open: number; high: number; low: number; close: number; volume: number }

/* ── Fetch helpers ───────────────────────────────────────────────────────── */
async function fetchBinanceFuturesKlines(sym: string, interval: string, limit: number): Promise<OHLCV[]> {
  const r = await fetch(
    `/api/market/klines?source=binance-futures&symbol=${sym}&interval=${interval}&limit=${limit}&closed=1`,
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
    `/api/market/klines?source=bybit&symbol=${sym}&interval=${interval}&limit=${limit}&closed=1`,
    { signal: AbortSignal.timeout(12_000) }
  );
  if (!r.ok) throw new Error(`Bybit klines ${r.status}`);
  const d = await r.json() as { result?: { list?: string[][] } };
  const list = [...(d?.result?.list ?? [])].reverse();
  // 1000PEPEUSDT / 1000BONKUSDT are quoted per 1000 tokens. This feeds the
  // Arena EMA Signal card's entry / stop-loss / take-profit, which are shown as
  // dollar prices next to a ticker quoting per-token - so without this those
  // three numbers were 1000x on exactly two coins. Volume left alone: it is
  // only ever compared against its own moving average.
  const pf = bybitSymbolPriceFactor(sym);
  return list.map(k => ({
    time: +k[0], open: +k[1] * pf, high: +k[2] * pf, low: +k[3] * pf, close: +k[4] * pf, volume: +k[5],
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
  chopIndex: null, chopRegime: null,
  reversalWarnings: [],
  recentStats: null,
  weakEdge: false,
  selectionLabel: null,
  verdictChangedBySelection: false,
};

/* ── Module-level kline cache - survives component unmount/remount ───────── */
interface KlineCacheEntry { cRibbon: OHLCV[]; c1d: OHLCV[]; fetchedAt: number }
const klineCache = new Map<string, KlineCacheEntry>();
/* The cache entry is valid while no candle has CLOSED since it was written,
   not for a fixed number of minutes (#316). The old 5-minute TTL had no
   relationship to the data it guarded: on a 1m chart it served a candle five
   periods old, and on a 1d chart it refetched 96 times to observe one change. */

/* ── TF → exchange interval strings ─────────────────────────────────────── */
const TF_BN: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '2h': '2h', '4h': '4h', '1d': '1d',
};
const TF_BY: Record<string, string> = {
  '1m': '1', '5m': '5', '15m': '15', '30m': '30',
  '1h': '60', '2h': '120', '4h': '240', '1d': 'D',
};

/* ── Main hook ───────────────────────────────────────────────────────────── */
export function useEMAStrategy(
  coin:         CoinId,
  tf:           string,
  fundingRate:  number | null,
  oiPct:        number | null,
  filterParams: SignalFilterParams = DEFAULT_FILTER_PARAMS,
  /* #985 gap 1: the chart's own signal, client-side only per the owner's
     ruling - Telegram/push alerts (checkEMASignal in
     app/api/telegram/alert/route.ts) are untouched and keep firing on the
     standard rule regardless of what a trader has selected here. Advisory
     only - added as one more row in `conditions`, the same way funding, open
     interest, volume and WaveTrend already are (none of those gate `verdict`
     either; only the ribbon/200D/value-zone core does). Scoped to indicators
     this hook can actually compute a value for without inventing new
     indicator math - RSI today, since it is already computed elsewhere in
     this file at the same period the registry defaults to (14). SMA is
     deliberately NOT wired to the panel's SMA chip: the 200-period SMA this
     hook already uses is a different, hardcoded core gate (above200D), and
     the registry's SMA chip defaults to a 12-period length nothing here
     computes - labelling the existing 200D condition as if it reflected a
     user-configurable SMA would be wrong, not incomplete. */
  selection: readonly string[] = [],
): StrategySignal {
  const { spreadMinPct, atrMult, persistBoost } = filterParams;
  const [sig, setSig] = useState<StrategySignal>(STRATEGY_LOADING);
  const mountedRef    = useRef(true);

  // Live inputs read at compute time. Funding/OI tick frequently and the anti-chop
  // toggle swaps filter params - none of those need new candles, so they must not be
  // fetch-effect dependencies (that caused a full candle refetch + LOADING flash on
  // every funding update). They live in refs; a recompute-from-cache effect below
  // re-derives the signal when they change.
  const frRef        = useRef(fundingRate);
  const oiRef        = useRef(oiPct);
  const paramsRef    = useRef(filterParams);
  const selectionRef = useRef(selection);
  frRef.current        = fundingRate;
  oiRef.current         = oiPct;
  paramsRef.current     = filterParams;
  selectionRef.current  = selection;

  const candlesRef = useRef<{ coin: CoinId; tf: string; cRibbon: OHLCV[]; c1d: OHLCV[] } | null>(null);

  // Full signal computation from cached candles. Reassigned every render so it always
  // closes over the current coin/tf; the cache guard rejects stale candle sets.
  const computeRef = useRef<() => void>(() => {});
  computeRef.current = () => {
    const cached = candlesRef.current;
    if (!cached || cached.coin !== coin || cached.tf !== tf) return;
    const { cRibbon, c1d } = cached;
    const fundingRate  = frRef.current;
    const oiPct        = oiRef.current;
    const filterParams = paramsRef.current;
    const selection    = selectionRef.current;
    const { spreadMinPct, atrMult } = filterParams;
    try {
        const cl4  = cRibbon.map(c => c.close);
        const vol4 = cRibbon.map(c => c.volume);
        const cl1d = c1d.map(c => c.close);

        // Indicator arrays
        const e9arr    = emaArr(cl4,  9);
        const e20arr   = emaArr(cl4, 20);
        const e50arr   = emaArr(cl4, 50);
        const s200arr  = cl1d.length >= 200 ? smaArr(cl1d, 200) : [];
        const atr14    = atrArr(cRibbon, 14);

        const ema9   = e9arr[e9arr.length - 1];
        const ema20  = e20arr[e20arr.length - 1];
        const ema50  = e50arr[e50arr.length - 1];
        const sma200: number | null = s200arr.length > 0 ? s200arr[s200arr.length - 1] : null;

        const price   = cl4[cl4.length - 1];
        const lastVol = vol4[vol4.length - 1];
        const volma20 = volMA(vol4, 20);
        const priceD  = cl1d[cl1d.length - 1];

        // Strategy rules - above200D falls back to ribbon direction when SMA200 is unavailable
        const ribbonBull = ema9 > ema20 && ema20 > ema50;
        const ribbonBear = ema50 > ema20 && ema20 > ema9;
        const have200D  = sma200 != null && !isNaN(sma200);
        const above200D = have200D ? priceD > sma200 : ribbonBull;

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
            phase   = 'In Value Zone - price pulled back to 20 EMA, entry eligible';
          } else if (price > ema9) {
            verdict = 'TRENDING_LONG';
            phase   = 'Trending long - above 9 EMA, wait for pullback into value zone';
          } else if (price < ema50) {
            verdict = 'FREEZE';
            phase   = 'Price sliced below 50 EMA - ribbon may be breaking, wait';
          } else {
            verdict = 'TRENDING_LONG';
            phase   = 'Between 20 and 50 EMA - ribbon aligned, not yet in entry zone';
          }
        } else if (!above200D && ribbonBear) {
          if (inVZoneShort) {
            verdict = 'SHORT_SETUP';
            phase   = 'In Value Zone - dead-cat bounce to 20 EMA, entry eligible';
          } else if (price < ema9) {
            verdict = 'TRENDING_SHORT';
            phase   = 'Trending short - below 9 EMA, wait for rally into value zone';
          } else if (price > ema50) {
            verdict = 'FREEZE';
            phase   = 'Price above 50 EMA - bearish breakdown not confirmed yet';
          } else {
            verdict = 'TRENDING_SHORT';
            phase   = 'Between 20 and 50 EMA - ribbon aligned bearish, not in entry zone';
          }
        } else {
          verdict = 'FREEZE';
          const tfLabel = tf.toUpperCase();
          phase   = above200D
            ? `Daily above 200 SMA but ${tfLabel} ribbon not bullish - wait for EMA alignment`
            : `Daily below 200 SMA but ${tfLabel} ribbon not bearish - wait for EMA alignment`;
        }

        /* #985 gap 1, second indicator (#997 was RSI, advisory-only). Owner
           ruled a selected indicator must be able to MOVE verdict, not just
           describe it - this is the first one that does.

           SMA(12,2) is klinecharts' actual "SMA" formula, not a rolling
           mean - see smaNMArr's doc in strategyCore.ts, verified against the
           compiled source and hand-derived against the published recursive
           definition, not against the chart's own rendered line (checking a
           number against the line the same code drew is one instrument
           twice). Registry defaults (length 12, weight 2): selection carries
           indicator ids only, no per-indicator params, same limitation RSI
           already documented.

           GATING, DELIBERATELY ONE-DIRECTIONAL: can only make verdict more
           conservative, never invent or flip a direction the ribbon did not
           already establish. A SETUP downgrades to its matching TRENDING
           state when price disagrees with SMA; TRENDING and FREEZE are
           unchanged, both already non-entry. A wrong SMA value under this
           design can make a real setup look merely trending - never
           manufacture a BUY/SELL that was not already there, which is the
           safer failure direction for anything gating a trade call. */
        const smaSelected = selection.includes('SMA');
        const smaLast = smaSelected ? smaNMArr(cl4, 12, 2).at(-1) : undefined;
        const smaValid = smaSelected && smaLast != null && isFinite(smaLast);
        let verdictChangedBySelection = false;
        if (smaValid) {
          if (verdict === 'LONG_SETUP' && price <= smaLast!) {
            verdict = 'TRENDING_LONG';
            phase   = 'Selected SMA disagrees with the entry - price at or below SMA(12,2), waiting';
            verdictChangedBySelection = true;
          } else if (verdict === 'SHORT_SETUP' && price >= smaLast!) {
            verdict = 'TRENDING_SHORT';
            phase   = 'Selected SMA disagrees with the entry - price at or above SMA(12,2), waiting';
            verdictChangedBySelection = true;
          }
        }

        /* #985 gap 1, third indicator (RSI advisory, SMA gating). Bollinger
           is genuinely independent of the ribbon, unlike SMA - its middle
           band is a plain rolling mean (bollingerBandsArr in
           strategyCore.ts), not an EMA anywhere, verified against
           klinecharts' actual bollingerBands.calc rather than a
           from-memory textbook writeup. Registry defaults (length 20,
           mult 2) - same per-indicator-param limitation as SMA and RSI.

           Same one-directional gating shape as SMA, same reason: a SETUP
           downgrades to its matching TRENDING state when price disagrees
           with the middle band's implied direction; TRENDING/FREEZE are
           unchanged. Two gating indicators can each independently
           downgrade the same verdict - checked in registration order,
           whichever fires first sets both the verdict and
           verdictChangedBySelection, and a second disagreement on an
           already-downgraded TRENDING state has nothing left to do (the
           condition rows below still show each one's own agree/disagree
           read regardless of who actually moved the verdict). */
        const bollSelected = selection.includes('BOLL');
        const bollLast = bollSelected ? bollingerBandsArr(cl4, 20, 2).at(-1) : undefined;
        const bollValid = bollSelected && bollLast != null;
        if (bollValid) {
          if (verdict === 'LONG_SETUP' && price <= bollLast!.mid) {
            verdict = 'TRENDING_LONG';
            phase   = 'Selected Bollinger disagrees with the entry - price at or below the middle band, waiting';
            verdictChangedBySelection = true;
          } else if (verdict === 'SHORT_SETUP' && price >= bollLast!.mid) {
            verdict = 'TRENDING_SHORT';
            phase   = 'Selected Bollinger disagrees with the entry - price at or above the middle band, waiting';
            verdictChangedBySelection = true;
          }
        }

        /* #985 gap 1, fourth indicator (RSI advisory, SMA + Bollinger gating).
           PSAR is genuinely independent of both - pure recursive high/low-
           extreme recursion (psarArr in strategyCore.ts), no moving average
           anywhere, matching klinecharts' actual `stopAndReverse.calc`
           including its own asymmetric acceleration-factor reset between the
           two reversal branches (see psarArr's doc comment) rather than a
           textbook-symmetric rewrite - so a PSAR selection here reads exactly
           the dot the chart draws when the same indicator is also selected on
           the panel (#1016). Registry defaults (start/step/max = 0.02/0.02/
           0.2, true units - klinecharts' own x100 internal scaling is a
           createIndicator/calcParams concern, not a psarArr one).

           A trailing dot BELOW price is PSAR's own bullish reading (an
           uptrend, not yet stopped-and-reversed); above price is bearish.
           Same one-directional gating shape as SMA/Bollinger: a SETUP
           downgrades to its matching TRENDING state when PSAR disagrees;
           TRENDING/FREEZE are unchanged. Three gating indicators can each
           independently fire on the same verdict - checked in registration
           order, whichever fires first sets both the verdict and
           verdictChangedBySelection. */
        const psarSelected = selection.includes('SAR');
        const psarLast = psarSelected ? psarArr(cRibbon, 0.02, 0.02, 0.2).at(-1) : undefined;
        const psarValid = psarSelected && psarLast != null && isFinite(psarLast);
        if (psarValid) {
          if (verdict === 'LONG_SETUP' && price <= psarLast!) {
            verdict = 'TRENDING_LONG';
            phase   = 'Selected PSAR disagrees with the entry - dot at or above price, waiting';
            verdictChangedBySelection = true;
          } else if (verdict === 'SHORT_SETUP' && price >= psarLast!) {
            verdict = 'TRENDING_SHORT';
            phase   = 'Selected PSAR disagrees with the entry - dot at or below price, waiting';
            verdictChangedBySelection = true;
          }
        }

        /* #985 gap 1, fifth and last indicator (RSI advisory, SMA + Bollinger
           + PSAR gating). MACD is built entirely from the EMA family - its
           fast/slow lines use the exact same recursive SMA(N,2) formula
           (macdArr in strategyCore.ts, matching klinecharts' actual
           movingAverageConvergenceDivergence.calc) that SMA's own registry
           entry uses. Named explicitly because it is NOT independent the way
           PSAR and Bollinger are: MACD's fast line (period 12) is
           SMA(12,2) - numerically identical to SMA's own registry default.
           Selecting both SMA and MACD is one signal doubled, not two
           independent ones (#1007) - real, worth knowing, and not a reason to
           block either: a trader who selects both gets a redundant vote, not
           a wrong one, and the panel does not currently warn about
           indicator-family overlap for any pair.

           DIF (the fast-minus-slow line) above DEA (its own signal-line
           smoothing) is MACD's bullish reading; below is bearish - the
           standard interpretation, and what `macd` (the histogram, `(dif-
           dea)*2`) already encodes in its sign. Same one-directional gating
           shape as the other three: a SETUP downgrades to its matching
           TRENDING state when MACD disagrees; TRENDING/FREEZE unchanged.
           Four gating indicators can now each independently fire - checked
           in registration order, whichever fires first wins. */
        const macdSelected = selection.includes('MACD');
        const macdLast = macdSelected ? macdArr(cl4, 12, 26, 9).at(-1) : undefined;
        const macdValid = macdSelected && macdLast != null && isFinite(macdLast.dif) && isFinite(macdLast.dea);
        if (macdValid) {
          if (verdict === 'LONG_SETUP' && macdLast!.dif <= macdLast!.dea) {
            verdict = 'TRENDING_LONG';
            phase   = 'Selected MACD disagrees with the entry - DIF at or below DEA, waiting';
            verdictChangedBySelection = true;
          } else if (verdict === 'SHORT_SETUP' && macdLast!.dif >= macdLast!.dea) {
            verdict = 'TRENDING_SHORT';
            phase   = 'Selected MACD disagrees with the entry - DIF at or above DEA, waiting';
            verdictChangedBySelection = true;
          }
        }

        // WaveTrend (Cipher B) confirmation - cross-from-extreme or divergence agreeing
        // with the verdict direction. A separate, orthogonal momentum confirmation
        // layered on top of the EMA ribbon, not a replacement for it.
        const wtDir: 'long' | 'short' | null =
          (verdict === 'LONG_SETUP' || verdict === 'TRENDING_LONG') ? 'long' :
          (verdict === 'SHORT_SETUP' || verdict === 'TRENDING_SHORT') ? 'short' : null;
        const wtConfirm = getWaveTrendConfirmation(cRibbon, wtDir);

        // #985 gap 1: RSI as an advisory condition, only when the trader has
        // selected it on the Strategy panel. Same period (14) the registry
        // defaults to and this file already uses for divergence detection -
        // not a second, differently-configured RSI. >50/<50 is a directional
        // lean, not the overbought/oversold thresholds - this is asking
        // "does momentum agree with the ribbon's direction", the same
        // question WaveTrend confirmation above already asks a different way.
        const rsiSelected = selection.includes('RSI');
        const rsiLast = rsiSelected ? rsiArr(cl4, 14).at(-1) : undefined;

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
            pass:  !have200D ? null : (above200D ? true : (ribbonBear ? true : false)),
            detail: !have200D
              ? 'Insufficient daily history - ribbon used as trend proxy'
              : above200D
                ? `Price $${fmt(priceD)} above Daily 200 SMA $${sma200 !== null ? fmt(sma200) : '-'} - LONG only`
                : `Price below Daily 200 SMA - SHORT only`,
          },
          {
            label: 'Ribbon Aligned',
            pass:  ribbonBull || ribbonBear,
            detail: ribbonBull
              ? `Bullish: EMA9 ${fmt(ema9)} > EMA20 ${fmt(ema20)} > EMA50 ${fmt(ema50)}`
              : ribbonBear
                ? `Bearish: EMA50 ${fmt(ema50)} > EMA20 ${fmt(ema20)} > EMA9 ${fmt(ema9)}`
                : `Not aligned - ribbon tangled`,
          },
          {
            label: 'Trend Signal (fast/slow cross)',
            pass:  above200D ? ema9 > ema20 : ema9 < ema20,
            detail: above200D
              ? (ema9 > ema20
                ? `EMA9 ${fmt(ema9)} crossed above EMA20 ${fmt(ema20)} - bullish cross confirmed`
                : `EMA9 ${fmt(ema9)} still below EMA20 ${fmt(ema20)} - waiting for bullish cross`)
              : (ema9 < ema20
                ? `EMA9 ${fmt(ema9)} crossed below EMA20 ${fmt(ema20)} - bearish cross confirmed`
                : `EMA9 ${fmt(ema9)} still above EMA20 ${fmt(ema20)} - waiting for bearish cross`),
          },
          {
            label: 'Close vs EMA 50',
            pass:  above200D ? price > ema50 : price < ema50,
            detail: above200D
              ? (price > ema50
                ? `Close $${fmt(price)} above EMA50 $${fmt(ema50)} - long entry confirmed`
                : `Close $${fmt(price)} below EMA50 $${fmt(ema50)} - wait for candle close above EMA 50`)
              : (price < ema50
                ? `Close $${fmt(price)} below EMA50 $${fmt(ema50)} - short entry confirmed`
                : `Close $${fmt(price)} above EMA50 $${fmt(ema50)} - wait for candle close below EMA 50`),
          },
          {
            label: 'Price in Value Zone',
            pass:  (verdict === 'LONG_SETUP' || verdict === 'SHORT_SETUP') ? inValueZone : null,
            detail: inValueZone
              ? `Price in EMA9–EMA20 zone - entry eligible`
              : `Not in value zone yet - wait for pullback to 20 EMA`,
          },
          {
            label: 'Funding Rate',
            pass:  fundingOK,
            detail: fundingRate == null
              ? 'Funding unavailable'
              : `${(fundingRate * 100).toFixed(4)}% - ${fundingOK ? 'safe, proceed' : 'excessive, skip entry (bleed/squeeze risk)'}`,
          },
          {
            label: 'Open Interest Confirming',
            pass:  oiOK,
            detail: oiPct == null
              ? 'Open interest data unavailable'
              : `Open interest ${oiPct >= 0 ? '+' : ''}${oiPct.toFixed(2)}% in 1h - ${oiOK ? 'stable or rising (healthy)' : 'sharp drop (abort - position covering cascade)'}`,
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
          // #985 gap 1: only present when the trader has RSI selected -
          // absence from this list, not a null/failing row, is how "not
          // selected" is represented.
          ...(rsiSelected ? [{
            label: 'RSI Confirming',
            pass: (rsiLast == null || !isFinite(rsiLast)) ? null
              : (ribbonBull ? rsiLast > 50 : ribbonBear ? rsiLast < 50 : null),
            detail: (rsiLast == null || !isFinite(rsiLast))
              ? 'RSI unavailable'
              : `RSI(14) ${rsiLast.toFixed(1)} - ${ribbonBull
                  ? (rsiLast > 50 ? 'above 50, agrees with the bullish ribbon' : 'below 50, disagrees with the bullish ribbon')
                  : ribbonBear
                    ? (rsiLast < 50 ? 'below 50, agrees with the bearish ribbon' : 'above 50, disagrees with the bearish ribbon')
                    : 'ribbon not aligned either way'}`,
          }] : []),
          // #985 gap 1: SMA is gating (see the verdict block above) as well
          // as advisory - this row is what lets a trader see WHY a setup
          // downgraded to trending rather than only seeing the downgrade
          // happen. Present whenever selected, not only when it fires.
          ...(smaSelected ? [{
            label: 'SMA Confirming',
            pass: !smaValid ? null
              : (ribbonBull ? price > smaLast! : ribbonBear ? price < smaLast! : null),
            detail: !smaValid
              ? 'SMA unavailable'
              : `SMA(12,2) ${smaLast!.toFixed(4)} - ${ribbonBull
                  ? (price > smaLast! ? 'price above, agrees with the bullish ribbon' : 'price at or below, disagrees with the bullish ribbon - setup downgraded if it was one')
                  : ribbonBear
                    ? (price < smaLast! ? 'price below, agrees with the bearish ribbon' : 'price at or above, disagrees with the bearish ribbon - setup downgraded if it was one')
                    : 'ribbon not aligned either way'}`,
          }] : []),
          ...(bollSelected ? [{
            label: 'Bollinger Confirming',
            pass: !bollValid ? null
              : (ribbonBull ? price > bollLast!.mid : ribbonBear ? price < bollLast!.mid : null),
            detail: !bollValid
              ? 'Bollinger unavailable'
              : `Bollinger(20,2) mid ${bollLast!.mid.toFixed(4)} - ${ribbonBull
                  ? (price > bollLast!.mid ? 'price above, agrees with the bullish ribbon' : 'price at or below, disagrees with the bullish ribbon - setup downgraded if it was one')
                  : ribbonBear
                    ? (price < bollLast!.mid ? 'price below, agrees with the bearish ribbon' : 'price at or above, disagrees with the bearish ribbon - setup downgraded if it was one')
                    : 'ribbon not aligned either way'}`,
          }] : []),
          ...(psarSelected ? [{
            label: 'PSAR Confirming',
            pass: !psarValid ? null
              : (ribbonBull ? price > psarLast! : ribbonBear ? price < psarLast! : null),
            detail: !psarValid
              ? 'PSAR unavailable'
              : `PSAR ${psarLast!.toFixed(4)} - ${ribbonBull
                  ? (price > psarLast! ? 'dot below price, agrees with the bullish ribbon' : 'dot at or above price, disagrees with the bullish ribbon - setup downgraded if it was one')
                  : ribbonBear
                    ? (price < psarLast! ? 'dot above price, agrees with the bearish ribbon' : 'dot at or below price, disagrees with the bearish ribbon - setup downgraded if it was one')
                    : 'ribbon not aligned either way'}`,
          }] : []),
          ...(macdSelected ? [{
            label: 'MACD Confirming',
            pass: !macdValid ? null
              : (ribbonBull ? macdLast!.dif > macdLast!.dea : ribbonBear ? macdLast!.dif < macdLast!.dea : null),
            detail: !macdValid
              ? 'MACD unavailable'
              : `MACD DIF ${macdLast!.dif.toFixed(4)} / DEA ${macdLast!.dea.toFixed(4)} - ${ribbonBull
                  ? (macdLast!.dif > macdLast!.dea ? 'DIF above DEA, agrees with the bullish ribbon' : 'DIF at or below DEA, disagrees with the bullish ribbon - setup downgraded if it was one')
                  : ribbonBear
                    ? (macdLast!.dif < macdLast!.dea ? 'DIF below DEA, agrees with the bearish ribbon' : 'DIF at or above DEA, disagrees with the bearish ribbon - setup downgraded if it was one')
                    : 'ribbon not aligned either way'}`,
          }] : []),
        ];

        // Find most recent candle where EMA 9/20 crossed AND close confirmed above/below EMA 50
        let signalTimestamp: number | null = null;
        let signalAnchorPrice: number | null = null;
        let signalDir: 'long' | 'short' | null = null;

        // Anti-chop filters applied to all signal scans:
        //   ATR buffer:    close must clear EMA50 by ≥ 35% of ATR(14) - rejects marginal grazes
        //   Slope filter:  EMA50 must be trending in signal direction over last 5 bars (≥ 0.1%)
        //                  Flat EMA50 = ranging market = skip
        //   Spread filter: EMA9 and EMA20 must be ≥ 0.3% of price apart at confirmation candle.
        //                  Tangled ribbons (tight spread) = chop = skip. Trending ribbons are clearly
        //                  separated. This is the primary filter against sideways whipsaw signals.
        const ATR_MULT       = atrMult;
        const SLOPE_BARS     = 5;
        const SLOPE_MIN      = 0.001;
        const SPREAD_MIN_PCT = spreadMinPct > 0 ? (SPREAD_MIN_BY_TF[tf] ?? spreadMinPct) : 0;

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

        // Chart markers - delegated to the shared core (lib/strategyCore.ts) so live
        // signals and the backtest engine run the exact same detection logic and can
        // never silently drift apart. See strategyCore.ts for the full rule writeup:
        // 2-step arm/confirm, ATR buffer, EMA50 slope, ribbon spread, whipsaw persistence,
        // and strict buy/sell alternation.
        const detected = detectEMASignals(cRibbon, tf, filterParams);
        const signalLongs  = detected.signalLongs.map(s => ({ timestamp: s.timestamp, anchorPrice: s.anchorPrice, pending: s.pending }));
        const signalShorts = detected.signalShorts.map(s => ({ timestamp: s.timestamp, anchorPrice: s.anchorPrice, pending: s.pending }));

        // Recent record - confirmed signals only (pending have unreliable fillPrice at live edge)
        const confirmedSignals = [...detected.signalLongs, ...detected.signalShorts].filter(s => !s.pending);
        const simTrades = simulateTrades(confirmedSignals, cRibbon, coin);
        const rsWins    = simTrades.filter(t => t.outcome === 'win').length;
        const rsLosses  = simTrades.filter(t => t.outcome === 'loss').length;
        const rsOpen    = simTrades.filter(t => t.outcome === 'open').length;
        const rsNetR    = simTrades.reduce((a, t) => a + t.rMultiple, 0);
        const recentStats = simTrades.length > 0
          ? { total: simTrades.length, wins: rsWins, losses: rsLosses, open: rsOpen, netR: rsNetR }
          : null;
        const rsClosed = rsWins + rsLosses;
        const weakEdge = rsClosed >= 5 && (rsWins / rsClosed) < 0.4;

        // Expose ATR and EMA50 slope for Grok context (Quick/Deep Research + chatbot)
        const atrLast = isFinite(atr14[atr14.length - 1]) ? atr14[atr14.length - 1] : null;
        const slopeIdx = e50arr.length - 1;
        const ema50Slope = (slopeIdx >= SLOPE_BARS && isFinite(e50arr[slopeIdx - SLOPE_BARS]))
          ? (e50arr[slopeIdx] - e50arr[slopeIdx - SLOPE_BARS]) / e50arr[slopeIdx - SLOPE_BARS]
          : null;

        // Choppiness Index - warns the trader the coin is range-bound right now,
        // rather than relying on the persistence filter to silently eat the signal.
        const chopArr = choppinessIndexArr(cRibbon, 14);
        const chopLast = chopArr[chopArr.length - 1];
        const chopIndex = isFinite(chopLast) ? chopLast : null;
        const chopRegime = chopIndex != null ? chopRegimeFor(chopIndex) : null;

        // RSI divergence - leading reversal warning, same candle window, no extra fetch.
        const reversalWarnings = detectRSIDivergence(cRibbon, 14)
          .map(e => ({ timestamp: e.timestamp, anchorPrice: e.anchorPrice, dir: e.dir }));

        if (!mountedRef.current) return;
        setSig({
          verdict, phase, conditions,
          ema9_4h: ema9, ema20_4h: ema20, ema50_4h: ema50, sma200_1d: sma200,
          volMA20: volma20, lastVol, priceInValueZone: inValueZone,
          sl, tp, loading: false, error: null,
          signalTimestamp, signalAnchorPrice, signalDir,
          signalLongs, signalShorts,
          chopIndex, chopRegime,
          reversalWarnings,
          atrLast, ema50Slope,
          recentStats, weakEdge,
          selectionLabel: describeSelection(selection),
          verdictChangedBySelection,
        });
    } catch (err) {
      if (!mountedRef.current) return;
      setSig({ ...STRATEGY_LOADING, loading: false, error: String(err) });
    }
  };

  /* Fetch candles when coin/tf change (and every 5 min) - the only path that hits
     the network or shows the LOADING state. If module-level cache is fresh, serve
     it immediately (no loading flash) and refresh in background. */
  useEffect(() => {
    mountedRef.current = true;

    const cacheKey = `${coin}:${tf}`;
    const cached = klineCache.get(cacheKey);
    const intervalMs = TF_MS[tf] ?? TF_MS['4h'];
    const cacheHit = !!cached && sameCandle(cached.fetchedAt, intervalMs, Date.now());

    if (cacheHit) {
      candlesRef.current = { coin, tf, cRibbon: cached.cRibbon, c1d: cached.c1d };
      computeRef.current();
    } else {
      setSig(STRATEGY_LOADING);
      candlesRef.current = null;
    }

    const bnInterval = TF_BN[tf] ?? '4h';
    const byInterval = TF_BY[tf] ?? '240';

    const load = async (): Promise<boolean> => {
      try {
        const [rawRibbon, raw1d] = await Promise.all([
          fetchOHLCV(coin, bnInterval, byInterval, 1000),
          fetchOHLCV(coin, '1d', 'D', 1000),
        ]);
        if (!mountedRef.current) return false;

        /* CLOSED CANDLES ONLY (#316) - dropped here, at the single point every
         * consumer downstream reads from, rather than in each of them.
         *
         * The exchange returns the in-progress bar as the last element and we
         * used the array as-is, so the EMA/ATR/choppiness arrays all had a
         * partial final value, a cross could appear mid-candle and vanish
         * before the close, and simulateTrades resolved outcomes against a bar
         * that had not finished printing. The signal shown was not necessarily
         * a signal any candle ever closed on.
         *
         * FORMING is unaffected: `pending` means the PERSIST hold is
         * incomplete, not "this is the live bar", so the hollow marker still
         * appears on a signal awaiting confirmation. */
        const nowMs = Date.now();
        const cRibbon = dropForming(rawRibbon, intervalMs, nowMs);
        const c1d     = dropForming(raw1d, TF_MS['1d'], nowMs);
        if (cRibbon.length < 55 || c1d.length < 5) {
          /* A stable sentinel, not display text (#1024) - EMASignal.tsx maps
             this to a translated label, the same shape OnChainScore already
             uses for its own known-error codes. */
          setSig({ ...STRATEGY_LOADING, loading: false, error: 'INSUFFICIENT_DATA', signalTimestamp: null, signalAnchorPrice: null, signalDir: null });
          return false;
        }
        klineCache.set(cacheKey, { cRibbon, c1d, fetchedAt: Date.now() });
        candlesRef.current = { coin, tf, cRibbon, c1d };
        computeRef.current();
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setSig({ ...STRATEGY_LOADING, loading: false, error: String(err) });
        return false;
      }
    };

    /* Recompute WHEN A CANDLE CLOSES, not every five minutes (#316).
     *
     * The old fixed interval was wrong in both directions at once: on 1m it
     * missed four closes out of five, and on 1d it woke 96 times to observe a
     * single change. Signals only change on a close, so that is when to look.
     *
     * CLOSE_SKEW_MS of grace after the boundary - the exchange does not have
     * the closed candle at boundary+0ms and our clock is not theirs. Asking
     * too early returns the previous candle and leaves the signal a full
     * period behind, which is this bug approached from the other side.
     *
     * A failed load retries on the shorter of the next close and a minute,
     * rather than waiting out a 4h period on a transient network error.
     *
     * Still a timer, not the chart's WebSocket. The socket is the better
     * trigger and QA is right that it is the real answer - it is a larger
     * change than this one and is tracked separately on #316. */
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNext = (ok: boolean) => {
      if (!mountedRef.current) return;
      const untilClose = msUntilNextClose(intervalMs, Date.now()) + CLOSE_SKEW_MS;
      timer = setTimeout(tick, ok ? untilClose : Math.min(untilClose, 60_000));
    };
    // Driven by the RESOLVED value, not by a rejection: load() catches its own
    // errors to surface them in the UI, so the rejection branch would be dead
    // code and every failure would wait out a full candle period.
    const tick = () => { void load().then(scheduleNext); };

    void load().then(scheduleNext);

    return () => {
      mountedRef.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [coin, tf]);

  /* Funding/OI ticks and anti-chop filter changes: re-derive conditions from the
     cached candles - no refetch, no LOADING flash, chart markers stay put. */
  useEffect(() => {
    computeRef.current();
  }, [fundingRate, oiPct, spreadMinPct, atrMult, persistBoost, selection]);

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
