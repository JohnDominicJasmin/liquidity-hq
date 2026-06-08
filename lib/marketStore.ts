'use client';
import { createContext, useContext } from 'react';

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
  longRatio: number | null;
  shortRatio: number | null;
  rsi14: number | null;
  ma20: number | null;
  perpPrice: number | null;
  /* multi-timeframe RSI */
  rsi1h: number | null;
  rsi4h: number | null;
  rsiDaily: number | null; // 1D RSI — long-term bias signal
  /* cumulative volume delta */
  cvd: number | null;
  /* CVD vs price divergence signal */
  cvdDivergence: 'bullish' | 'bearish' | null;
  /* volume profile */
  poc: number | null;   // Point of Control — price with most volume
  vah: number | null;   // Value Area High (top of 70% vol range)
  val: number | null;   // Value Area Low  (bottom of 70% vol range)
  /* order book walls (BTC/ETH only) */
  orderBidWalls: LiqWall[] | null;
  orderAskWalls: LiqWall[] | null;
  /* VWAP — volume-weighted average price from 100 candles */
  vwap: number | null;
  /* OI Trend vs Price divergence signal */
  oiTrend: 'strong_up' | 'weak_up' | 'strong_down' | 'weak_down' | null;
  /* Taker Buy/Sell ratio — who's being aggressive (last 20 × 15m candles ≈ 5h) */
  takerBuyRatio: number | null;  // 0.0–1.0 (buy vol / total vol)
  /* Detected chart patterns from 15m klines (e.g. "Bull flag", "Bearish engulfing") */
  chartPattern: string | null;
  /* Next funding rate prediction (mark–index premium spread) */
  nextFrEstimate: number | null;   // predicted next 8h FR (decimal, e.g. 0.0001)
  nextFundingTime: number | null;  // unix ms of next settlement
}

export type CoinId =
  | 'btc' | 'eth' | 'sol' | 'xrp' | 'bnb' | 'hype' | 'near' | 'sui'
  | 'doge' | 'avax' | 'link' | 'ada' | 'dot' | 'atom' | 'wif' | 'pepe' | 'bonk';

export const COINS: CoinId[] = [
  'btc', 'eth', 'sol', 'xrp', 'bnb', 'hype', 'near', 'sui',
  'doge', 'avax', 'link', 'ada', 'dot', 'atom', 'wif', 'pepe', 'bonk',
];

export const BINANCE_SYMS: Record<string, string> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT',
  xrp: 'XRPUSDT', bnb: 'BNBUSDT', near: 'NEARUSDT', sui: 'SUIUSDT',
  doge: 'DOGEUSDT', avax: 'AVAXUSDT', link: 'LINKUSDT',
  ada: 'ADAUSDT', dot: 'DOTUSDT', atom: 'ATOMUSDT', wif: 'WIFUSDT',
  // PEPE + BONK: Bybit-only (Binance uses 1000x denomination — avoids display confusion)
};

export const BYBIT_SYMS: Record<string, string> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT',
  xrp: 'XRPUSDT', bnb: 'BNBUSDT', hype: 'HYPEUSDT', near: 'NEARUSDT',
  doge: 'DOGEUSDT', avax: 'AVAXUSDT', link: 'LINKUSDT',
  ada: 'ADAUSDT', dot: 'DOTUSDT', atom: 'ATOMUSDT', wif: 'WIFUSDT',
  pepe: 'PEPEUSDT', bonk: 'BONKUSDT',  // meme coins — Bybit primary
};

export const COIN_DEC: Record<CoinId, number> = {
  btc: 2, eth: 2, sol: 3, xrp: 4, bnb: 2, hype: 3, near: 4, sui: 4,
  doge: 5, avax: 3, link: 3, ada: 4, dot: 3, atom: 3, wif: 4,
  pepe: 8, bonk: 8,
};

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

export interface FundingClass {
  label: string;
  cls: string;
  rpm: 'pos' | 'neg' | 'neu';
  note: string;
}

export function classifyFunding(rate: number): FundingClass {
  const r = rate * 100;
  if (r >= 0.05) return { label: 'Heavily positive', cls: 'fund-pos', rpm: 'pos', note: 'Too many longs overleveraged. Whales dump DOWN to liquidate them. Go SHORT.' };
  if (r >= 0.01) return { label: 'Mildly positive', cls: 'fund-pos', rpm: 'pos', note: 'Longs paying shorts. Slight bullish bias but not extreme.' };
  if (r <= -0.03) return { label: 'Heavily negative', cls: 'fund-neg', rpm: 'neg', note: 'Too many shorts overleveraged. Whales squeeze UP to liquidate them. Go LONG.' };
  if (r <= -0.005) return { label: 'Mildly negative', cls: 'fund-neg', rpm: 'neg', note: 'Shorts paying longs. Slight bearish bias but not extreme.' };
  return { label: 'Neutral', cls: 'fund-neu', rpm: 'neu', note: 'No extreme positioning. Lower raid probability. Trade with caution.' };
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
  googleTrendsBtc: number | null;
  /* Macro correlations */
  dxy: number | null;        // US Dollar Index
  dxyChg: number | null;     // 24h % change
  spx: number | null;        // S&P 500
  spxChg: number | null;
  gold: number | null;       // Gold spot $/oz
  goldChg: number | null;
  /* Coinbase Premium Index */
  cbPremium: number | null;    // Coinbase BTC − Binance BTC (USD)
  cbPremiumPct: number | null; // as % of Binance price
  /* GEX — Gamma Exposure from Deribit options */
  btcNetGex: number | null;    // total net GEX in $ (positive = dealers long gamma)
  btcGexFlip: number | null;   // zero-gamma strike — cross = regime change
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
  googleTrendsBtc: null,
  dxy: null, dxyChg: null,
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
export function computeSqueezeScore(coin: CoinData | undefined): {
  score: number;
  dir: 'LONG_LIQ' | 'SHORT_SQ' | 'NEUTRAL';
  label: string;
  color: string;
} {
  if (!coin) return { score: 0, dir: 'NEUTRAL', label: 'No data', color: '#444' };
  let longRisk = 0;   // longs overleveraged → price dump incoming
  let shortRisk = 0;  // shorts overleveraged → price pump incoming
  if (coin.fundingRate != null) {
    const fr = coin.fundingRate * 100;
    if (fr >= 0.05) longRisk += 40;
    else if (fr >= 0.02) longRisk += 22;
    else if (fr >= 0.01) longRisk += 10;
    else if (fr <= -0.03) shortRisk += 40;
    else if (fr <= -0.015) shortRisk += 22;
    else if (fr <= -0.005) shortRisk += 10;
  }
  if (coin.longRatio != null && coin.shortRatio != null) {
    if (coin.longRatio >= 0.65) longRisk += 40;
    else if (coin.longRatio >= 0.58) longRisk += 22;
    else if (coin.longRatio >= 0.52) longRisk += 10;
    else if (coin.shortRatio >= 0.65) shortRisk += 40;
    else if (coin.shortRatio >= 0.58) shortRisk += 22;
    else if (coin.shortRatio >= 0.52) shortRisk += 10;
  }
  const volBonus = coin.volRatio != null
    ? (coin.volRatio >= 2 ? 20 : coin.volRatio >= 1.5 ? 12 : coin.volRatio >= 1.2 ? 5 : 0)
    : 0;
  const dominant = Math.max(longRisk, shortRisk);
  const score = Math.min(100, dominant + (dominant > 10 ? volBonus : 0));
  if (longRisk > shortRisk && longRisk > 10)
    return { score, dir: 'LONG_LIQ', label: 'Long liquidation risk ↓', color: '#ff9a92' };
  if (shortRisk > longRisk && shortRisk > 10)
    return { score, dir: 'SHORT_SQ', label: 'Short squeeze ↑', color: '#7de0a4' };
  return { score, dir: 'NEUTRAL', label: 'Balanced', color: '#606060' };
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
