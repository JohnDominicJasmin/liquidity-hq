'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function PlatformFooter() {
  const pathname = usePathname();
  if (pathname === '/' || pathname === '/login') return null;

  return (
    <footer className="pf-footer">
      <div className="pf-footer-top">
        <span className="pf-footer-copy">
          © {new Date().getFullYear()} LiquidityHQ. All rights reserved.
        </span>
        <Link href="/about" className="pf-footer-link">About</Link>
      </div>

      <div className="pf-footer-disclaimer">
        <strong>Educational use only — not financial advice.</strong> LiquidityHQ provides market data, charting tools, and AI-generated analysis for informational purposes only. Nothing on this platform — including signals, scores, alerts, or AI commentary — constitutes a recommendation to buy, sell, or hold any asset. Trading cryptocurrency involves substantial risk; prices are volatile, leverage magnifies losses, and most active traders lose money. Only trade with money you can afford to lose. Squeeze scores, EMA setups, and backtest results describe historical conditions only — they do not predict future price movement. We are not a registered investment advisor. You are solely responsible for your own trading decisions. AI analysis (Grok) can be incomplete or wrong — always verify against the raw data. Price and funding data sourced from Binance, Bybit, Finnhub, and Alternative.me; we do not guarantee accuracy or availability. LiquidityHQ is not affiliated with any exchange or data provider referenced on this platform.
      </div>
    </footer>
  );
}
