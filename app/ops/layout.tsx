'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { useLabels } from '@/lib/labels';
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
  const { t } = useLabels();
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
          <div className={styles.denyTitle}>{t('OPS_LAYOUT_DENY_TITLE')}</div>
          <p className={styles.denyText}>
            {user?.email
              ? <>{t('OPS_LAYOUT_DENY_EMAIL_PREFIX')} <b>{user.email}</b>{t('OPS_LAYOUT_DENY_EMAIL_SUFFIX')}</>
              : <>{t('OPS_LAYOUT_DENY_NO_EMAIL')}</>}
            {' '}{t('OPS_LAYOUT_DENY_HINT')}
          </p>
          <div className={styles.denyActions}>
            <button className={styles.pagerBtn} onClick={signOutAndSwitch}>
              {t('OPS_LAYOUT_SIGN_OUT_SWITCH')}
            </button>
            <Link href="/" className={styles.pagerBtn}>{t('OPS_LAYOUT_BACK_TO_APP')}</Link>
          </div>
        </div>
      </div>
    );
  }

  if (state !== 'ok') return <div className={styles.gate}>{t('OPS_LAYOUT_CHECKING_ACCESS')}</div>;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.brand}>LiquidityHQ <b>Ops</b></span>
        <nav className={styles.nav}>
          <Link href="/ops">{t('OPS_LAYOUT_NAV_OVERVIEW')}</Link>
          <Link href="/ops/users">{t('OPS_LAYOUT_NAV_USERS')}</Link>
          {role === 'owner' && <Link href="/ops/team">{t('OPS_LAYOUT_NAV_TEAM')}</Link>}
          {role === 'owner' && <Link href="/ops/config">{t('OPS_LAYOUT_NAV_CONFIG')}</Link>}
          <button className={styles.navBtn} onClick={signOutAndSwitch}>{t('OPS_LAYOUT_NAV_SIGN_OUT')}</button>
          <Link href="/">{t('OPS_LAYOUT_BACK_TO_APP')}</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
