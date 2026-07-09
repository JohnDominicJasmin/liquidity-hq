'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const DISCLOSURES = [
  {
    label: 'Educational Use',
    text: 'All content — signals, scores, alerts, and AI commentary — is for informational purposes only. Nothing constitutes a recommendation to buy, sell, or hold any asset.',
  },
  {
    label: 'Trading Risk',
    text: 'Crypto trading involves substantial risk. Prices are volatile, leverage magnifies losses, and most active traders lose money. Only trade with money you can afford to lose.',
  },
  {
    label: 'No Investment Advice',
    text: 'We are not a registered investment advisor. You are solely responsible for your own trading decisions. Consult a licensed professional before making any investment decision.',
  },
  {
    label: 'AI Analysis',
    text: 'LiquidityAI is powered by xAI Grok. AI output can be incomplete, outdated, or wrong — never use it as your sole basis for a trade. Always verify against the raw data shown.',
  },
  {
    label: 'Data Sources',
    text: 'Price, funding, and OI data sourced from Binance, Bybit, Finnhub, and Alternative.me. We do not guarantee accuracy, completeness, or availability of third-party feeds.',
  },
  {
    label: 'No Affiliation',
    text: 'LiquidityHQ is not affiliated with, endorsed by, or sponsored by any exchange or data provider referenced here. All trademarks belong to their respective owners.',
  },
];

export default function PlatformFooter() {
  const pathname = usePathname();
  if (pathname === '/' || pathname === '/login') return null;

  return (
    <footer className="pf-footer">

      {/* Top row — brand + nav */}
      <div className="pf-footer-top">
        <div className="pf-footer-brand">
          <span className="pf-footer-logo">LiquidityHQ</span>
          <span className="pf-footer-tagline">Market intelligence for active crypto traders</span>
        </div>
        <nav className="pf-footer-nav">
          <Link href="/about" className="pf-footer-link">About</Link>
          <Link href="/terms" className="pf-footer-link">Terms of Use</Link>
          <Link href="/privacy" className="pf-footer-link">Privacy Policy</Link>
          <Link href="/disclaimer" className="pf-footer-link">Full Disclaimer</Link>
        </nav>
      </div>

      {/* Risk disclosure section label */}
      <div className="pf-footer-divider">
        <span className="pf-footer-divider-label">RISK DISCLOSURE</span>
        <div className="pf-footer-divider-line" />
      </div>

      {/* Disclosure grid */}
      <div className="pf-footer-grid">
        {DISCLOSURES.map(item => (
          <div key={item.label} className="pf-footer-item">
            <div className="pf-footer-item-label">{item.label}</div>
            <p className="pf-footer-item-text">{item.text}</p>
          </div>
        ))}
      </div>

      {/* Acknowledgment + copyright */}
      <div className="pf-footer-bottom">
        <span>© {new Date().getFullYear()} LiquidityHQ. All rights reserved.</span>
        <span className="pf-footer-bottom-note">
          By using LiquidityHQ, you acknowledge that you understand and agree to our{' '}
          <Link href="/disclaimer" className="pf-footer-bottom-link">Disclaimer</Link>,{' '}
          <Link href="/terms" className="pf-footer-bottom-link">Terms of Use</Link>, and{' '}
          <Link href="/privacy" className="pf-footer-bottom-link">Privacy Policy</Link>.
        </span>
      </div>

    </footer>
  );
}
