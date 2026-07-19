'use client';
import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { adminFetch } from './_client';
import styles from './admin.module.css';

// Client-side gate for UX only. The real security boundary is server-side in
// every /api/admin/* route (withAdmin -> requireAdmin). This just avoids flashing
// the panel to non-admins. On denial it renders a 404 (notFound) rather than an
// "unauthorized" screen, so the panel doesn't announce that it exists.
// NOTE: this is cosmetic hiding - the page bundle still ships. A true edge-level
// 404 would need cookie-based sessions (Next 16 Proxy can't read the localStorage
// token on a page navigation, and Next explicitly says not to use it for authz).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking');

  useEffect(() => {
    if (loading) return;
    if (!user) { setState('denied'); return; }
    let alive = true;
    (async () => {
      const res = await adminFetch('/api/admin/me');
      if (alive) setState(res && res.ok ? 'ok' : 'denied');
    })();
    return () => { alive = false; };
  }, [user, loading]);

  if (state === 'denied') notFound();

  if (state !== 'ok') {
    return <div className={styles.gate}>Checking access…</div>;
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.brand}>LiquidityHQ <b>Admin</b></span>
        <nav className={styles.nav}>
          <Link href="/admin">Overview</Link>
          <Link href="/">← Back to app</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
