'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/* Compact disclaimer bar shown on every authenticated app page (Dashboard,
   Arena, Alerts, etc.) — the landing page ("/") has its own footer already
   and links to /disclaimer directly, so it's skipped here to avoid doubling
   up. Full legal text lives on /disclaimer; this is the persistent reminder. */
export default function PlatformFooter() {
  const pathname = usePathname();
  if (pathname === '/' || pathname === '/login') return null;

  return (
    <footer className="pf-footer">
      <span className="pf-footer-text">
        Educational content only, not financial advice. Trading crypto carries substantial risk of loss.
        AI-generated analysis can be wrong.
      </span>
      <Link href="/disclaimer" className="pf-footer-link">Full Disclaimer</Link>
    </footer>
  );
}
