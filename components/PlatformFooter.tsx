'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/* Compact disclaimer bar shown on every authenticated app page (Dashboard,
   Arena, Alerts, etc.) — rendered as the last child inside .app-content in
   AppShell.tsx, so it automatically matches the page's real content width
   and responsive breakpoints instead of duplicating them here. The landing
   page ("/") has its own footer already and links to /disclaimer directly,
   so it's skipped to avoid doubling up. Full legal text lives on /disclaimer;
   this is the persistent reminder, styled like the rest of the app's card
   language (.edge-card gradient + border) rather than bare floating text. */
export default function PlatformFooter() {
  const pathname = usePathname();
  if (pathname === '/' || pathname === '/login') return null;

  return (
    <footer className="pf-footer">
      <span className="pf-footer-icon" aria-hidden="true">ⓘ</span>
      <div className="pf-footer-body">
        <span className="pf-footer-label">Disclaimer</span>
        <span className="pf-footer-text">
          Educational content only, not financial advice. Trading crypto carries substantial risk of loss.
          AI-generated analysis can be wrong.
        </span>
      </div>
      <Link href="/disclaimer" className="pf-footer-link">Full Disclaimer</Link>
    </footer>
  );
}
