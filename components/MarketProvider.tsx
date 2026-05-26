'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MarketContext, MarketStore, defaultStore, CoinId,
  BINANCE_SYMS, BYBIT_SYMS, classifyFunding,
} from '@/lib/marketStore';

const WS_URLS = [
  'wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/ethusdt@ticker/solusdt@ticker/xrpusdt@ticker/bnbusdt@ticker/nearusdt@ticker/zecusdt@ticker',
  'wss://stream.binance.com/stream?streams=btcusdt@ticker/ethusdt@ticker/solusdt@ticker/xrpusdt@ticker/bnbusdt@ticker/nearusdt@ticker/zecusdt@ticker',
];

const SYM_MAP: Record<string, CoinId> = {
  BTCUSDT: 'btc', ETHUSDT: 'eth', SOLUSDT: 'sol',
  XRPUSDT: 'xrp', BNBUSDT: 'bnb', NEARUSDT: 'near', ZECUSDT: 'zec',
};

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

  /* ── Bybit: HYPE price + funding rates + OI ── */
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
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=15m&limit=20`);
      const klines = await res.json();
      if (!Array.isArray(klines) || klines.length < 2) return;
      const vols = klines.map((k: string[]) => parseFloat(k[7]));
      const current = vols[vols.length - 2];
      const avg = vols.slice(0, -1).reduce((a, b) => a + b, 0) / (vols.length - 1);
      updateCoin(coin, { volRatio: avg > 0 ? current / avg : 1 });
    } catch { /* */ }
  }, [updateCoin]);

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

  /* ── BTC Dominance ── */
  const fetchBTCDom = useCallback(async () => {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/global');
      const d = await res.json();
      const dom = d?.data?.market_cap_percentage?.btc;
      if (dom) setStore(s => ({ ...s, btcDom: dom }));
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

    const intervals = [
      setInterval(fetchBybit, 8 * 60 * 1000),
      setInterval(fetchLSR, 5 * 60 * 1000),
      setInterval(fetchVolume, 3 * 60 * 1000),
      setInterval(fetchFNG, 24 * 60 * 60 * 1000),
      setInterval(fetchBTCDom, 5 * 60 * 1000),
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
