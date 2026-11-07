'use client';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { LabelsContext, interpolate, useLabels, type LabelsContextValue } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';
import { adminFetch } from './_client';
import styles from './ops.module.css';
import { forceSignOut } from '@/lib/authSession';

/* WHERE THE CONSOLE'S COPY COMES FROM. The `OPS_*` defaults live in
 * lib/labelDefaults.ops.en.json, not in the public lib/labelDefaults.en.json that LabelsProvider
 * bundles for every visitor - that file used to carry all of them, model name and margin formula
 * included, in the JS of every page (#1632 item 15). Two sources now, and neither is a public chunk:
 *
 *   preAuthLabels  the sign-in form and this gate's own screens (`OPS_LOGIN_*`, `OPS_LAYOUT_*`),
 *                  picked on the server by ./layout.tsx and sent as a prop, so they are in the
 *                  /ops pages' HTML and nowhere else. Nothing in them is sensitive.
 *   consoleLabels  everything else, fetched from the admin-only /api/ops/labels in the same step as
 *                  the /api/ops/me check, so the console never renders before its copy arrives.
 *
 * They are layered over the app's label map in a nested context, so every page under /ops keeps
 * calling useLabels() unchanged. */
type LabelMap = Record<string, string>;

// Gate for /ops. The real security boundary is server-side in every /api/ops/*
// route (withAdmin/withOwner -> requireAdmin). This decides what to render:
//  - /ops/login is public (the credential form lives there); render it bare.
//  - signed out -> send them to /ops/login.
//  - signed in but not an admin -> a clear "access denied" screen (with a
//    sign-out/switch-account action), NOT a silent 404.
//  - admin -> the console, with an owner-only Team link.
// The gate keys on user?.id and resets to 'checking' on every (re)check, so
// switching accounts can never briefly show the previous session's dashboard.
export default function OpsGate({ preAuthLabels, children }: { preAuthLabels: LabelMap; children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginRoute = pathname === '/ops/login';
  const { user, loading } = useAuth();
  const router = useRouter();
  const parentLabels = useLabels();
  const [consoleLabels, setConsoleLabels] = useState<LabelMap>({});
  const labels = useMemo<LabelsContextValue>(() => {
    const own: LabelMap = { ...preAuthLabels, ...consoleLabels };
    return {
      ...parentLabels,
      t: (key: LabelKey, vars?: Record<string, string | number>) =>
        Object.prototype.hasOwnProperty.call(own, key) ? interpolate(own[key], vars) : parentLabels.t(key, vars),
    };
  }, [parentLabels, preAuthLabels, consoleLabels]);
  const { t } = labels;
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking');
  const [role, setRole] = useState<'owner' | 'staff' | null>(null);
  // #1149: forceSignOut's network call can be slow, not just fail - without
  // this both sign-out buttons gave no indication anything was happening.
  const [signingOut, setSigningOut] = useState(false);

  // Depend on the id, not the user object. Supabase hands back a new user
  // object on every token refresh even when it is the same person, so keying
  // this admin check on the object would re-run it on a timer for no reason.
  // The id is what actually decides the answer. Referencing userId rather than
  // user inside the effect makes that dependency honest instead of omitted.
  const userId = user?.id;

  useEffect(() => {
    if (isLoginRoute) return;
    if (loading) return;
    if (!userId) { router.replace('/ops/login'); return; }
    // Reset on every run (incl. account switch) so a stale 'ok' from a prior
    // session can never render the dashboard for the new user.
    setState('checking');
    setRole(null);
    setConsoleLabels({});
    let alive = true;
    (async () => {
      /* Both at once. /api/ops/labels is admin-gated as well, so a non-admin gets a 403 there and
         nothing more, and an admin does not wait a second round trip for the console's copy. A
         labels failure never blocks the gate: the console then shows raw keys, legible and fixed
         by a reload, rather than an admin locked out of the kill switches. */
      const [res, labelsRes] = await Promise.all([
        adminFetch('/api/ops/me'),
        adminFetch('/api/ops/labels').catch(() => null),
      ]);
      if (!alive) return;
      if (res && res.ok) {
        const j = await res.json().catch(() => ({}));
        const fetched: unknown = labelsRes && labelsRes.ok ? await labelsRes.json().catch(() => null) : null;
        if (!alive) return;
        if (fetched && typeof fetched === 'object' && !Array.isArray(fetched)) setConsoleLabels(fetched as LabelMap);
        setRole(j.role === 'owner' ? 'owner' : 'staff');
        setState('ok');
      } else {
        setState('denied');
      }
    })();
    return () => { alive = false; };
  }, [userId, loading, isLoginRoute, router]);

  async function signOutAndSwitch() {
    if (signingOut) return;
    setSigningOut(true);
    // forceSignOut, not sb.auth.signOut directly: a failed logout request used
    // to leave the session in localStorage, so this "sign out and switch
    // account" landed back on a console still authenticated as the old user
    // (#304). Hard navigation for the same reason - router.replace keeps the
    // React tree, and the gate above would re-admit a session that survived.
    // forceSignOut is itself time-bounded (#1149), so this await settles
    // even if the network call never answers.
    await forceSignOut(getSupabase());
    window.location.assign('/ops/login');
  }

  // Public login route: render the form with no gate and no console chrome.
  if (isLoginRoute) return <LabelsContext.Provider value={labels}>{children}</LabelsContext.Provider>;

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
            <button className={styles.pagerBtn} disabled={signingOut} onClick={signOutAndSwitch}>
              {signingOut ? <span className="login-spinner" /> : t('OPS_LAYOUT_SIGN_OUT_SWITCH')}
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
          <button className={styles.navBtn} disabled={signingOut} onClick={signOutAndSwitch}>
            {signingOut ? <span className="login-spinner" /> : t('OPS_LAYOUT_NAV_SIGN_OUT')}
          </button>
          <Link href="/">{t('OPS_LAYOUT_BACK_TO_APP')}</Link>
        </nav>
      </header>
      <main><LabelsContext.Provider value={labels}>{children}</LabelsContext.Provider></main>
    </div>
  );
}
