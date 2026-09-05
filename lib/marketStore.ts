'use client';
import { createContext, useContext } from 'react';
import type { CoinId } from './coins';
import type { RealYield } from './realYield';
export type { CoinId } from './coins';
export { COINS, BINANCE_SYMS, BYBIT_SYMS, COIN_DEC, COIN_LABELS } from './coins';

export interface GexLevel {
  strike: number;
  gex: number;     // net GEX at this strike (positive = long gamma = stabilising, negative = short gamma = amplifying)
}

export interface LiqWall {
  price: number;
  size: number;
}

export interface LiqLevel {
  price: number;
  amount: number;
  side: 'long' | 'short';
}

export interface CoinData {
  price: number;
  change: number;
  high: number;
  low: number;
  fundingRate: number | null;
  oi: number | null;
  vol24: number | null;
  volRatio: number | null;
  longRatio: number | null;    // Bybit account ratio - long side (1h)
  shortRatio: number | null;   // Bybit account ratio - short side (1h)
  bnLongRatio: number | null;       // Binance global account ratio - long side (5m)
  bnShortRatio: number | null;      // Binance global account ratio - short side (5m)
  bnWhaleLongRatio: number | null;  // Binance top trader POSITION ratio - long (dollar-weighted)
  bnWhaleShortRatio: number | null; // Binance top trader POSITION ratio - short (dollar-weighted)
  rsi14: number | null;
  ma20: number | null;
  perpPrice: number | null;
  /* multi-timeframe RSI */
  rsi5m: number | null;
  rsi1h: number | null;
  rsi4h: number | null;
  rsiDaily: number | null;   // 1D RSI - long-term bias signal
  rsiWeekly: number | null;  // 1W RSI - long-term bias signal
  rsiMonthly: number | null; // 1M RSI - long-term bias signal
  /* cumulative volume delta */
  cvd: number | null;
  /* CVD vs price divergence signal */
  cvdDivergence: 'bullish' | 'bearish' | null;
  /* volume profile */
  poc: number | null;   // Point of Control - price with most volume
  vah: number | null;   // Value Area High (top of 70% vol range)
  val: number | null;   // Value Area Low  (bottom of 70% vol range)
  /* order book walls (BTC/ETH only) */
  orderBidWalls: LiqWall[] | null;
  orderAskWalls: LiqWall[] | null;
  /* VWAP - volume-weighted average price from 100 candles */
  vwap: number | null;
  /* OI Trend vs Price divergence signal */
  oiTrend: 'strong_up' | 'weak_up' | 'strong_down' | 'weak_down' | null;
  /* Taker Buy/Sell ratio - who's being aggressive (last 20 × 15m candles ≈ 5h) */
  takerBuyRatio: number | null;  // 0.0–1.0 (buy vol / total vol)
  /* Detected chart patterns from 15m klines (e.g. "Bull flag", "Bearish engulfing") */
  chartPattern: string | null;
  /* Next funding rate prediction (mark–index premium spread) */
  nextFrEstimate: number | null;   // predicted next 8h FR (decimal, e.g. 0.0001)
  nextFundingTime: number | null;  // unix ms of next settlement
  /* Liquidation delta - net long vs short liquidation $ over a rolling 15min window
     (Binance futures forceOrder stream, majors only - BTC/ETH/SOL/XRP/BNB/NEAR/SUI) */
  liqDelta:    number | null;  // liqLongUsd - liqShortUsd (signed net)
  liqLongUsd:  number | null;  // long positions force-liquidated
  liqShortUsd: number | null;  // short positions force-liquidated
}


export function fmtPrice(p: number, dec: number): string {
  return p.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
export function fmtChg(c: number | null | undefined): string {
  if (c == null) return '--%';
  return (c >= 0 ? '+' : '') + c.toFixed(2) + '%';
}
export function fmtOI(val: number): string {
  if (val >= 1e9) return '$' + (val / 1e9).toFixed(2) + 'B';
  if (val >= 1e6) return '$' + (val / 1e6).toFixed(1) + 'M';
  return '$' + val.toFixed(0);
}
export function fmtVol(v: number): string {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
}

export type FundingBand = 'heavyPos' | 'mildPos' | 'neutral' | 'mildNeg' | 'heavyNeg';

export interface FundingClass {
  label: string;
  cls: string;
  rpm: 'pos' | 'neg' | 'neu';
  note: string;
  /* Which of the five bands this rate fell into (#244).
     `note` already held the right sentence for each band and was computed and
     then never shown: both tooltips rendered ONE static string describing the
     strongly-positive case, so a negative funding rate was explained as "too
     many people are leveraged long - whales often dump". That is the inverse of
     what negative funding means and the inverse of the action this function
     would have given (Go LONG, not Go SHORT).
     `band` exists rather than wiring `note` straight in because `note` is a
     hardcoded English string and the tooltips go through t() - using it would
     take that surface out of the label system and out of i18n. */
  band: FundingBand;
}

export function classifyFunding(rate: number): FundingClass {
  const r = rate * 100;
  if (r >= 0.05) return { label: 'Heavily positive', cls: 'fund-pos', rpm: 'pos', band: 'heavyPos', note: 'Too many longs overleveraged. Whales dump DOWN to liquidate them. Go SHORT.' };
  if (r >= 0.01) return { label: 'Mildly positive', cls: 'fund-pos', rpm: 'pos', band: 'mildPos', note: 'Longs paying shorts. Slight bullish bias but not extreme.' };
  if (r <= -0.03) return { label: 'Heavily negative', cls: 'fund-neg', rpm: 'neg', band: 'heavyNeg', note: 'Too many shorts overleveraged. Whales squeeze UP to liquidate them. Go LONG.' };
  if (r <= -0.005) return { label: 'Mildly negative', cls: 'fund-neg', rpm: 'neg', band: 'mildNeg', note: 'Shorts paying longs. Slight bearish bias but not extreme.' };
  return { label: 'Neutral', cls: 'fund-neu', rpm: 'neu', band: 'neutral', note: 'No extreme positioning. Lower raid probability. Trade with caution.' };
}

export type MarketStore = {
  coins: Partial<Record<CoinId, CoinData>>;
  selectedCoin: CoinId;
  fng: number | null;
  fngLabel: string;
  fngPrev: number | null;
  btcDom: number | null;
  btcDomHistory: number[];
  ethDom: number | null;            // ETH market dominance % (from CMC)
  altSeasonScore: number | null;    // 0–100: % of top-50 alts outperforming BTC (90d)
  wsStatus: string;
  newsCache: string[];
  oilPrice: number | null;
  bonds10y: number | null;
  etfNetFlow: number | null;     // BTC spot ETF total net flow today in $M
  ethEtfNetFlow: number | null;  // ETH spot ETF total net flow today in $M
  /* Deribit options */
  btcPcRatio: number | null;
  btcMaxPain: number | null;
  /* Stablecoin supply */
  stablecoinSupply: number | null;   // $B
  stablecoinPrev: number | null;     // $B previous reading
  /* Coinglass */
  btcExchangeNetFlow: number | null;
  btcLiqLevels: LiqLevel[];
  /* Google Trends */
  /* Macro correlations */
  dxy: number | null;        // US Dollar Index
  dxyChg: number | null;     // 24h % change
  jpy: number | null;        // USD/JPY spot
  jpyChg: number | null;     // 24h % change - yen carry-trade direction
  /* 10Y real yield (#311). Whole object, not a number + change pair like the
     others, because this one carries its own staleness: FRED publishes it once
     per business day and crypto trades through the weekend, so "how old is
     this" is part of the reading rather than metadata about it. */
  real10y: RealYield | null;
  spx: number | null;        // S&P 500
  spxChg: number | null;
  gold: number | null;       // Gold spot $/oz
  goldChg: number | null;
  /* Coinbase Premium Index */
  cbPremium: number | null;    // Coinbase BTC − Binance BTC (USD)
  cbPremiumPct: number | null; // as % of Binance price
  /* GEX - Gamma Exposure from Deribit options */
  btcNetGex: number | null;    // total net GEX in $ (positive = dealers long gamma)
  btcGexFlip: number | null;   // zero-gamma strike - cross = regime change
  btcGexLevels: GexLevel[];    // top strikes near ATM for chart
  /* Liquidation Cascade Alert */
  cascadeAlert: {
    coin: string;              // e.g. 'BTC', 'MARKET'
    side: 'LONG' | 'SHORT' | 'MIXED';
    totalUsd: number;          // USD liquidated in the detection window
    ts: number;                // unix ms when cascade fired
  } | null;
};

export const defaultStore: MarketStore = {
  coins: {},
  selectedCoin: 'btc',
  fng: null,
  fngLabel: '',
  fngPrev: null,
  btcDom: null,
  btcDomHistory: [],
  ethDom: null,
  altSeasonScore: null,
  wsStatus: 'Connecting...',
  newsCache: [],
  oilPrice: null,
  bonds10y: null,
  etfNetFlow: null,
  ethEtfNetFlow: null,
  btcPcRatio: null,
  btcMaxPain: null,
  stablecoinSupply: null,
  stablecoinPrev: null,
  btcExchangeNetFlow: null,
  btcLiqLevels: [],
  dxy: null, dxyChg: null,
  jpy: null, jpyChg: null,
  real10y: null,
  spx: null, spxChg: null,
  gold: null, goldChg: null,
  cbPremium: null, cbPremiumPct: null,
  btcNetGex: null,
  btcGexFlip: null,
  btcGexLevels: [],
  cascadeAlert: null,
};

export const MarketContext = createContext<{
  store: MarketStore;
  setStore: React.Dispatch<React.SetStateAction<MarketStore>>;
  selectCoin: (c: CoinId) => void;
} | null>(null);

export function useMarket() {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error('useMarket must be inside MarketProvider');
  return ctx;
}

/* ── Squeeze Score ── */
// Requires ≥2 independent signals to agree before labeling LONG_LIQ / SHORT_SQ.
// Single-signal setups (e.g. only L/S ratio or only funding rate slightly off-centre)
// are returned as NEUTRAL to reduce noise on normal trading days.
//
// Three independent signal sources:
//   1. Funding rate       - are perp traders paying a skewed rate?
//   2. L/S ratio          - is positioning heavily one-sided?
//   3. Taker buy/sell     - are takers aggressively selling or buying?
// Vol spike boosts the score but does NOT count as a direction signal.
export function computeSqueezeScore(coin: CoinData | undefined): {
  score: number;
  dir: 'LONG_LIQ' | 'SHORT_SQ' | 'NEUTRAL';
  label: string;
  color: string;
} {
  if (!coin) return { score: 0, dir: 'NEUTRAL', label: 'No data', color: 'var(--txt-dim)' };

  let longRisk = 0;    // longs overleveraged → price dump incoming
  let shortRisk = 0;   // shorts overleveraged → price pump incoming
  let longSignals = 0; // count of independent sources confirming long risk
  let shortSignals = 0;

  // ── Signal 1: Funding rate (max 40 pts) ──────────────────────────────────
  if (coin.fundingRate != null) {
    const fr = coin.fundingRate * 100;
    if (fr >= 0.05)    { longRisk += 40; longSignals++; }
    else if (fr >= 0.02) { longRisk += 22; longSignals++; }
    else if (fr >= 0.01) { longRisk += 10; longSignals++; }
    else if (fr <= -0.03)  { shortRisk += 40; shortSignals++; }
    else if (fr <= -0.015) { shortRisk += 22; shortSignals++; }
    else if (fr <= -0.005) { shortRisk += 10; shortSignals++; }
  }

  // ── Signal 2: L/S ratio (max 40 pts) ─────────────────────────────────────
  if (coin.longRatio != null && coin.shortRatio != null) {
    if (coin.longRatio >= 0.65)    { longRisk += 40; longSignals++; }
    else if (coin.longRatio >= 0.58) { longRisk += 22; longSignals++; }
    else if (coin.longRatio >= 0.52) { longRisk += 10; longSignals++; }
    else if (coin.shortRatio >= 0.65)  { shortRisk += 40; shortSignals++; }
    else if (coin.shortRatio >= 0.58)  { shortRisk += 22; shortSignals++; }
    else if (coin.shortRatio >= 0.52)  { shortRisk += 10; shortSignals++; }
  }

  // ── Signal 3: Taker buy/sell ratio - aggressor-side pressure (max 15 pts) ─
  // takerBuyRatio < 0.40 → sellers are aggressive (long-flush pressure)
  // takerBuyRatio > 0.60 → buyers are aggressive (short-squeeze pressure)
  if (coin.takerBuyRatio != null) {
    if (coin.takerBuyRatio <= 0.38)      { longRisk += 15; longSignals++; }
    else if (coin.takerBuyRatio <= 0.42) { longRisk += 8;  longSignals++; }
    else if (coin.takerBuyRatio >= 0.62) { shortRisk += 15; shortSignals++; }
    else if (coin.takerBuyRatio >= 0.58) { shortRisk += 8;  shortSignals++; }
  }

  // ── Vol spike bonus - amplifies score only, not a direction signal ────────
  const volBonus = coin.volRatio != null
    ? (coin.volRatio >= 2 ? 20 : coin.volRatio >= 1.5 ? 12 : coin.volRatio >= 1.2 ? 5 : 0)
    : 0;

  const dominant = Math.max(longRisk, shortRisk);
  const score = Math.min(100, dominant + (dominant > 10 ? volBonus : 0));

  // ── Gate: ≥2 independent signals required to label as Flush / Squeeze ─────
  if (longRisk > shortRisk && longSignals >= 2)
    return { score, dir: 'LONG_LIQ', label: 'Long liquidation risk ↓', color: 'var(--red-soft)' };
  if (shortRisk > longRisk && shortSignals >= 2)
    return { score, dir: 'SHORT_SQ', label: 'Short squeeze ↑', color: 'var(--green-soft)' };
  return { score, dir: 'NEUTRAL', label: 'Balanced', color: 'var(--txt-dim)' };
}

/* ── Coin Health Score ─────────────────────────────────────────────────────
   Single composite grade combining squeeze mechanics + RSI + OI trend + CVD.
   Answers "how strong / clear is the setup on this coin right now?"
   A = multiple signals aligned, high-probability trade
   F = no clear signal, skip this coin
   ───────────────────────────────────────────────────────────────────────── */
export function computeCoinHealth(coin: CoinData | undefined): {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  color: string;
  label: string;
} {
  const none = { score: 0, grade: 'F' as const, color: '#475569', label: 'No data' };
  if (!coin?.price) return none;

  const sq = computeSqueezeScore(coin);

  // Base: squeeze score scaled to 55 pts max
  let pts = Math.round(sq.score * 0.55);

  // RSI extremes - 0-20 pts (direction-agnostic: extreme either way = signal)
  if (coin.rsi14 != null) {
    const r = coin.rsi14;
    if (r >= 70 || r <= 30)        pts += 20;
    else if (r >= 65 || r <= 35)   pts += 12;
    else if (r >= 60 || r <= 40)   pts += 5;
  }

  // OI trend - 0-13 pts
  if (coin.oiTrend === 'strong_up' || coin.oiTrend === 'strong_down') pts += 13;
  else if (coin.oiTrend === 'weak_up' || coin.oiTrend === 'weak_down') pts += 5;

  // CVD divergence confirmed - 0-12 pts
  if (coin.cvdDivergence) pts += 12;

  const score = Math.min(100, pts);

  const grade: 'A' | 'B' | 'C' | 'D' | 'F' =
    score >= 78 ? 'A' :
    score >= 60 ? 'B' :
    score >= 42 ? 'C' :
    score >= 25 ? 'D' : 'F';

  // --txt2, not --txt-dim (#546 C9): --txt-dim isn't in terminal's 16-token
  // palette, and this is the actual source of the grade-C badge colour
  // rendered app-wide.
  const color =
    grade === 'A' ? 'var(--amber)' :   // gold
    grade === 'B' ? 'var(--green-2)' :   // green
    grade === 'C' ? 'var(--txt2)' :   // gray
    grade === 'D' ? 'var(--orange)' :   // orange
                    /* F was --txt3 and measured 4.31-4.46:1 on its own tinted
                       chip - under AA in all three places it renders (#836).

                       THE CHIP IS A SELF-TINT, so changing this token moves the
                       GROUND as well as the ink: DashboardTerminal.tsx paints
                       `color: health.color` and
                       `background: withAlpha(health.color, '22')`, the same
                       value at 13.3%. The surface therefore moves toward the
                       text rather than away, which is exactly the trap
                       globals.css:600 describes - and it means a naive
                       new-ink-on-old-ground calculation reads high. Modelled
                       properly, backing the card colour out of QA's measured
                       ground and recompositing:

                         /dashboard dark   4.30 -> 5.02
                         /dashboard light  4.44 -> 4.83
                         /arena     dark   4.34 -> 5.07

                       The before column reproduces QA's measurement on the
                       deployed build (4.31 / 4.46 / 4.33) to rounding, which is
                       what makes the after column trustworthy.

                       NOT --txt, which would be 12.9-13.9 but makes the WORST
                       grade the brightest text on the card. F is the muted
                       state and should read as muted; it just has to be
                       readable while it does.

                       This is the line globals.css:597 assumed was already
                       --txt when #614 removed the terminal override that used
                       to force it. It was not, and removing the override
                       reinstated the defect it was written to fix. The grade
                       letter is what separates C from F, not the ink - they
                       share --txt2 now and that is fine.

                       Both render paths read this one value: /dashboard's
                       span.csb2-health-badge.grade-f and /arena's bare span.
                       Whether those two should share a component is a real
                       question and a separate one. */
                    'var(--txt2)';  // muted (F)

  const label =
    grade === 'A' ? 'Strong setup' :
    grade === 'B' ? 'Clear signal' :
    grade === 'C' ? 'Mixed signals' :
    grade === 'D' ? 'Weak signal' :
                    'No clear setup';

  return { score, grade, color, label };
}

/* ── Fibonacci Levels ── */
export function computeFibLevels(high: number, low: number, price: number): {
  label: string; price: number; dist: string; near: boolean;
}[] {
  const range = high - low;
  if (range <= 0) return [];
  return [
    { label: '100%', ratio: 1 },
    { label: '78.6%', ratio: 0.786 },
    { label: '61.8%', ratio: 0.618 },
    { label: '50%', ratio: 0.5 },
    { label: '38.2%', ratio: 0.382 },
    { label: '23.6%', ratio: 0.236 },
    { label: '0%', ratio: 0 },
  ].map(({ label, ratio }) => {
    const fibPrice = low + range * ratio;
    const pctDist = fibPrice > 0 ? ((price - fibPrice) / fibPrice) * 100 : 0;
    return {
      label,
      price: fibPrice,
      dist: (pctDist >= 0 ? '+' : '') + pctDist.toFixed(2) + '%',
      near: Math.abs(pctDist) < 0.5,
    };
  });
}

/* Label key for a funding rate's tooltip (#244).
 *
 * Five keys, one per band, chosen by the classification that already exists.
 * The first sentence is identical in all five - the mechanic of funding does not
 * depend on its sign - and only the interpretation changes. */
export const FUNDING_TIP_KEY: Record<FundingBand,
  'FUNDING_TIP_HEAVY_POS' | 'FUNDING_TIP_MILD_POS' | 'FUNDING_TIP_NEUTRAL'
  | 'FUNDING_TIP_MILD_NEG' | 'FUNDING_TIP_HEAVY_NEG'> = {
  heavyPos: 'FUNDING_TIP_HEAVY_POS',
  mildPos:  'FUNDING_TIP_MILD_POS',
  neutral:  'FUNDING_TIP_NEUTRAL',
  mildNeg:  'FUNDING_TIP_MILD_NEG',
  heavyNeg: 'FUNDING_TIP_HEAVY_NEG',
};
