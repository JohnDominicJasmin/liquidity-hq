'use client';
import { useEffect, useState } from 'react';
import { notFound, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { adminFetch } from './_client';
import styles from './ops.module.css';

// Gate for /ops. The real security boundary is server-side in every /api/ops/*
// route (withAdmin/withOwner -> requireAdmin). This decides what to render:
//  - /ops/login is public (the credential form lives there); render it bare.
//  - signed out -> send them to /ops/login.
//  - signed in but not an admin -> 404 (regular users don't learn /ops exists).
//  - admin -> the console, with an owner-only Team link.
export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginRoute = pathname === '/ops/login';
  const { user, loading } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking');
  const [role, setRole] = useState<'owner' | 'staff' | null>(null);

  useEffect(() => {
    if (isLoginRoute) return;
    if (loading) return;
    if (!user) { router.replace('/ops/login'); return; }
    let alive = true;
    (async () => {
      const res = await adminFetch('/api/ops/me');
      if (!alive) return;
      if (res && res.ok) {
        const j = await res.json().catch(() => ({}));
        setRole(j.role === 'owner' ? 'owner' : 'staff');
        setState('ok');
      } else {
        setState('denied');
      }
    })();
    return () => { alive = false; };
  }, [user, loading, isLoginRoute, router]);

  // Public login route: render the form with no gate and no console chrome.
  if (isLoginRoute) return <>{children}</>;

  if (state === 'denied') notFound();
  if (state !== 'ok') return <div className={styles.gate}>Checking access…</div>;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.brand}>LiquidityHQ <b>Ops</b></span>
        <nav className={styles.nav}>
          <Link href="/ops">Overview</Link>
          <Link href="/ops/users">Users</Link>
          {role === 'owner' && <Link href="/ops/team">Team</Link>}
          <Link href="/">← Back to app</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
