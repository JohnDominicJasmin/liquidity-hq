'use client';
import { useMarket, BINANCE_SYMS } from '@/lib/marketStore';

export default function GrokSignalChart({ coin: coinProp }: { coin?: string }) {
  const { store } = useMarket();
  const coin   = (coinProp ?? store.selectedCoin) as string;
  const sym    = BINANCE_SYMS[coin] as string | undefined;
  const tvSym  = sym ? `BINANCE:${sym}` : 'BINANCE:BTCUSDT';
  const tvSrc  = `https://www.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tvSym)}&interval=15&theme=dark&style=1&locale=en&hide_top_toolbar=0&save_image=0&allow_symbol_change=0&timezone=${encodeURIComponent('Asia/Manila')}`;

  return (
    <div className="gsc-wrap">
      <div className="gsc-header">
        <div className="gsc-title">
          <span>{coin.toUpperCase()} / USDT</span>
        </div>
      </div>
      <div className="gsc-tv-wrap">
        <iframe key={coin} src={tvSrc} className="gsc-tv-frame" frameBorder="0" allowFullScreen />
      </div>
    </div>
  );
}
