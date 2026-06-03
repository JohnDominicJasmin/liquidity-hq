'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const coin     = (coinProp ?? store.selectedCoin) as string;
  const interval = TF_TO_TV[tf ?? '15m'] ?? '15';
  const binanceSym = BINANCE_SYMS[coin] as string | undefined;
  const bybitSym   = BYBIT_SYMS[coin]   as string | undefined;

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

  /* ── Fullscreen toggle ── */
  const toggleFullscreen = useCallback(async () => {
    if (!wrapRef.current) return;
    if (!document.fullscreenElement) {
      await wrapRef.current.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  return (
    <div className="gsc-wrap" ref={wrapRef}>
      <div className="gsc-header">
        <div className="gsc-title">
          <span>{coin.toUpperCase()} / USDT</span>
        </div>
        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          style={{
            background: 'none', border: '0.5px solid var(--bdr2)', borderRadius: 6,
            color: 'var(--txt3)', cursor: 'pointer', padding: '3px 8px',
            fontSize: 13, lineHeight: 1, transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => { (e.target as HTMLElement).style.color = 'var(--txt)'; (e.target as HTMLElement).style.borderColor = 'var(--bdr2)'; }}
          onMouseLeave={e => { (e.target as HTMLElement).style.color = 'var(--txt3)'; }}
        >
          {isFullscreen ? '⊡' : '⤢'}
        </button>
      </div>
      <div className="gsc-tv-wrap">
        <iframe key={`${coin}-${theme}-${interval}`} src={tvSrc} className="gsc-tv-frame" frameBorder="0" allowFullScreen />
      </div>
    </div>
  );
}
