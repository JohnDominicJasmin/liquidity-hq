'use client';
import { useState, useEffect } from 'react';
import { useMarket, BINANCE_SYMS } from '@/lib/marketStore';

const SAVED_KEY = 'lhq-tv-indicators-v1';

// TradingView built-in study IDs
const INDICATORS = [
  { id: 'RSI@tv-basicstudies',            label: 'RSI'   },
  { id: 'MAExp@tv-basicstudies',          label: 'EMA'   },
  { id: 'MACD@tv-basicstudies',           label: 'MACD'  },
  { id: 'BB@tv-basicstudies',             label: 'BB'    },
  { id: 'VWAP@tv-basicstudies',           label: 'VWAP'  },
  { id: 'VolumeDelta@tv-volumebyprice',   label: 'CVD'   },
];

const DEFAULT_IND = ['RSI@tv-basicstudies', 'MAExp@tv-basicstudies'];

export default function GrokSignalChart({ coin: coinProp }: { coin?: string }) {
  const { store } = useMarket();
  const coin = (coinProp ?? store.selectedCoin) as string;

  // Load saved indicators from localStorage after hydration
  const [indicators, setIndicators] = useState<string[]>(DEFAULT_IND);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_KEY);
      if (saved) setIndicators(JSON.parse(saved));
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  const toggle = (id: string) => {
    setIndicators(prev => {
      const next = prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id];
      try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const sym   = BINANCE_SYMS[coin] as string | undefined;
  const tvSym = sym ? `BINANCE:${sym}` : 'BINANCE:BTCUSDT';

  // Build TV URL — studies param persists selected indicators
  const studiesParam = indicators.length > 0
    ? '&studies=' + encodeURIComponent(indicators.join(','))
    : '';
  const tvSrc = `https://www.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tvSym)}&interval=15&theme=dark&style=1&locale=en&hide_top_toolbar=0&save_image=0&allow_symbol_change=0&timezone=${encodeURIComponent('Asia/Manila')}${studiesParam}`;

  // Reload iframe when coin or indicator selection changes
  const iframeKey = hydrated ? `${coin}-${indicators.sort().join(',')}` : coin;

  return (
    <div className="gsc-wrap">
      <div className="gsc-header">
        <div className="gsc-title">
          <span>{coin.toUpperCase()} / USDT</span>
        </div>
        {/* Persistent indicator toggles */}
        <div className="gsc-controls" style={{ gap: 4 }}>
          {INDICATORS.map(ind => (
            <button
              key={ind.id}
              className={`gsc-tf-btn${indicators.includes(ind.id) ? ' on' : ''}`}
              onClick={() => toggle(ind.id)}
              style={{ fontSize: 10, padding: '2px 7px' }}
              title={`Toggle ${ind.label}`}
            >
              {ind.label}
            </button>
          ))}
        </div>
      </div>
      <div className="gsc-tv-wrap">
        <iframe key={iframeKey} src={tvSrc} className="gsc-tv-frame" frameBorder="0" allowFullScreen />
      </div>
    </div>
  );
}
