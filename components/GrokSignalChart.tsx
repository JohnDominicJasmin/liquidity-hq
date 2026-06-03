'use client';
import { useState, useEffect } from 'react';
import { useMarket, BINANCE_SYMS, BYBIT_SYMS } from '@/lib/marketStore';

function useAppTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    // Read initial value
    const initial = document.documentElement.getAttribute('data-theme');
    if (initial === 'light') setTheme('light');

    // Watch for changes made by the theme toggle in NavDrawer
    const observer = new MutationObserver(() => {
      const t = document.documentElement.getAttribute('data-theme');
      setTheme(t === 'light' ? 'light' : 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

// Map our TF labels → TradingView interval codes
const TF_TO_TV: Record<string, string> = {
  '15m': '15',
  '1h':  '60',
  '4h':  '240',
  '1d':  'D',
};

export default function GrokSignalChart({ coin: coinProp, tf }: { coin?: string; tf?: string }) {
  const { store } = useMarket();
  const theme = useAppTheme();

  const coin     = (coinProp ?? store.selectedCoin) as string;
  const interval = TF_TO_TV[tf ?? '15m'] ?? '15';
  const binanceSym = BINANCE_SYMS[coin] as string | undefined;
  const bybitSym   = BYBIT_SYMS[coin]   as string | undefined;

  // Prefer Binance symbol for TradingView; fall back to Bybit exchange label
  const tvSym = binanceSym
    ? `BINANCE:${binanceSym}`
    : bybitSym
    ? `BYBIT:${bybitSym}`
    : 'BINANCE:BTCUSDT';

  const tvSrc = [
    'https://www.tradingview.com/widgetembed/',
    `?symbol=${encodeURIComponent(tvSym)}`,
    `&interval=${interval}`,
    `&theme=${theme}`,
    `&style=1`,
    `&locale=en`,
    `&hide_top_toolbar=0`,
    `&save_image=0`,
    `&allow_symbol_change=0`,
    `&timezone=${encodeURIComponent('Asia/Manila')}`,
  ].join('');

  return (
    <div className="gsc-wrap">
      <div className="gsc-header">
        <div className="gsc-title">
          <span>{coin.toUpperCase()} / USDT</span>
        </div>
      </div>
      <div className="gsc-tv-wrap">
        {/* key includes theme + interval so iframe reloads when either changes */}
        <iframe key={`${coin}-${theme}-${interval}`} src={tvSrc} className="gsc-tv-frame" frameBorder="0" allowFullScreen />
      </div>
    </div>
  );
}
