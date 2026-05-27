'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MarketContext, MarketStore, defaultStore, CoinId, CoinData, GexLevel,
  BINANCE_SYMS, BYBIT_SYMS,
} from '@/lib/marketStore';

const WHALE_USD_THRESHOLD = 500_000; // $500k single trade = whale

const WS_URLS = [
  'wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/ethusdt@ticker/solusdt@ticker/xrpusdt@ticker/bnbusdt@ticker/nearusdt@ticker/zecusdt@ticker',
  'wss://stream.binance.com/stream?streams=btcusdt@ticker/ethusdt@ticker/solusdt@ticker/xrpusdt@ticker/bnbusdt@ticker/nearusdt@ticker/zecusdt@ticker',
];

const SYM_MAP: Record<string, CoinId> = {
  BTCUSDT: 'btc', ETHUSDT: 'eth', SOLUSDT: 'sol',
  XRPUSDT: 'xrp', BNBUSDT: 'bnb', NEARUSDT: 'near', ZECUSDT: 'zec',
};

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

  /* ── Bybit: HYPE price + funding rates + OI + perpPrice + OI Trend ── */
  const fetchBybit = useCallback(async () => {
    const coins = Object.keys(BYBIT_SYMS);
    await Promise.allSettled(coins.map(async (coin) => {
      const sym = BYBIT_SYMS[coin];
      try {
        const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${sym}`);
        const d = await res.json();
        const item = d.result?.list?.[0];
        if (!item) return;

        const curOI    = parseFloat(item.openInterestValue || '0');
        const curPrice = parseFloat(item.lastPrice || '0');

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

        const patch: Partial<MarketStore['coins'][CoinId]> = {
          fundingRate: parseFloat(item.fundingRate || '0'),
          oi: curOI,
          perpPrice: curPrice,
          oiTrend,
        };
        if (coin === 'hype') {
          patch.price  = curPrice;
          patch.change = parseFloat(item.price24hPcnt || '0') * 100;
          patch.high   = parseFloat(item.highPrice24h || '0');
          patch.low    = parseFloat(item.lowPrice24h || '0');
        }
        updateCoin(coin as CoinId, patch);
      } catch { /* */ }
    }));
  }, [updateCoin]);

  /* ── Bybit LSR ── */
  const fetchLSR = useCallback(async () => {
    await Promise.allSettled(
      Object.entries(BYBIT_SYMS).filter(([c]) => c !== 'hype').map(async ([coin, sym]) => {
        try {
          const res = await fetch(`https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${sym}&period=1h&limit=1`);
          const d = await res.json();
          const item = d.result?.list?.[0];
          if (!item) return;
          updateCoin(coin as CoinId, {
            longRatio: parseFloat(item.buyRatio || '0.5'),
            shortRatio: parseFloat(item.sellRatio || '0.5'),
          });
        } catch { /* */ }
      })
    );
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
      // Fetch 100 candles: enough for RSI, MA20, vol ratio AND volume profile
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=15m&limit=100`);
      const klines = await res.json();
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

      /* ── Taker Buy/Sell ratio (last 20 candles ≈ 5h) ──
         k[9] = taker buy base volume, k[5] = total base volume
         takerBuyRatio > 0.55 = buyers hitting asks (aggression = bullish)
         takerBuyRatio < 0.45 = sellers hitting bids (aggression = bearish) */
      let totalBuyVol = 0, totalBaseVol = 0;
      klines.slice(-20).forEach((k: string[]) => {
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

      updateCoin(coin, { volRatio: avg > 0 ? current / avg : 1, ma20, rsi14, poc, vah, val, vwap, takerBuyRatio });
    } catch { /* */ }
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

  /* ── CVD + Divergence + Whale detection (BTC + ETH) ── */
  const fetchCVD = useCallback(async () => {
    await Promise.allSettled(
      (['btc', 'eth'] as CoinId[]).map(async (coin) => {
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
          setStore(prev => {
            const currentPrice = prev.coins[coin]?.price ?? 0;
            const snaps = [...(cvdSnapsRef.current[coin] ?? []), { price: currentPrice, cvd: cvdValue }].slice(-5);
            cvdSnapsRef.current[coin] = snaps;

            let cvdDivergence: 'bullish' | 'bearish' | null = null;
            if (snaps.length >= 4 && snaps[0].price > 0) {
              const first = snaps[0], last = snaps[snaps.length - 1];
              const pricePct = (last.price - first.price) / first.price;
              const cvdDelta = last.cvd - first.cvd;
              // Bearish: price up but CVD net selling (delta < -10 BTC equivalent)
              if (pricePct > 0.003 && cvdDelta < -10) cvdDivergence = 'bearish';
              // Bullish: price down but CVD net buying (delta > +10)
              if (pricePct < -0.003 && cvdDelta > 10) cvdDivergence = 'bullish';
            }

            return {
              ...prev,
              coins: {
                ...prev.coins,
                [coin]: { ...prev.coins[coin], cvd: cvdValue, cvdDivergence } as CoinData,
              },
            };
          });
        } catch { /* */ }
      })
    );
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
      const bsGamma = (S: number, K: number, T: number, sigma: number): number => {
        if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0;
        const sqrtT = Math.sqrt(T);
        const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
        return normalPDF(d1) / (S * sigma * sqrtT);
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

        // Calls add positive GEX (dealers long gamma above); puts subtract (dealers short gamma below)
        const sign = type === 'C' ? 1 : -1;
        gexByStrike[strike] = (gexByStrike[strike] ?? 0) + sign * gamma * oi * S * S;
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
      const btcNetGex = Object.values(gexByStrike).reduce((a, b) => a + b, 0);

      // Zero-gamma flip level: cumulative GEX from lowest strike crosses zero
      const sortedByStrike = Object.keys(gexByStrike)
        .map(Number).sort((a, b) => a - b);
      let cumGex = 0, btcGexFlip: number | null = null;
      for (let i = 0; i < sortedByStrike.length; i++) {
        const prev = cumGex;
        cumGex += gexByStrike[sortedByStrike[i]];
        if (i > 0 && prev !== 0 && Math.sign(prev) !== Math.sign(cumGex)) {
          // Linear interpolation between two adjacent strikes
          const sA = sortedByStrike[i - 1], sB = sortedByStrike[i];
          btcGexFlip = Math.round(sA + (sB - sA) * Math.abs(prev) / (Math.abs(prev) + Math.abs(cumGex)));
          break;
        }
      }

      // Top strikes near ATM for chart (±25% from spot, sorted descending by strike, top 8)
      const btcGexLevels: GexLevel[] = Object.entries(gexByStrike)
        .map(([k, v]) => ({ strike: Number(k), gex: v }))
        .filter(e => spotForGex > 0
          ? Math.abs(e.strike - spotForGex) / spotForGex <= 0.25
          : true)
        .sort((a, b) => b.strike - a.strike)   // highest strike at top
        .slice(0, 8);

      setStore(s => ({
        ...s,
        btcPcRatio: pcRatio,
        btcMaxPain: maxPain,
        btcNetGex:  btcNetGex  || null,
        btcGexFlip: btcGexFlip || null,
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
    const proxy = (url: string) => 'https://corsproxy.io/?' + encodeURIComponent(url);

    /* 1. Exchange net flow */
    try {
      const res = await fetch(
        proxy('https://open-api.coinglass.com/public/v2/exchange_amount_chart?symbol=BTC&time_type=h24'),
        { cache: 'no-cache' }
      );
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
      const res = await fetch(
        proxy('https://open-api.coinglass.com/public/v2/liquidation_chart?symbol=BTC&time_type=h4'),
        { cache: 'no-cache' }
      );
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
    const proxy = (url: string) => 'https://corsproxy.io/?' + encodeURIComponent(url);
    try {
      /* Step 1 — explore endpoint to get token + request object */
      const exploreReq = JSON.stringify({
        comparisonItem: [{ keyword: 'bitcoin', geo: '', time: 'now 7-d' }],
        category: 0,
        property: '',
      });
      const exploreUrl =
        'https://trends.google.com/trends/api/explore?hl=en-US&tz=480&req=' +
        encodeURIComponent(exploreReq);

      const exploreRes = await fetch(proxy(exploreUrl), { cache: 'no-cache' });
      const exploreRaw = await exploreRes.text();
      const exploreJson = JSON.parse(exploreRaw.replace(/^\)\]\}'\\n/, '').replace(/^\)\]\}'\n/, ''));
      const widgets: Array<{ id: string; token: string; request: unknown }> =
        exploreJson?.widgets ?? [];
      const tsWidget = widgets.find(w => w.id === 'TIMESERIES');
      if (!tsWidget?.token || !tsWidget?.request) return;

      /* Step 2 — fetch actual timeline data */
      const dataUrl =
        'https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=480&req=' +
        encodeURIComponent(JSON.stringify(tsWidget.request)) +
        '&token=' +
        encodeURIComponent(tsWidget.token);

      const dataRes = await fetch(proxy(dataUrl), { cache: 'no-cache' });
      const dataRaw = await dataRes.text();
      const dataJson = JSON.parse(dataRaw.replace(/^\)\]\}'\\n/, '').replace(/^\)\]\}'\n/, ''));
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

  /* ── Coinbase Premium Index (Coinbase BTC − Binance BTC) ── */
  const fetchCoinbasePremium = useCallback(async () => {
    try {
      const res = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot', { cache: 'no-cache' });
      const data = await res.json();
      const cbPrice = parseFloat(data?.data?.amount);
      if (isNaN(cbPrice)) return;
      setStore(s => {
        const binancePrice = s.coins.btc?.price;
        if (!binancePrice) return { ...s, cbPremium: null, cbPremiumPct: null };
        const premium    = cbPrice - binancePrice;
        const premiumPct = (premium / binancePrice) * 100;
        return { ...s, cbPremium: premium, cbPremiumPct: premiumPct };
      });
    } catch { /* fail silently */ }
  }, []);

  /* ── Oil + Bond yields + DXY + SPX + Gold (Stooq.com — native CORS, no key) ── */
  const fetchMacro = useCallback(async () => {
    // Stooq JSON endpoint: returns latest quote with open/high/low/close
    // N/D fields are returned when market is closed or symbol not found
    const stooq = (sym: string) =>
      `https://stooq.com/q/l/?s=${sym}&f=sd2t2ohlcv&h&e=json`;

    const extractStooq = (d: Record<string, unknown>) => {
      const item = (d?.symbols as Record<string, number | string>[])?.[0];
      if (!item) return null;
      const close = typeof item.close === 'number' ? item.close : parseFloat(String(item.close));
      const open  = typeof item.open  === 'number' ? item.open  : parseFloat(String(item.open));
      if (!close || isNaN(close) || close <= 0) return null;  // covers 'N/D' → NaN
      const chg = open > 0 && !isNaN(open) ? ((close - open) / open) * 100 : 0;
      return { price: close, chg };
    };

    const results = await Promise.allSettled([
      fetch(stooq('cl.f'),    { cache: 'no-cache' }),   // WTI Crude Oil
      fetch(stooq('%5etnx'),  { cache: 'no-cache' }),   // US 10Y Treasury Yield
      fetch(stooq('%5edxy'),  { cache: 'no-cache' }),   // DXY (Dollar Index)
      fetch(stooq('%5espx'),  { cache: 'no-cache' }),   // S&P 500
      fetch(stooq('xauusd'), { cache: 'no-cache' }),   // Gold (XAU/USD)
    ]);

    const parse = async (r: PromiseSettledResult<Response>) => {
      if (r.status !== 'fulfilled' || !r.value.ok) return null;
      try { return extractStooq(await r.value.json()); } catch { return null; }
    };

    const [oil, bond, dxyData, spxData, goldData] = await Promise.all(results.map(parse));

    setStore(s => ({
      ...s,
      ...(oil      ? { oilPrice: oil.price }                             : {}),
      ...(bond     ? { bonds10y: bond.price }                            : {}),
      ...(dxyData  ? { dxy:  dxyData.price,  dxyChg:  dxyData.chg  }   : {}),
      ...(spxData  ? { spx:  spxData.price,  spxChg:  spxData.chg  }   : {}),
      ...(goldData ? { gold: goldData.price, goldChg: goldData.chg  }   : {}),
    }));
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
        const res = await fetch('https://corsproxy.io/?' + encodeURIComponent('https://api.alternative.me/fng/?limit=2'), { cache: 'no-cache' });
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
    const proxy = (url: string) => 'https://corsproxy.io/?' + encodeURIComponent(url);
    try {
      const [btcRes, ethRes] = await Promise.allSettled([
        fetch(proxy('https://sosovalue.xyz/api/etf/us-btc-spot?language=en'), { cache: 'no-cache' }),
        fetch(proxy('https://sosovalue.xyz/api/etf/us-eth-spot?language=en'), { cache: 'no-cache' }),
      ]);
      if (btcRes.status === 'fulfilled' && btcRes.value.ok) {
        const d = await btcRes.value.json();
        const raw = d?.data?.list?.[0]?.totalNetInflow
          ?? d?.data?.totalNetInflow
          ?? d?.list?.[0]?.totalNetInflow
          ?? d?.totalNetInflow;
        if (raw != null) setStore(s => ({ ...s, etfNetFlow: parseFloat(String(raw)) }));
      }
      if (ethRes.status === 'fulfilled' && ethRes.value.ok) {
        const d = await ethRes.value.json();
        const raw = d?.data?.list?.[0]?.totalNetInflow
          ?? d?.data?.totalNetInflow
          ?? d?.list?.[0]?.totalNetInflow
          ?? d?.totalNetInflow;
        if (raw != null) setStore(s => ({ ...s, ethEtfNetFlow: parseFloat(String(raw)) }));
      }
    } catch { /* fail silently */ }
  }, []);

  /* ── BTC Dominance (with history) ── */
  const fetchBTCDom = useCallback(async () => {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/global');
      const d = await res.json();
      const dom = d?.data?.market_cap_percentage?.btc;
      if (dom) {
        setStore(s => ({
          ...s,
          btcDom: dom,
          btcDomHistory: [...s.btcDomHistory.slice(-9), dom],
        }));
      }
    } catch { /* */ }
  }, []);

  /* ── Initialise on mount ── */
  useEffect(() => {
    restPoll(); // immediate prices before WS connects
    startWS();
    fetchBybit();
    fetchLSR();
    fetchVolume();
    fetchFNG();
    fetchBTCDom();
    fetchMacro();
    fetchETF();
    fetchMultiTFRSI();
    fetchCVD();
    fetchOrderBook();
    fetchDeribitOptions();
    fetchStablecoinFlows();
    fetchCoinglassData();
    fetchGoogleTrends();
    // CB Premium needs BTC price first — wait 3s for WS/REST to populate
    setTimeout(fetchCoinbasePremium, 3000);
    // OI bootstrap — gives immediate trend signal without waiting for two 8-min Bybit polls
    bootstrapOITrend();

    const intervals = [
      setInterval(fetchBybit,            8  * 60 * 1000),
      setInterval(fetchLSR,              5  * 60 * 1000),
      setInterval(fetchVolume,           3  * 60 * 1000),
      setInterval(fetchFNG,             24  * 60 * 60 * 1000),
      setInterval(fetchBTCDom,           5  * 60 * 1000),
      setInterval(fetchMacro,           10  * 60 * 1000),
      setInterval(fetchETF,             30  * 60 * 1000),
      setInterval(fetchMultiTFRSI,      15  * 60 * 1000),
      setInterval(fetchCVD,              5  * 60 * 1000),
      setInterval(fetchOrderBook,        2  * 60 * 1000),
      setInterval(fetchDeribitOptions,  15  * 60 * 1000),
      setInterval(fetchStablecoinFlows, 30  * 60 * 1000),
      setInterval(fetchCoinglassData,   15  * 60 * 1000),
      setInterval(fetchGoogleTrends,    60  * 60 * 1000),
      setInterval(fetchCoinbasePremium,  30 * 1000),      // every 30s
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
