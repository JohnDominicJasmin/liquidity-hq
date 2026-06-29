'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MarketContext, MarketStore, defaultStore, CoinId, CoinData, GexLevel,
  BINANCE_SYMS, BYBIT_SYMS,
} from '@/lib/marketStore';
import { detectPatterns } from '@/lib/patterns';

const WHALE_USD_THRESHOLD = 500_000; // $500k single trade = whale

/* ── CVD Divergence Telegram alert ── */
function sendCVDAlert(
  coin: string,
  div: 'bullish' | 'bearish',
  price: number,
  cooldown: Record<string, number>,
) {
  const key = `${coin}-${div}`;
  const now = Date.now();
  if (now - (cooldown[key] ?? 0) < 30 * 60_000) return; // 30-min cooldown
  cooldown[key] = now;
  const emoji = div === 'bullish' ? '🟢' : '🔴';
  const dir   = div === 'bullish' ? 'Bullish' : 'Bearish';
  const hint  = div === 'bullish'
    ? 'Price ↓ but CVD ↑ — hidden accumulation 👀'
    : 'Price ↑ but CVD ↓ — distribution in progress ⚠️';
  const priceStr = price > 0
    ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
    : '';
  fetch('/api/telegram/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `${emoji} <b>CVD Divergence — ${coin.toUpperCase()}</b>\n<b>${dir}</b>\n${hint}\n\n📊 ${coin.toUpperCase()} ${priceStr}\nliquidity-hq.onrender.com`,
    }),
  }).catch(() => {});
}

/* ── Liquidation Cascade ── */
const LIQ_CASCADE_THRESHOLDS: Record<string, number> = {
  BTC: 5_000_000, ETH: 2_000_000, SOL: 1_000_000, DEFAULT: 800_000,
};
const MARKET_CASCADE_THRESHOLD = 20_000_000;

function sendCascadeAlert(
  coin: string,
  side: 'LONG' | 'SHORT' | 'MIXED',
  totalUsd: number,
  cooldown: Record<string, number>,
) {
  const key = `casc-${coin}`;
  const now = Date.now();
  if (now - (cooldown[key] ?? 0) < 10 * 60_000) return; // 10-min cooldown
  cooldown[key] = now;
  const emoji = side === 'LONG' ? '🔴' : side === 'SHORT' ? '🟢' : '⚡';
  const who   = side === 'LONG' ? 'LONGS' : side === 'SHORT' ? 'SHORTS' : 'cascade';
  const hint  = side === 'LONG'  ? 'Bears flushing longs — short squeeze possible ⚠️'
              : side === 'SHORT' ? 'Bulls squeezing shorts — watch for reversal ⚠️'
              : 'Multi-directional flush — vol spike ahead ⚠️';
  const usdStr = totalUsd >= 1e6
    ? `$${(totalUsd / 1e6).toFixed(1)}M`
    : `$${(totalUsd / 1e3).toFixed(0)}K`;
  fetch('/api/telegram/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `${emoji} <b>Liquidation Cascade — ${coin}</b>\n${usdStr} ${who} wiped in 60s\n\n${hint}\nliquidity-hq.onrender.com`,
    }),
  }).catch(() => {});
}

const _WS_STREAMS = Object.values(BINANCE_SYMS)
  .map(s => `${s.toLowerCase()}@ticker`)
  .join('/');

const WS_URLS = [
  `wss://stream.binance.com:9443/stream?streams=${_WS_STREAMS}`,
  `wss://stream.binance.com/stream?streams=${_WS_STREAMS}`,
];

const SYM_MAP: Record<string, CoinId> = Object.fromEntries(
  Object.entries(BINANCE_SYMS).map(([id, sym]) => [sym, id as CoinId])
);

/* Helper: compute RSI14 from an array of close prices */
function computeRSI14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const gains   = changes.slice(-14).map(c => Math.max(c, 0));
  const losses  = changes.slice(-14).map(c => Math.max(-c, 0));
  const avgGain = gains.reduce((a, b) => a + b, 0) / 14;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / 14;
  return avgLoss === 0 ? 100 : Math.round(100 - (100 / (1 + avgGain / avgLoss)));
}

export default function MarketProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<MarketStore>(defaultStore);
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const urlIdxRef = useRef(0);
  const restTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /* CVD divergence: 5-snapshot sliding window per coin */
  const cvdSnapsRef = useRef<Partial<Record<CoinId, Array<{ price: number; cvd: number }>>>>({});
  /* Whale dedup: track last seen aggTrade id per symbol */
  const lastAggIdRef = useRef<Partial<Record<CoinId, number>>>({});
  /* OI Trend: sliding window of last 4 OI + price readings per coin */
  const oiHistRef = useRef<Partial<Record<CoinId, Array<{ oi: number; price: number }>>>>({});
  /* CVD Divergence alerts: last known divergence + 30-min cooldown */
  const cvdDivStateRef    = useRef<Partial<Record<string, 'bullish' | 'bearish' | null>>>({});
  const cvdAlertCooldown  = useRef<Record<string, number>>({});
  /* Liquidation cascade: rolling event buffer + per-coin cooldown */
  const liqBufferRef    = useRef<Array<{ coin: string; side: 'LONG' | 'SHORT'; usd: number; ts: number }>>([]);
  const cascadeCooldown = useRef<Record<string, number>>({});

  const updateCoin = useCallback((id: CoinId, patch: Partial<MarketStore['coins'][CoinId]>) => {
    setStore(s => ({
      ...s,
      coins: { ...s.coins, [id]: { ...s.coins[id], ...patch } as MarketStore['coins'][CoinId] },
    }));
  }, []);

  const selectCoin = useCallback((c: CoinId) => {
    setStore(s => ({ ...s, selectedCoin: c }));
  }, []);

  /* ── Binance REST fallback ── */
  const restPoll = useCallback(async () => {
    try {
      const syms = Object.values(BINANCE_SYMS).filter(s => s !== 'HYPEUSDT');
      const batch = encodeURIComponent(JSON.stringify(syms));
      const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${batch}`);
      const data = await res.json();
      if (!Array.isArray(data)) return;
      data.forEach((d: Record<string, string>) => {
        const id = SYM_MAP[d.symbol];
        if (!id) return;
        updateCoin(id, {
          price: parseFloat(d.lastPrice),
          change: parseFloat(d.priceChangePercent),
          high: parseFloat(d.highPrice),
          low: parseFloat(d.lowPrice),
        });
      });
      setStore(s => ({ ...s, wsStatus: 'Live via REST · updates every 5s' }));
    } catch { /* ignore */ }
  }, [updateCoin]);

  /* ── Binance WebSocket ── */
  const startWS = useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close(); } catch { /* */ } }
    const url = WS_URLS[urlIdxRef.current % WS_URLS.length];
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      retriesRef.current = 0; urlIdxRef.current = 0;
      if (restTimerRef.current) { clearInterval(restTimerRef.current); restTimerRef.current = null; }
      setStore(s => ({ ...s, wsStatus: 'Live · Binance WebSocket' }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const d = msg.data;
        const id = SYM_MAP[d.s];
        if (!id) return;
        updateCoin(id, {
          price: parseFloat(d.c),
          change: parseFloat(d.P),
          high: parseFloat(d.h),
          low: parseFloat(d.l),
        });
      } catch { /* */ }
    };

    ws.onclose = () => {
      retriesRef.current++;
      urlIdxRef.current++;
      if (retriesRef.current <= 5) {
        setTimeout(startWS, 2000 * retriesRef.current);
      } else {
        setStore(s => ({ ...s, wsStatus: 'Live via REST · updates every 5s' }));
        restPoll();
        restTimerRef.current = setInterval(restPoll, 5000);
      }
    };
  }, [restPoll, updateCoin]);

  /* ── Bybit: all coins — single bulk fetch instead of per-symbol calls ── */
  const fetchBybit = useCallback(async () => {
    try {
      const res = await fetch('https://api.bybit.com/v5/market/tickers?category=linear');
      const d = await res.json();
      // Build symbol → ticker map for O(1) lookup
      const bySymbol: Record<string, Record<string, string>> = {};
      for (const t of (d.result?.list ?? [])) bySymbol[t.symbol] = t;

      for (const coin of Object.keys(BYBIT_SYMS)) {
        const item = bySymbol[BYBIT_SYMS[coin]];
        if (!item) continue;

        // 1000x denomination coins (e.g. 1000PEPEUSDT, 1000BONKUSDT) — divide price by 1000
        const priceFactor = BYBIT_SYMS[coin].startsWith('1000') ? 0.001 : 1;
        const curPrice = parseFloat(item.lastPrice || '0') * priceFactor;
        // openInterestValue = USD-denominated OI; fall back to base-qty × price if missing
        const rawOIValue = parseFloat(item.openInterestValue || '0');
        const curOI = rawOIValue || (parseFloat(item.openInterest || '0') * curPrice);

        /* ── OI Trend vs Price divergence ── */
        const hist    = oiHistRef.current[coin as CoinId] ?? [];
        const newHist = [...hist, { oi: curOI, price: curPrice }].slice(-4);
        oiHistRef.current[coin as CoinId] = newHist;

        let oiTrend: 'strong_up' | 'weak_up' | 'strong_down' | 'weak_down' | null = null;
        if (newHist.length >= 2) {
          const first = newHist[0], last = newHist[newHist.length - 1];
          if (first.oi > 0 && first.price > 0) {
            const oiChg    = (last.oi    - first.oi)    / first.oi;
            const priceChg = (last.price - first.price) / first.price;
            if (Math.abs(oiChg) > 0.003 || Math.abs(priceChg) > 0.002) {
              const oiUp = oiChg > 0, priceUp = priceChg > 0;
              if      (oiUp && priceUp)    oiTrend = 'strong_up';
              else if (oiUp && !priceUp)   oiTrend = 'strong_down';
              else if (!oiUp && priceUp)   oiTrend = 'weak_up';
              else                         oiTrend = 'weak_down';
            }
          }
        }

        /* ── Next FR estimate from mark–index spread ── */
        const markBybit  = parseFloat(item.markPrice   || '0');
        const indexBybit = parseFloat(item.indexPrice  || '0');
        const nextFtMs   = parseInt(item.nextFundingTime || '0');
        let nextFrBybit: number | null = null;
        if (markBybit > 0 && indexBybit > 0) {
          const P  = (markBybit - indexBybit) / indexBybit;
          const ir = 0.0001 / 3; // Bybit ~0.01%/day → ~0.000033 per 8h
          nextFrBybit = P + Math.max(-0.0005, Math.min(0.0005, ir - P));
        }

        const patch: Partial<MarketStore['coins'][CoinId]> = {
          fundingRate: parseFloat(item.fundingRate || '0'),
          oi: curOI,
          perpPrice: curPrice,
          oiTrend,
          ...(nextFrBybit !== null ? { nextFrEstimate: nextFrBybit } : {}),
          ...(nextFtMs > 0        ? { nextFundingTime: nextFtMs }    : {}),
        };
        // Always set price/change/high/low/vol for Bybit-only coins.
        // For dual-listed coins, Binance WebSocket will overwrite with fresher data.
        if (!(coin in BINANCE_SYMS)) {
          patch.price  = curPrice;
          patch.change = parseFloat(item.price24hPcnt || '0') * 100;
          patch.high   = parseFloat(item.highPrice24h || '0');
          patch.low    = parseFloat(item.lowPrice24h  || '0');
          patch.vol24  = parseFloat(item.turnover24h  || '0');
        }
        updateCoin(coin as CoinId, patch);
      }
    } catch { /* */ }
  }, [updateCoin]);

  /* ── Bybit + Binance LSR ── */
  const fetchLSR = useCallback(async () => {
    await Promise.allSettled([
      // Bybit account ratio (1h) — all coins
      ...Object.entries(BYBIT_SYMS).map(async ([coin, sym]) => {
        try {
          const res = await fetch(`https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${sym}&period=1h&limit=1`);
          const d = await res.json();
          const item = d.result?.list?.[0];
          if (!item) return;
          updateCoin(coin as CoinId, {
            longRatio:  parseFloat(item.buyRatio  || '0.5'),
            shortRatio: parseFloat(item.sellRatio || '0.5'),
          });
        } catch { /* */ }
      }),
      // Binance global account ratio (5m) + top trader position ratio — Binance-listed coins only
      ...Object.entries(BINANCE_SYMS).map(async ([coin, sym]) => {
        try {
          const [globalRes, whaleRes] = await Promise.all([
            fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=5m&limit=1`),
            fetch(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${sym}&period=5m&limit=1`),
          ]);
          const [globalArr, whaleArr] = await Promise.all([globalRes.json(), whaleRes.json()]);
          const g = Array.isArray(globalArr) ? globalArr[0] : null;
          const w = Array.isArray(whaleArr)  ? whaleArr[0]  : null;
          updateCoin(coin as CoinId, {
            ...(g ? { bnLongRatio:       parseFloat(g.longAccount  || '0.5'),
                       bnShortRatio:      parseFloat(g.shortAccount || '0.5') } : {}),
            ...(w ? { bnWhaleLongRatio:  parseFloat(w.longAccount  || '0.5'),
                       bnWhaleShortRatio: parseFloat(w.shortAccount || '0.5') } : {}),
          });
        } catch { /* */ }
      }),
    ]);
  }, [updateCoin]);

  /* ── Binance volume + klines ── */
  const fetchVolume = useCallback(async () => {
    const binanceCoins = Object.entries(BINANCE_SYMS).filter(([c]) => c !== 'hype');
    const syms = binanceCoins.map(([, s]) => s);
    try {
      const batch = encodeURIComponent(JSON.stringify(syms));
      const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${batch}`);
      const arr = await res.json();
      if (!Array.isArray(arr)) return;
      arr.forEach((d: Record<string, string>) => {
        const id = SYM_MAP[d.symbol];
        if (!id) return;
        updateCoin(id, { vol24: parseFloat(d.quoteVolume || '0') });
        fetchKlines(id, d.symbol);
      });
    } catch {
      binanceCoins.forEach(([coin, sym], i) => {
        setTimeout(() => fetchKlines(coin as CoinId, sym), i * 300);
      });
    }
  }, [updateCoin]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchKlines = useCallback(async (coin: CoinId, sym: string) => {
    try {
      // Use futures klines (fapi) — more accurate taker buy/sell for perp traders
      // Falls back to spot if futures endpoint fails (e.g. no perp for that symbol)
      const futuresUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=15m&limit=100`;
      const spotUrl    = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=15m&limit=100`;
      let raw = await fetch(futuresUrl);
      if (!raw.ok) raw = await fetch(spotUrl);
      const klines = await raw.json();
      if (!Array.isArray(klines) || klines.length < 15) return;

      const closes = klines.map((k: string[]) => parseFloat(k[4]));
      const highs  = klines.map((k: string[]) => parseFloat(k[2]));
      const lows   = klines.map((k: string[]) => parseFloat(k[3]));
      const vols   = klines.map((k: string[]) => parseFloat(k[7])); // quote volume

      /* Volume ratio */
      const current = vols[vols.length - 2];
      const avg = vols.slice(0, -1).reduce((a: number, b: number) => a + b, 0) / (vols.length - 1);

      /* MA20 */
      const ma20Slice = closes.slice(-20);
      const ma20 = ma20Slice.reduce((a: number, b: number) => a + b, 0) / ma20Slice.length;

      /* RSI14 */
      const rsi14 = computeRSI14(closes);

      /* ── Volume Profile / POC ── */
      const allPrices = [...highs, ...lows];
      const minP = Math.min(...allPrices);
      const maxP = Math.max(...allPrices);
      const range = maxP - minP;
      const BUCKETS = 60;
      const bSize = range / BUCKETS;
      const buckets = new Array<number>(BUCKETS).fill(0);

      klines.forEach((k: string[], i: number) => {
        const h = highs[i], l = lows[i], v = vols[i];
        const lo = Math.max(0, Math.floor((l - minP) / bSize));
        const hi = Math.min(BUCKETS - 1, Math.floor((h - minP) / bSize));
        const span = Math.max(1, hi - lo + 1);
        for (let b = lo; b <= hi; b++) buckets[b] += v / span;
      });

      // POC = bucket with max volume
      let maxVol = 0, pocBucket = 0;
      buckets.forEach((v, i) => { if (v > maxVol) { maxVol = v; pocBucket = i; } });
      const poc = minP + (pocBucket + 0.5) * bSize;

      // Value Area: expand from POC to capture 70% of total volume
      const totalVol = buckets.reduce((a, b) => a + b, 0);
      let lo = pocBucket, hi = pocBucket, captured = buckets[pocBucket];
      while (captured < totalVol * 0.70 && (lo > 0 || hi < BUCKETS - 1)) {
        const addLo = lo > 0 ? buckets[lo - 1] : 0;
        const addHi = hi < BUCKETS - 1 ? buckets[hi + 1] : 0;
        if (addLo >= addHi && lo > 0) { lo--; captured += buckets[lo]; }
        else if (hi < BUCKETS - 1)    { hi++; captured += buckets[hi]; }
        else                           { lo--; captured += buckets[lo]; }
      }
      const val = minP + lo * bSize;
      const vah = minP + (hi + 1) * bSize;

      /* ── Taker Buy/Sell ratio (last 8 candles ≈ 2h) ──
         k[9] = taker buy base volume, k[5] = total base volume
         Smaller window = reacts faster to recent momentum shifts
         takerBuyRatio > 0.55 = buyers hitting asks (aggression = bullish)
         takerBuyRatio < 0.45 = sellers hitting bids (aggression = bearish) */
      let totalBuyVol = 0, totalBaseVol = 0;
      klines.slice(-8).forEach((k: string[]) => {
        totalBuyVol  += parseFloat(k[9]);   // taker buy base vol
        totalBaseVol += parseFloat(k[5]);   // total base vol
      });
      const takerBuyRatio = totalBaseVol > 0 ? totalBuyVol / totalBaseVol : null;

      /* ── VWAP — use BASE volume (k[5]) for standard formula ── */
      // quoteVol (k[7]) biases the average; base vol gives true VWAP
      let sumTPV = 0, sumVol = 0;
      klines.forEach((k: string[], i: number) => {
        const tp       = (highs[i] + lows[i] + closes[i]) / 3;
        const baseVol  = parseFloat(k[5]);                      // BTC (base) volume
        sumTPV += tp * baseVol;
        sumVol += baseVol;
      });
      const vwap = sumVol > 0 ? sumTPV / sumVol : null;

      // Chart pattern detection from last 25 candles OHLC
      const patternCandles = klines.slice(-25).map((k: string[]) => ({
        o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]),
      }));
      const patterns = detectPatterns(patternCandles);
      const chartPattern = patterns.length > 0 ? patterns.join('; ') : null;

      updateCoin(coin, { volRatio: avg > 0 ? current / avg : 1, ma20, rsi14, poc, vah, val, vwap, takerBuyRatio, chartPattern });
    } catch { /* */ }
  }, [updateCoin]);

  /* ── Bybit klines for Bybit-only coins (HYPE, PEPE, BONK, XAU, SPX, …) ── */
  // Bybit kline format (newest-first): [startTime, open, high, low, close, volume, turnover]
  const fetchBybitKlines = useCallback(async () => {
    const bybitOnly = (Object.keys(BYBIT_SYMS) as CoinId[]).filter(c => !BINANCE_SYMS[c]);
    await Promise.allSettled(bybitOnly.map(async (coin) => {
      const sym = BYBIT_SYMS[coin];
      try {
        const res = await fetch(
          `https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=15&limit=100`
        );
        const d = await res.json();
        // Bybit returns newest-first — reverse to oldest-first
        const klines: string[][] = [...(d?.result?.list ?? [])].reverse();
        if (klines.length < 15) return;

        // 1000x denomination coins need price scaling to match coin.price set by fetchBybit
        const pf = sym.startsWith('1000') ? 0.001 : 1;

        const closes = klines.map(k => parseFloat(k[4]) * pf);
        const highs  = klines.map(k => parseFloat(k[2]) * pf);
        const lows   = klines.map(k => parseFloat(k[3]) * pf);
        const vols   = klines.map(k => parseFloat(k[6])); // turnover = quote vol (USD)

        const rsi14     = computeRSI14(closes);
        const ma20Slice = closes.slice(-20);
        const ma20      = ma20Slice.reduce((a, b) => a + b, 0) / ma20Slice.length;

        // Volume ratio (current candle vs rolling avg)
        const current = vols[vols.length - 2];
        const avg     = vols.slice(0, -1).reduce((a, b) => a + b, 0) / (vols.length - 1);
        const volRatio = avg > 0 ? current / avg : 1;

        // VWAP (base volume k[5])
        let sumTPV = 0, sumVol = 0;
        klines.forEach((k, i) => {
          const tp      = (highs[i] + lows[i] + closes[i]) / 3;
          const baseVol = parseFloat(k[5]);
          sumTPV += tp * baseVol;
          sumVol += baseVol;
        });
        const vwap = sumVol > 0 ? sumTPV / sumVol : null;

        // Volume Profile / POC / VAH / VAL
        const allPrices = [...highs, ...lows];
        const minP = Math.min(...allPrices);
        const maxP = Math.max(...allPrices);
        const range = maxP - minP;
        const BUCKETS = 60;
        const bSize = range / BUCKETS;
        const buckets = new Array<number>(BUCKETS).fill(0);
        klines.forEach((k, i) => {
          const h = highs[i], l = lows[i], v = vols[i];
          const lo = Math.max(0, Math.floor((l - minP) / bSize));
          const hi = Math.min(BUCKETS - 1, Math.floor((h - minP) / bSize));
          const span = Math.max(1, hi - lo + 1);
          for (let b = lo; b <= hi; b++) buckets[b] += v / span;
        });
        let maxVb = 0, pocBucket = 0;
        buckets.forEach((v, i) => { if (v > maxVb) { maxVb = v; pocBucket = i; } });
        const poc = minP + (pocBucket + 0.5) * bSize;
        const totalVol = buckets.reduce((a, b) => a + b, 0);
        let lo = pocBucket, hi = pocBucket, captured = buckets[pocBucket];
        while (captured < totalVol * 0.70 && (lo > 0 || hi < BUCKETS - 1)) {
          const addLo = lo > 0 ? buckets[lo - 1] : 0;
          const addHi = hi < BUCKETS - 1 ? buckets[hi + 1] : 0;
          if (addLo >= addHi && lo > 0) { lo--; captured += buckets[lo]; }
          else if (hi < BUCKETS - 1)    { hi++; captured += buckets[hi]; }
          else                           { lo--; captured += buckets[lo]; }
        }
        const val = minP + lo * bSize;
        const vah = minP + (hi + 1) * bSize;

        // Chart pattern detection (Bybit klines: [time, open, high, low, close, ...])
        const patternCandles = klines.slice(-25).map((k: string[]) => ({
          o: parseFloat(k[1]) * pf, h: parseFloat(k[2]) * pf,
          l: parseFloat(k[3]) * pf, c: parseFloat(k[4]) * pf,
        }));
        const patterns = detectPatterns(patternCandles);
        updateCoin(coin, { rsi14, ma20, volRatio, vwap, poc, vah, val, chartPattern: patterns.length > 0 ? patterns.join('; ') : null });

        // Taker buy ratio from recent trades (Bybit klines don't split maker/taker)
        try {
          const tradeRes = await fetch(
            `https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=${sym}&limit=500`
          );
          const tradeData = await tradeRes.json();
          const trades: Array<{ side: string; size: string }> = tradeData?.result?.list ?? [];
          let buyVol = 0, totalVol = 0;
          trades.forEach(t => {
            const qty = parseFloat(t.size || '0');
            totalVol += qty;
            if (t.side === 'Buy') buyVol += qty;
          });
          if (totalVol > 0) updateCoin(coin, { takerBuyRatio: buyVol / totalVol });
        } catch { /* */ }

      } catch { /* */ }
    }));
  }, [updateCoin]);

  /* ── Bybit multi-TF RSI for HYPE (1h + 4h) ── */
  const fetchBybitMultiTFRSI = useCallback(async () => {
    const bybitOnly = (['hype'] as CoinId[]).filter(c => BYBIT_SYMS[c] && !BINANCE_SYMS[c]);
    await Promise.allSettled(
      bybitOnly.flatMap(coin => {
        const sym = BYBIT_SYMS[coin];
        return (['60', '240'] as const).map(async (interval) => {
          try {
            const res = await fetch(
              `https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=${interval}&limit=16`
            );
            const d = await res.json();
            const klines: string[][] = [...(d?.result?.list ?? [])].reverse();
            if (klines.length < 15) return;
            const closes = klines.map(k => parseFloat(k[4]));
            const rsi = computeRSI14(closes);
            if (rsi === null) return;
            updateCoin(coin, interval === '60' ? { rsi1h: rsi } : { rsi4h: rsi });
          } catch { /* */ }
        });
      })
    );
  }, [updateCoin]);

  /* ── Multi-timeframe RSI (1h + 4h) ── */
  const fetchMultiTFRSI = useCallback(async () => {
    const binanceCoins = Object.entries(BINANCE_SYMS).filter(([c]) => c !== 'hype');
    await Promise.allSettled(
      binanceCoins.flatMap(([coin, sym]) =>
        (['1h', '4h'] as const).map(async (tf) => {
          try {
            const res = await fetch(
              `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${tf}&limit=16`
            );
            const klines = await res.json();
            if (!Array.isArray(klines) || klines.length < 15) return;
            const closes = klines.map((k: string[]) => parseFloat(k[4]));
            const rsi = computeRSI14(closes);
            if (rsi === null) return;
            updateCoin(coin as CoinId, tf === '1h' ? { rsi1h: rsi } : { rsi4h: rsi });
          } catch { /* */ }
        })
      )
    );
  }, [updateCoin]);

  /* ── Daily RSI (1D candles — all coins, runs every 15 min) ── */
  const fetchDailyRSI = useCallback(async () => {
    await Promise.allSettled([
      // Binance coins
      ...Object.entries(BINANCE_SYMS).filter(([c]) => c !== 'hype').map(async ([coin, sym]) => {
        try {
          const res = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=20`,
            { cache: 'no-store' }
          );
          const klines = await res.json();
          if (!Array.isArray(klines) || klines.length < 15) return;
          const closes = klines.map((k: string[]) => parseFloat(k[4]));
          const rsi = computeRSI14(closes);
          if (rsi !== null) updateCoin(coin as CoinId, { rsiDaily: rsi });
        } catch { /* */ }
      }),
      // HYPE via Bybit (D = daily interval)
      (async () => {
        try {
          const res = await fetch(
            `https://api.bybit.com/v5/market/kline?category=linear&symbol=HYPEUSDT&interval=D&limit=20`,
            { cache: 'no-store' }
          );
          const d = await res.json();
          const klines: string[][] = [...(d?.result?.list ?? [])].reverse();
          if (klines.length < 15) return;
          const closes = klines.map(k => parseFloat(k[4]));
          const rsi = computeRSI14(closes);
          if (rsi !== null) updateCoin('hype', { rsiDaily: rsi });
        } catch { /* */ }
      })(),
    ]);
  }, [updateCoin]);

  /* ── CVD + Divergence + Whale detection (all Binance coins + HYPE via Bybit) ── */
  const fetchCVD = useCallback(async () => {
    // All Binance-listed coins
    const binanceCoins = (Object.keys(BINANCE_SYMS) as CoinId[]).filter(c => c !== 'hype');
    await Promise.allSettled([
      // ── Binance aggTrades ──
      ...binanceCoins.map(async (coin) => {
        const sym = BINANCE_SYMS[coin];
        try {
          const res = await fetch(
            `https://api.binance.com/api/v3/aggTrades?symbol=${sym}&limit=200`
          );
          const trades = await res.json();
          if (!Array.isArray(trades)) return;

          let buyVol = 0, sellVol = 0;
          const lastSeenId = lastAggIdRef.current[coin] ?? 0;
          let newLastId = lastSeenId;

          trades.forEach((t: { m: boolean; q: string; p: string; a: number }) => {
            const qty = parseFloat(t.q);
            const price = parseFloat(t.p);
            const usd = price * qty;

            // CVD
            if (t.m) sellVol += qty; else buyVol += qty;

            // Whale detection — only emit for truly new trades
            if (t.a > lastSeenId && usd >= WHALE_USD_THRESHOLD) {
              const side = t.m ? 'SELL' : 'BUY';
              window.dispatchEvent(new CustomEvent('whale-trade', {
                detail: { id: t.a, symbol: coin.toUpperCase(), side, usdValue: usd, price, qty, ts: Math.floor(Date.now() / 1000) },
              }));
            }
            if (t.a > newLastId) newLastId = t.a;
          });

          lastAggIdRef.current[coin] = newLastId;
          const cvdValue = buyVol - sellVol;

          // CVD divergence: compare first vs last of 5-snapshot window
          let _newDiv: 'bullish' | 'bearish' | null = null;
          let _capPrice = 0;
          setStore(prev => {
            const currentPrice = prev.coins[coin]?.price ?? 0;
            const snaps = [...(cvdSnapsRef.current[coin] ?? []), { price: currentPrice, cvd: cvdValue }].slice(-5);
            cvdSnapsRef.current[coin] = snaps;

            let cvdDivergence: 'bullish' | 'bearish' | null = null;
            if (snaps.length >= 4 && snaps[0].price > 0) {
              const first = snaps[0], last = snaps[snaps.length - 1];
              const pricePct = (last.price - first.price) / first.price;
              const cvdDelta = last.cvd - first.cvd;
              // Direction matters more than magnitude for alts — use price % as primary gate
              if (pricePct > 0.003 && cvdDelta < 0) cvdDivergence = 'bearish';
              if (pricePct < -0.003 && cvdDelta > 0) cvdDivergence = 'bullish';
            }
            _newDiv = cvdDivergence;
            _capPrice = currentPrice;

            return {
              ...prev,
              coins: {
                ...prev.coins,
                [coin]: { ...prev.coins[coin], cvd: cvdValue, cvdDivergence } as CoinData,
              },
            };
          });
          // Alert on new divergence (transition from null/other → bullish/bearish)
          if (_newDiv && _newDiv !== (cvdDivStateRef.current[coin] ?? null)) {
            sendCVDAlert(coin, _newDiv, _capPrice, cvdAlertCooldown.current);
          }
          cvdDivStateRef.current[coin] = _newDiv;
        } catch { /* */ }
      }),
      // ── HYPE via Bybit recent-trade (Bybit-only coin) ──
      (async () => {
        try {
          const res = await fetch(
            'https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=HYPEUSDT&limit=200',
            { cache: 'no-store' }
          );
          const data = await res.json();
          // Bybit linear recent-trade fields: price, size, side (NOT p/v/S — those are spot fields)
          const trades: Array<{ side: string; size: string; price: string }> = data.result?.list ?? [];
          let buyVol = 0, sellVol = 0;
          trades.forEach(t => {
            const qty = parseFloat(t.size);
            const usd = parseFloat(t.price) * qty;
            if (!isFinite(qty) || !isFinite(usd)) return;
            if (t.side === 'Buy') buyVol += qty; else sellVol += qty;
            // Whale detection for HYPE
            if (usd >= WHALE_USD_THRESHOLD) {
              window.dispatchEvent(new CustomEvent('whale-trade', {
                detail: { id: Date.now(), symbol: 'HYPE', side: t.side === 'Buy' ? 'BUY' : 'SELL', usdValue: usd, price: parseFloat(t.price), qty, ts: Math.floor(Date.now() / 1000) },
              }));
            }
          });
          const cvdValue = buyVol - sellVol;
          let _hypeDiv: 'bullish' | 'bearish' | null = null;
          let _hypePrice = 0;
          setStore(prev => {
            const currentPrice = prev.coins.hype?.price ?? 0;
            const snaps = [...(cvdSnapsRef.current.hype ?? []), { price: currentPrice, cvd: cvdValue }].slice(-5);
            cvdSnapsRef.current.hype = snaps;
            let cvdDivergence: 'bullish' | 'bearish' | null = null;
            if (snaps.length >= 4 && snaps[0].price > 0) {
              const first = snaps[0], last = snaps[snaps.length - 1];
              const pricePct = (last.price - first.price) / first.price;
              const cvdDelta = last.cvd - first.cvd;
              if (pricePct > 0.003 && cvdDelta < 0) cvdDivergence = 'bearish';
              if (pricePct < -0.003 && cvdDelta > 0) cvdDivergence = 'bullish';
            }
            _hypeDiv = cvdDivergence;
            _hypePrice = currentPrice;
            return { ...prev, coins: { ...prev.coins, hype: { ...prev.coins.hype, cvd: cvdValue, cvdDivergence } as CoinData } };
          });
          if (_hypeDiv && _hypeDiv !== (cvdDivStateRef.current.hype ?? null)) {
            sendCVDAlert('hype', _hypeDiv, _hypePrice, cvdAlertCooldown.current);
          }
          cvdDivStateRef.current.hype = _hypeDiv;
        } catch { /* */ }
      })(),
    ]);
  }, []);  // no deps — uses refs + setStore callback

  /* ── Order Book walls (BTC + ETH only) ── */
  const fetchOrderBook = useCallback(async () => {
    await Promise.allSettled(
      (['btc', 'eth'] as CoinId[]).map(async (coin) => {
        const sym = BINANCE_SYMS[coin];
        try {
          const res = await fetch(
            `https://api.binance.com/api/v3/depth?symbol=${sym}&limit=50`
          );
          const data = await res.json();
          if (!data.bids || !data.asks) return;

          const parseSide = (arr: string[][]): { price: number; size: number }[] =>
            arr
              .map(([p, s]) => ({ price: parseFloat(p), size: parseFloat(s) }))
              .sort((a, b) => b.size - a.size)
              .slice(0, 3);

          updateCoin(coin, {
            orderBidWalls: parseSide(data.bids),
            orderAskWalls: parseSide(data.asks),
          });
        } catch { /* */ }
      })
    );
  }, [updateCoin]);

  /* ── Deribit options: Put/Call ratio + Max Pain + GEX ── */
  const fetchDeribitOptions = useCallback(async () => {
    try {
      const res = await fetch(
        'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option'
      );
      const data = await res.json();
      const summaries: Array<{
        instrument_name: string;
        open_interest: number;
        mark_iv: number;           // implied volatility %
        underlying_price: number;  // BTC spot at time of snapshot
      }> = data?.result ?? [];
      if (!summaries.length) return;

      const now = Date.now();

      /* ── Black-Scholes helpers ── */
      const normalPDF = (x: number): number =>
        Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

      // Gamma = N'(d1) / (S × σ × √T)
      // Minimum T of 1 day avoids 0/0 → NaN for options expiring today/imminently
      const bsGamma = (S: number, K: number, T: number, sigma: number): number => {
        if (T < 1 / 365 || sigma <= 0 || S <= 0 || K <= 0) return 0;
        const sqrtT = Math.sqrt(T);
        const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
        const g = normalPDF(d1) / (S * sigma * sqrtT);
        return isFinite(g) ? g : 0;   // guard against any residual Inf/NaN
      };

      const MON: Record<string, number> = {
        JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11,
      };

      // Deribit format: BTC-27JUN25-100000-C
      const expiryMs = (expStr: string): number => {
        const d = parseInt(expStr.slice(0, 2));
        const m = MON[expStr.slice(2, 5)];
        const y = 2000 + parseInt(expStr.slice(5, 7));
        return new Date(y, m, d, 8, 0, 0, 0).getTime(); // 08:00 UTC expiry
      };

      const callsOI: Record<number, number> = {};
      const putsOI:  Record<number, number> = {};
      let totalCallOI = 0, totalPutOI = 0;

      // GEX accumulators keyed by strike
      const gexByStrike: Record<number, number> = {};
      let spotForGex = 0;

      summaries.forEach(({ instrument_name, open_interest, mark_iv, underlying_price }) => {
        const parts = instrument_name.split('-');
        if (parts.length < 4) return;
        const strike = parseFloat(parts[2]);
        const type   = parts[3]; // 'C' or 'P'
        if (isNaN(strike)) return;
        const oi = open_interest || 0;

        /* ── P/C ratio OI tracking ── */
        if (type === 'C') { callsOI[strike] = (callsOI[strike] ?? 0) + oi; totalCallOI += oi; }
        if (type === 'P') { putsOI[strike]  = (putsOI[strike]  ?? 0) + oi; totalPutOI  += oi; }

        /* ── GEX calculation ── */
        if (oi <= 0) return;
        const iv = mark_iv;
        const S  = underlying_price;
        if (!iv || iv <= 0 || iv > 500 || !S || S <= 0) return;
        if (!spotForGex) spotForGex = S;

        const T     = Math.max(0, (expiryMs(parts[1]) - now) / (365.25 * 24 * 3600 * 1000));
        if (T <= 0) return; // expired
        const sigma = iv / 100;
        const gamma = bsGamma(S, strike, T, sigma);
        if (!gamma || !isFinite(gamma)) return; // skip NaN / Inf / 0 gamma

        // Calls add positive GEX (dealers long gamma above); puts subtract (dealers short gamma below)
        const sign = type === 'C' ? 1 : -1;
        const gexContrib = sign * gamma * oi * S * S;
        if (!isFinite(gexContrib)) return; // guard against overflow
        gexByStrike[strike] = (gexByStrike[strike] ?? 0) + gexContrib;
      });

      /* ── P/C Ratio ── */
      const pcRatio = totalCallOI > 0 ? totalPutOI / totalCallOI : null;

      /* ── Max Pain ── */
      const allStrikes = Array.from(
        new Set([...Object.keys(callsOI), ...Object.keys(putsOI)].map(Number))
      ).sort((a, b) => a - b);

      let minPain = Infinity, maxPain: number | null = null;
      allStrikes.forEach(testPrice => {
        let pain = 0;
        allStrikes.forEach(k => {
          pain += (callsOI[k] ?? 0) * Math.max(0, testPrice - k);
          pain += (putsOI[k] ?? 0) * Math.max(0, k - testPrice);
        });
        if (pain < minPain) { minPain = pain; maxPain = testPrice; }
      });

      /* ── GEX summary ── */
      const hasGexData = Object.keys(gexByStrike).length > 0;
      // Use ?? 0 inside reduce so a stray NaN entry doesn't sink everything;
      // store null only when we genuinely have no options data.
      const rawNetGex = hasGexData
        ? Object.values(gexByStrike).reduce((a, b) => a + (isFinite(b) ? b : 0), 0)
        : null;
      const btcNetGex: number | null = hasGexData
        ? (isFinite(rawNetGex as number) ? (rawNetGex as number) : 0)
        : null;

      // Zero-gamma flip level: cumulative GEX from lowest strike crosses zero
      const sortedByStrike = Object.keys(gexByStrike)
        .map(Number).sort((a, b) => a - b);
      let cumGex = 0, btcGexFlip: number | null = null;
      for (let i = 0; i < sortedByStrike.length; i++) {
        const prev = cumGex;
        const v = gexByStrike[sortedByStrike[i]];
        if (!isFinite(v)) continue;
        cumGex += v;
        if (i > 0 && prev !== 0 && Math.sign(prev) !== Math.sign(cumGex)) {
          const sA = sortedByStrike[i - 1], sB = sortedByStrike[i];
          btcGexFlip = Math.round(sA + (sB - sA) * Math.abs(prev) / (Math.abs(prev) + Math.abs(cumGex)));
          break;
        }
      }

      // Top strikes near ATM for chart (±35% from spot, sorted descending, top 8)
      const btcGexLevels: GexLevel[] = Object.entries(gexByStrike)
        .map(([k, v]) => ({ strike: Number(k), gex: v }))
        .filter(e => isFinite(e.gex) && (spotForGex > 0
          ? Math.abs(e.strike - spotForGex) / spotForGex <= 0.35
          : true))
        .sort((a, b) => b.strike - a.strike)
        .slice(0, 8);

      setStore(s => ({
        ...s,
        btcPcRatio: pcRatio,
        btcMaxPain: maxPain,
        btcNetGex,                         // proper null only when no data
        btcGexFlip: btcGexFlip ?? null,
        btcGexLevels,
      }));
    } catch { /* fail silently */ }
  }, []);

  /* ── Stablecoin supply (DefiLlama) ── */
  const fetchStablecoinFlows = useCallback(async () => {
    try {
      const res = await fetch(
        'https://stablecoins.llama.fi/stablecoins?includePrices=true',
        { cache: 'no-cache' }
      );
      const data = await res.json();
      const coins: Array<{ symbol: string; circulating: { peggedUSD?: number } }> =
        data?.peggedAssets ?? [];

      let total = 0;
      coins.forEach(({ symbol, circulating }) => {
        if (symbol === 'USDT' || symbol === 'USDC') {
          total += circulating?.peggedUSD ?? 0;
        }
      });

      const supplyB = total / 1e9;
      if (supplyB === 0) return;

      setStore(s => ({
        ...s,
        stablecoinPrev: s.stablecoinSupply,
        stablecoinSupply: supplyB,
      }));
    } catch { /* fail silently */ }
  }, []);

  /* ── Coinglass: exchange net flow + liquidation levels ── */
  const fetchCoinglassData = useCallback(async () => {
    /* 1. Exchange net flow */
    try {
      const res = await fetch('/api/proxy?type=coinglass-flow', { cache: 'no-cache' });
      const data = await res.json();
      const netInflow =
        data?.data?.netInflow ??
        data?.data?.[data?.data?.length - 1]?.netInflow ??
        null;
      if (netInflow != null) {
        setStore(s => ({ ...s, btcExchangeNetFlow: parseFloat(String(netInflow)) }));
      }
    } catch { /* fail silently */ }

    /* 2. Liquidation levels */
    try {
      const res = await fetch('/api/proxy?type=coinglass-liq', { cache: 'no-cache' });
      const data = await res.json();
      const arr: Array<{ price: number; amount: number; side: string }> =
        data?.data ?? [];
      if (!Array.isArray(arr) || arr.length === 0) return;
      const levels = arr
        .filter(item => item.price != null && item.amount != null)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 8)
        .map(item => ({
          price: parseFloat(String(item.price)),
          amount: parseFloat(String(item.amount)),
          side: (String(item.side).toLowerCase().includes('long') ? 'long' : 'short') as 'long' | 'short',
        }));
      setStore(s => ({ ...s, btcLiqLevels: levels }));
    } catch { /* fail silently */ }
  }, []);

  /* ── Google Trends 'bitcoin' (7-day) ── */
  const fetchGoogleTrends = useCallback(async () => {
    try {
      const res = await fetch('/api/proxy?type=trends', { cache: 'no-cache' });
      const dataJson = await res.json();
      const timelineData: Array<{ value: number[] }> =
        dataJson?.default?.timelineData ?? [];
      if (!timelineData.length) return;
      const score = timelineData[timelineData.length - 1]?.value?.[0];
      if (score != null) {
        setStore(s => ({ ...s, googleTrendsBtc: score }));
      }
    } catch { /* fail silently */ }
  }, []);

  /* ── OI Trend bootstrap — Bybit historical OI + klines ── */
  // Fires once on mount to populate OI trend without waiting for two 8-min Bybit polls
  const bootstrapOITrend = useCallback(async () => {
    await Promise.allSettled(
      Object.entries(BYBIT_SYMS).map(async ([coin, sym]) => {
        try {
          const [oiRes, klRes] = await Promise.all([
            fetch(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${sym}&intervalTime=1h&limit=3`),
            fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=60&limit=4`),
          ]);
          const oiData = await oiRes.json();
          const klData = await klRes.json();

          // Both are newest-first — reverse to oldest-first
          const oiList: Array<{ openInterest: string }> = [...(oiData?.result?.list ?? [])].reverse();
          const klList: string[][] = [...(klData?.result?.list ?? [])].reverse();

          if (oiList.length < 2 || klList.length < 2) return;

          const readings = [
            { oi: parseFloat(oiList[0].openInterest), price: parseFloat(klList[0][4]) },
            { oi: parseFloat(oiList[oiList.length - 1].openInterest), price: parseFloat(klList[klList.length - 1][4]) },
          ].filter(r => r.oi > 0 && r.price > 0);

          if (readings.length < 2) return;

          // Pre-populate history so live polls have a baseline
          oiHistRef.current[coin as CoinId] = readings;

          const first = readings[0], last = readings[1];
          const oiChg    = (last.oi    - first.oi)    / first.oi;
          const priceChg = (last.price - first.price) / first.price;

          if (Math.abs(oiChg) > 0.002 || Math.abs(priceChg) > 0.001) {
            const oiUp = oiChg > 0, priceUp = priceChg > 0;
            const oiTrend: 'strong_up' | 'weak_up' | 'strong_down' | 'weak_down' =
                  oiUp && priceUp   ? 'strong_up'
                : oiUp && !priceUp  ? 'strong_down'
                : !oiUp && priceUp  ? 'weak_up'
                :                     'weak_down';
            updateCoin(coin as CoinId, { oiTrend });
          }
        } catch { /* fail silently */ }
      })
    );
  }, [updateCoin]);

  /* ── Coinbase Premium Index (Coinbase BTC − Bybit BTC) ── */
  const fetchCoinbasePremium = useCallback(async () => {
    try {
      const res = await fetch('/api/coinbase-price', { cache: 'no-store' });
      if (!res.ok) return;
      const { price: cbPrice } = await res.json() as { price: number };
      if (!cbPrice || isNaN(cbPrice)) return;
      setStore(s => {
        const bybitPrice = s.coins.btc?.price;
        if (!bybitPrice) return { ...s, cbPremium: null, cbPremiumPct: null };
        const premium    = cbPrice - bybitPrice;
        const premiumPct = (premium / bybitPrice) * 100;
        return { ...s, cbPremium: premium, cbPremiumPct: premiumPct };
      });
    } catch { /* fail silently */ }
  }, []);

  /* ── Binance premium index → next FR estimate (Binance perps) ── */
  const fetchPremiumIndex = useCallback(async () => {
    try {
      const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex', { cache: 'no-store' });
      if (!res.ok) return;
      const data: Array<{
        symbol: string; markPrice: string; indexPrice: string;
        interestRate: string; nextFundingTime: number;
      }> = await res.json();
      if (!Array.isArray(data)) return;
      data.forEach(item => {
        const id = SYM_MAP[item.symbol];
        if (!id) return;
        const mark  = parseFloat(item.markPrice);
        const index = parseFloat(item.indexPrice);
        if (!mark || !index || index === 0) return;
        // Binance: FR = P + clamp(interestRate − P, −0.05%, +0.05%)
        const P  = (mark - index) / index;
        const ir = parseFloat(item.interestRate);
        const nextFrEstimate = P + Math.max(-0.0005, Math.min(0.0005, ir - P));
        updateCoin(id, { nextFrEstimate, nextFundingTime: item.nextFundingTime });
      });
    } catch { /* */ }
  }, [updateCoin]);

  /* ── Oil + DXY + SPX + Gold — fetched via /api/macro (server-side, no CORS) ── */
  const fetchMacro = useCallback(async () => {
    try {
      const res = await fetch('/api/macro', { cache: 'no-store' });
      if (!res.ok) return;
      const d: {
        oil:  { price: number; chg: number } | null;
        dxy:  { price: number; chg: number } | null;
        spx:  { price: number; chg: number } | null;
        gold: { price: number; chg: number } | null;
      } = await res.json();

      setStore(s => ({
        ...s,
        ...(d.oil  ? { oilPrice: d.oil.price }                           : {}),
        ...(d.dxy  ? { dxy:  d.dxy.price,  dxyChg:  d.dxy.chg  }       : {}),
        ...(d.spx  ? { spx:  d.spx.price,  spxChg:  d.spx.chg  }       : {}),
        ...(d.gold ? { gold: d.gold.price, goldChg: d.gold.chg  }       : {}),
      }));
    } catch { /* fail silently */ }
  }, []);

  /* ── Fear & Greed ── */
  const fetchFNG = useCallback(async () => {
    try {
      const res = await fetch('https://api.alternative.me/fng/?limit=2&format=json', { cache: 'no-cache' });
      const d = await res.json();
      const items = d.data;
      if (!items?.[0]?.value) return;
      setStore(s => ({
        ...s,
        fng: parseInt(items[0].value),
        fngLabel: items[0].value_classification || '',
        fngPrev: items[1] ? parseInt(items[1].value) : null,
      }));
    } catch {
      try {
        const res = await fetch('https://api.alternative.me/fng/?limit=2&format=json', { cache: 'no-cache' });
        const d = await res.json();
        const items = d.data;
        if (!items?.[0]?.value) return;
        setStore(s => ({
          ...s,
          fng: parseInt(items[0].value),
          fngLabel: items[0].value_classification || '',
          fngPrev: items[1] ? parseInt(items[1].value) : null,
        }));
      } catch { /* */ }
    }
  }, []);

  /* ── BTC + ETH Spot ETF Net Flows (SoSoValue) ── */
  const fetchETF = useCallback(async () => {
    try {
      const res = await fetch('/api/proxy?type=etf', { cache: 'no-cache' });
      const { btc, eth } = await res.json();
      if (btc) {
        const raw = btc?.data?.list?.[0]?.totalNetInflow
          ?? btc?.data?.totalNetInflow
          ?? btc?.list?.[0]?.totalNetInflow
          ?? btc?.totalNetInflow;
        if (raw != null) setStore(s => ({ ...s, etfNetFlow: parseFloat(String(raw)) }));
      }
      if (eth) {
        const raw = eth?.data?.list?.[0]?.totalNetInflow
          ?? eth?.data?.totalNetInflow
          ?? eth?.list?.[0]?.totalNetInflow
          ?? eth?.totalNetInflow;
        if (raw != null) setStore(s => ({ ...s, ethEtfNetFlow: parseFloat(String(raw)) }));
      }
    } catch { /* fail silently */ }
  }, []);

  /* ── BTC + ETH Dominance via CMC (accurate — excludes stablecoins from total) ── */
  const fetchCMCGlobal = useCallback(async () => {
    try {
      const res = await fetch('/api/cmc?type=global');
      const d = await res.json();
      const dom    = d?.data?.btc_dominance   as number | undefined;
      const ethDom = d?.data?.eth_dominance   as number | undefined;
      if (dom) {
        setStore(s => ({
          ...s,
          btcDom:       parseFloat(dom.toFixed(2)),
          btcDomHistory:[...s.btcDomHistory.slice(-9), parseFloat(dom.toFixed(2))],
          ethDom:       ethDom != null ? parseFloat(ethDom.toFixed(2)) : s.ethDom,
        }));
      }
    } catch { /* */ }
  }, []);

  /* ── Alt Season Index (top-50 alts vs BTC, 90-day) ── */
  // Symbols to exclude from the top-50 eligible list
  const STABLECOINS = new Set([
    'USDT','USDC','DAI','BUSD','TUSD','FRAX','USDP','GUSD','PYUSD',
    'USDE','FDUSD','USDS','USDD','LUSD','SUSD','CRVUSD','USDX',
  ]);
  const WRAPPED = new Set(['WBTC','WETH','WEETH','WBETH','STETH','CBETH','RETH']);

  const fetchAltSeason = useCallback(async () => {
    try {
      const res = await fetch('/api/cmc?type=altseason');
      const d = await res.json();
      const coins = (d?.data ?? []) as Array<{
        symbol: string;
        tags?: string[];
        quote?: { USD?: { percent_change_90d?: number } };
      }>;

      const btc   = coins.find(c => c.symbol === 'BTC');
      if (!btc) return;
      const btc90 = btc.quote?.USD?.percent_change_90d ?? 0;

      const eligible = coins
        .filter(c =>
          c.symbol !== 'BTC' &&
          !STABLECOINS.has(c.symbol) &&
          !WRAPPED.has(c.symbol) &&
          !c.tags?.includes('stablecoin') &&
          !c.tags?.includes('wrapped-tokens')
        )
        .slice(0, 50);

      if (!eligible.length) return;

      const beat  = eligible.filter(c => (c.quote?.USD?.percent_change_90d ?? -Infinity) > btc90).length;
      const score = Math.round((beat / eligible.length) * 100);

      setStore(s => ({ ...s, altSeasonScore: score }));
    } catch { /* */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Liquidation Cascade Detector — Binance futures all-symbols stream ── */
  useEffect(() => {
    const FUTURES_MAP: Record<string, string> = {
      BTCUSDT: 'BTC', ETHUSDT: 'ETH', SOLUSDT: 'SOL',
      XRPUSDT: 'XRP', BNBUSDT: 'BNB', NEARUSDT: 'NEAR', SUIUSDT: 'SUI',
    };
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;

    function connect() {
      if (!alive) return;
      ws = new WebSocket('wss://fstream.binance.com/ws/!forceOrder@arr');
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          const order = msg.data?.o ?? msg.o;
          if (!order?.s) return;
          const coin = FUTURES_MAP[order.s];
          if (!coin) return;
          // S:"SELL" = long position liquidated (forced sell); S:"BUY" = short liquidated
          const side: 'LONG' | 'SHORT' = order.S === 'SELL' ? 'LONG' : 'SHORT';
          const usd = parseFloat(order.ap || order.p || '0') * parseFloat(order.z || order.q || '0');
          if (!isFinite(usd) || usd <= 0) return;
          const now = Date.now();
          liqBufferRef.current.push({ coin, side, usd, ts: now });
          // Keep rolling 2-min buffer (cascade window is 60s — extra headroom)
          liqBufferRef.current = liqBufferRef.current.filter(l => l.ts > now - 120_000);
        } catch { /* */ }
      };
      ws.onclose = () => { if (alive) reconnectTimer = setTimeout(connect, 5_000); };
      ws.onerror = () => { try { ws?.close(); } catch { /* */ } };
    }

    connect();

    // Cascade analyzer — check every 5s
    const analyzer = setInterval(() => {
      const now = Date.now();
      const w = liqBufferRef.current.filter(l => l.ts > now - 60_000);
      if (!w.length) return;

      const byCoin: Record<string, { l: number; s: number }> = {};
      let mktL = 0, mktS = 0;
      w.forEach(({ coin, side, usd }) => {
        if (!byCoin[coin]) byCoin[coin] = { l: 0, s: 0 };
        if (side === 'LONG') { byCoin[coin].l += usd; mktL += usd; }
        else                 { byCoin[coin].s += usd; mktS += usd; }
      });

      let fired = false;
      for (const [coin, { l: lUsd, s: sUsd }] of Object.entries(byCoin)) {
        const thr = LIQ_CASCADE_THRESHOLDS[coin] ?? LIQ_CASCADE_THRESHOLDS.DEFAULT;
        if (lUsd >= thr || sUsd >= thr) {
          const side: 'LONG' | 'SHORT' | 'MIXED' =
            (lUsd >= thr && sUsd >= thr) ? 'MIXED' : lUsd >= thr ? 'LONG' : 'SHORT';
          setStore(s => ({ ...s, cascadeAlert: { coin, side, totalUsd: lUsd + sUsd, ts: now } }));
          sendCascadeAlert(coin, side, lUsd + sUsd, cascadeCooldown.current);
          fired = true; break;
        }
      }
      if (!fired) {
        const mktTotal = mktL + mktS;
        if (mktTotal >= MARKET_CASCADE_THRESHOLD) {
          const side: 'LONG' | 'SHORT' | 'MIXED' =
            mktL > mktS * 1.5 ? 'LONG' : mktS > mktL * 1.5 ? 'SHORT' : 'MIXED';
          setStore(s => ({ ...s, cascadeAlert: { coin: 'MARKET', side, totalUsd: mktTotal, ts: now } }));
          sendCascadeAlert('MARKET', side, mktTotal, cascadeCooldown.current);
        }
      }
    }, 5_000);

    return () => {
      alive = false;
      clearInterval(analyzer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { ws?.close(); } catch { /* */ }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Initialise on mount ── */
  useEffect(() => {
    restPoll(); // immediate prices before WS connects
    startWS();
    fetchBybit();
    fetchLSR();
    fetchVolume();
    fetchBybitKlines();       // RSI/MA20/VWAP/POC for HYPE
    fetchBybitMultiTFRSI();   // 1h + 4h RSI for HYPE
    fetchFNG();
    fetchCMCGlobal();
    fetchAltSeason();
    fetchMacro();
    fetchETF();
    fetchMultiTFRSI();
    fetchDailyRSI();
    fetchCVD();
    fetchOrderBook();
    fetchPremiumIndex();
    fetchDeribitOptions();
    fetchStablecoinFlows();
    fetchCoinglassData();
    fetchGoogleTrends();
    // CB Premium needs BTC price first — wait 3s for WS/REST to populate
    setTimeout(fetchCoinbasePremium, 3000);
    // Retry server-proxied APIs that may miss on Render cold start
    setTimeout(fetchCMCGlobal, 12_000);
    setTimeout(fetchMacro, 12_000);
    // OI bootstrap — gives immediate trend signal without waiting for two 8-min Bybit polls
    bootstrapOITrend();

    const intervals = [
      setInterval(fetchBybit,             8  * 60 * 1000),
      setInterval(fetchLSR,               5  * 60 * 1000),
      setInterval(fetchVolume,            3  * 60 * 1000),
      setInterval(fetchBybitKlines,       3  * 60 * 1000),  // same cadence as Binance klines
      setInterval(fetchBybitMultiTFRSI,  15  * 60 * 1000),  // same as Binance multi-TF
      setInterval(fetchFNG,             24  * 60 * 60 * 1000),
      setInterval(fetchCMCGlobal,         5  * 60 * 1000),   // BTC/ETH dom — CMC, every 5m
      setInterval(fetchAltSeason,        15  * 60 * 1000),   // 90d score — slow-moving, every 15m
      setInterval(fetchMacro,            10  * 60 * 1000),
      setInterval(fetchETF,              30  * 60 * 1000),
      setInterval(fetchMultiTFRSI,       15  * 60 * 1000),
      setInterval(fetchDailyRSI,         15  * 60 * 1000),  // 1D RSI — slow-moving, every 15m
      setInterval(fetchCVD,               5  * 60 * 1000),
      setInterval(fetchOrderBook,         2  * 60 * 1000),
      setInterval(fetchPremiumIndex,     30  * 1000),        // every 30s — premium changes frequently
      setInterval(fetchDeribitOptions,   15  * 60 * 1000),
      setInterval(fetchStablecoinFlows,  30  * 60 * 1000),
      setInterval(fetchCoinglassData,    15  * 60 * 1000),
      setInterval(fetchGoogleTrends,     60  * 60 * 1000),
      setInterval(fetchCoinbasePremium,   30 * 1000),      // every 30s
    ];

    return () => {
      intervals.forEach(clearInterval);
      wsRef.current?.close();
      if (restTimerRef.current) clearInterval(restTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MarketContext.Provider value={{ store, setStore, selectCoin }}>
      {children}
    </MarketContext.Provider>
  );
}
