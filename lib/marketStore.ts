'use client';
import { createContext, useContext } from 'react';

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
}

export type CoinId = 'btc' | 'eth' | 'sol' | 'xrp' | 'bnb' | 'hype' | 'near' | 'zec';

export const COINS: CoinId[] = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'hype', 'near', 'zec'];

export const BINANCE_SYMS: Record<string, string> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT',
  xrp: 'XRPUSDT', bnb: 'BNBUSDT', near: 'NEARUSDT', zec: 'ZECUSDT',
};

export const BYBIT_SYMS: Record<string, string> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT',
  xrp: 'XRPUSDT', bnb: 'BNBUSDT', hype: 'HYPEUSDT',
};

export const COIN_DEC: Record<CoinId, number> = {
  btc: 2, eth: 2, sol: 3, xrp: 4, bnb: 2, hype: 3, near: 4, zec: 2,
};

export function fmtPrice(p: number, dec: number): string {
  return p.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
export function fmtChg(c: number): string {
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
  wsStatus: string;
  newsCache: string[];
};

export const defaultStore: MarketStore = {
  coins: {},
  selectedCoin: 'btc',
  fng: null,
  fngLabel: '',
  fngPrev: null,
  btcDom: null,
  wsStatus: 'Connecting...',
  newsCache: [],
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
