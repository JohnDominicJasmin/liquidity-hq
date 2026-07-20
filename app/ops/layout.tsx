'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { adminFetch } from './_client';
import styles from './ops.module.css';

// Gate for /ops. The real security boundary is server-side in every /api/ops/*
// route (withAdmin/withOwner -> requireAdmin). This decides what to render:
//  - /ops/login is public (the credential form lives there); render it bare.
//  - signed out -> send them to /ops/login.
//  - signed in but not an admin -> a clear "access denied" screen (with a
//    sign-out/switch-account action), NOT a silent 404.
//  - admin -> the console, with an owner-only Team link.
// The gate keys on user?.id and resets to 'checking' on every (re)check, so
// switching accounts can never briefly show the previous session's dashboard.
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
    // Reset on every run (incl. account switch) so a stale 'ok' from a prior
    // session can never render the dashboard for the new user.
    setState('checking');
    setRole(null);
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
  }, [user?.id, loading, isLoginRoute, router]);

  async function signOutAndSwitch() {
    await getSupabase()?.auth.signOut();
    router.replace('/ops/login');
  }

  // Public login route: render the form with no gate and no console chrome.
  if (isLoginRoute) return <>{children}</>;

  if (state === 'denied') {
    return (
      <div className={styles.denyWrap}>
        <div className={styles.denyCard}>
          <div className={styles.denyTitle}>Access denied</div>
          <p className={styles.denyText}>
            {user?.email
              ? <>You are signed in as <b>{user.email}</b>, which is not an admin account.</>
              : <>This account does not have admin access.</>}
            {' '}Ask an owner to grant you access from the Team page.
          </p>
          <div className={styles.denyActions}>
            <button className={styles.pagerBtn} onClick={signOutAndSwitch}>
              Sign out &amp; switch account
            </button>
            <Link href="/" className={styles.pagerBtn}>← Back to app</Link>
          </div>
        </div>
      </div>
    );
  }

  if (state !== 'ok') return <div className={styles.gate}>Checking access…</div>;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.brand}>LiquidityHQ <b>Ops</b></span>
        <nav className={styles.nav}>
          <Link href="/ops">Overview</Link>
          <Link href="/ops/users">Users</Link>
          {role === 'owner' && <Link href="/ops/team">Team</Link>}
          <button className={styles.navBtn} onClick={signOutAndSwitch}>Sign out</button>
          <Link href="/">← Back to app</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
