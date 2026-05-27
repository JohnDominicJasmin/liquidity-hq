'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MarketContext, MarketStore, defaultStore, CoinId, CoinData,
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

      /* ── VWAP — typical price × volume ── */
      let sumTPV = 0, sumVol = 0;
      klines.forEach((k: string[], i: number) => {
        const tp = (highs[i] + lows[i] + closes[i]) / 3;
        sumTPV += tp * vols[i];
        sumVol += vols[i];
      });
      const vwap = sumVol > 0 ? sumTPV / sumVol : null;

      updateCoin(coin, { volRatio: avg > 0 ? current / avg : 1, ma20, rsi14, poc, vah, val, vwap });
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

  /* ── Deribit options: Put/Call ratio + Max Pain ── */
  const fetchDeribitOptions = useCallback(async () => {
    try {
      const res = await fetch(
        'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option'
      );
      const data = await res.json();
      const summaries: Array<{
        instrument_name: string;
        open_interest: number;
      }> = data?.result ?? [];
      if (!summaries.length) return;

      const callsOI: Record<number, number> = {};
      const putsOI: Record<number, number> = {};
      let totalCallOI = 0;
      let totalPutOI = 0;

      summaries.forEach(({ instrument_name, open_interest }) => {
        // e.g. BTC-26MAY24-40000-C
        const parts = instrument_name.split('-');
        if (parts.length < 4) return;
        const strike = parseFloat(parts[2]);
        const type = parts[3]; // 'C' or 'P'
        if (isNaN(strike)) return;
        const oi = open_interest || 0;
        if (type === 'C') {
          callsOI[strike] = (callsOI[strike] ?? 0) + oi;
          totalCallOI += oi;
        } else if (type === 'P') {
          putsOI[strike] = (putsOI[strike] ?? 0) + oi;
          totalPutOI += oi;
        }
      });

      const pcRatio = totalCallOI > 0 ? totalPutOI / totalCallOI : null;

      /* Max Pain: find strike that minimises total ITM payout */
      const allStrikes = Array.from(
        new Set([...Object.keys(callsOI), ...Object.keys(putsOI)].map(Number))
      ).sort((a, b) => a - b);

      let minPain = Infinity;
      let maxPain: number | null = null;

      allStrikes.forEach(testPrice => {
        let pain = 0;
        allStrikes.forEach(k => {
          pain += (callsOI[k] ?? 0) * Math.max(0, testPrice - k);
          pain += (putsOI[k] ?? 0) * Math.max(0, k - testPrice);
        });
        if (pain < minPain) {
          minPain = pain;
          maxPain = testPrice;
        }
      });

      setStore(s => ({ ...s, btcPcRatio: pcRatio, btcMaxPain: maxPain }));
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

  /* ── Oil + Bond yields + DXY + SPX + Gold ── */
  const fetchMacro = useCallback(async () => {
    const proxy = (url: string) => 'https://corsproxy.io/?' + encodeURIComponent(url);
    const yf = (sym: string) => proxy(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`);

    const extract = (d: Record<string, unknown>) => {
      const meta = (d?.chart as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const m = meta?.[0]?.meta as Record<string, number> | undefined;
      if (!m) return null;
      const price = m.regularMarketPrice;
      const prev  = m.previousClose ?? m.chartPreviousClose ?? 0;
      const chg   = prev > 0 ? ((price - prev) / prev) * 100 : (m.regularMarketChangePercent ?? 0);
      return { price, chg };
    };

    const results = await Promise.allSettled([
      fetch(yf('CL%3DF'),    { cache: 'no-cache' }),   // Oil
      fetch(yf('%5ETNX'),    { cache: 'no-cache' }),   // US 10Y
      fetch(yf('DX-Y.NYB'), { cache: 'no-cache' }),   // DXY
      fetch(yf('%5EGSPC'),   { cache: 'no-cache' }),   // SPX
      fetch(yf('GC%3DF'),    { cache: 'no-cache' }),   // Gold
    ]);

    const parse = async (r: PromiseSettledResult<Response>) => {
      if (r.status !== 'fulfilled' || !r.value.ok) return null;
      return extract(await r.value.json());
    };

    const [oil, bond, dxyData, spxData, goldData] = await Promise.all(results.map(parse));

    setStore(s => ({
      ...s,
      ...(oil  ? { oilPrice: oil.price }   : {}),
      ...(bond ? { bonds10y: bond.price }  : {}),
      ...(dxyData  ? { dxy:  dxyData.price,  dxyChg:  dxyData.chg  } : {}),
      ...(spxData  ? { spx:  spxData.price,  spxChg:  spxData.chg  } : {}),
      ...(goldData ? { gold: goldData.price, goldChg: goldData.chg  } : {}),
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
