'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function PlatformFooter() {
  const pathname = usePathname();
  if (pathname === '/' || pathname === '/login') return null;

  return (
    <footer className="pf-footer">
      <span className="pf-footer-copy">
        © {new Date().getFullYear()} LiquidityHQ. All rights reserved. For educational use only — not financial advice.
      </span>
      <span className="pf-footer-links">
        <Link href="/disclaimer" className="pf-footer-link">Disclaimer</Link>
        <Link href="/about" className="pf-footer-link">About</Link>
      </span>
    </footer>
  );
}
