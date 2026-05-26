'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MarketContext, MarketStore, defaultStore, CoinId,
  BINANCE_SYMS, BYBIT_SYMS,
} from '@/lib/marketStore';

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

  /* ── Bybit: HYPE price + funding rates + OI + perpPrice for all ── */
  const fetchBybit = useCallback(async () => {
    const coins = Object.keys(BYBIT_SYMS);
    await Promise.allSettled(coins.map(async (coin) => {
      const sym = BYBIT_SYMS[coin];
      try {
        const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${sym}`);
        const d = await res.json();
        const item = d.result?.list?.[0];
        if (!item) return;
        const patch: Partial<MarketStore['coins'][CoinId]> = {
          fundingRate: parseFloat(item.fundingRate || '0'),
          oi: parseFloat(item.openInterestValue || '0'),
          perpPrice: parseFloat(item.lastPrice || '0'),
        };
        if (coin === 'hype') {
          patch.price = parseFloat(item.lastPrice || '0');
          patch.change = parseFloat(item.price24hPcnt || '0') * 100;
          patch.high = parseFloat(item.highPrice24h || '0');
          patch.low = parseFloat(item.lowPrice24h || '0');
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
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=15m&limit=22`);
      const klines = await res.json();
      if (!Array.isArray(klines) || klines.length < 15) return;
      const closes = klines.map((k: string[]) => parseFloat(k[4]));
      const vols   = klines.map((k: string[]) => parseFloat(k[7]));

      /* Volume ratio */
      const current = vols[vols.length - 2];
      const avg = vols.slice(0, -1).reduce((a: number, b: number) => a + b, 0) / (vols.length - 1);

      /* MA20 */
      const ma20Slice = closes.slice(-20);
      const ma20 = ma20Slice.reduce((a: number, b: number) => a + b, 0) / ma20Slice.length;

      /* RSI14 */
      const rsi14 = computeRSI14(closes);

      updateCoin(coin, { volRatio: avg > 0 ? current / avg : 1, ma20, rsi14 });
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

  /* ── CVD (BTC + ETH only) ── */
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
          let buyVol = 0;
          let sellVol = 0;
          trades.forEach((t: { m: boolean; q: string }) => {
            const qty = parseFloat(t.q);
            if (t.m) {
              sellVol += qty; // maker is buyer → taker is seller
            } else {
              buyVol += qty; // maker is seller → taker is buyer
            }
          });
          updateCoin(coin, { cvd: buyVol - sellVol });
        } catch { /* */ }
      })
    );
  }, [updateCoin]);

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

  /* ── Oil + Bond yields ── */
  const fetchMacro = useCallback(async () => {
    const proxy = (url: string) => 'https://corsproxy.io/?' + encodeURIComponent(url);
    try {
      const [oilRes, bondRes] = await Promise.allSettled([
        fetch(proxy('https://query1.finance.yahoo.com/v8/finance/chart/CL=F?interval=1d&range=2d'), { cache: 'no-cache' }),
        fetch(proxy('https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=2d'), { cache: 'no-cache' }),
      ]);
      if (oilRes.status === 'fulfilled' && oilRes.value.ok) {
        const d = await oilRes.value.json();
        const p = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (p) setStore(s => ({ ...s, oilPrice: parseFloat(p) }));
      }
      if (bondRes.status === 'fulfilled' && bondRes.value.ok) {
        const d = await bondRes.value.json();
        const p = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (p) setStore(s => ({ ...s, bonds10y: parseFloat(p) }));
      }
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

    const intervals = [
      setInterval(fetchBybit,          8  * 60 * 1000),
      setInterval(fetchLSR,            5  * 60 * 1000),
      setInterval(fetchVolume,         3  * 60 * 1000),
      setInterval(fetchFNG,           24  * 60 * 60 * 1000),
      setInterval(fetchBTCDom,         5  * 60 * 1000),
      setInterval(fetchMacro,         10  * 60 * 1000),
      setInterval(fetchETF,           30  * 60 * 1000),
      setInterval(fetchMultiTFRSI,    15  * 60 * 1000),
      setInterval(fetchCVD,            5  * 60 * 1000),
      setInterval(fetchOrderBook,      2  * 60 * 1000),
      setInterval(fetchDeribitOptions, 15  * 60 * 1000),
      setInterval(fetchStablecoinFlows, 30 * 60 * 1000),
      setInterval(fetchCoinglassData,  15  * 60 * 1000),
      setInterval(fetchGoogleTrends,   60  * 60 * 1000),
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
