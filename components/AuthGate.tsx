'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth, BAN_NOTICE_KEY } from './AuthProvider';
import { useLabels } from '@/lib/labels';

interface Props {
  children: React.ReactNode;
  title?: string;
  desc?: string;
}

/**
 * Shows a sign-in prompt in place of children when the user is not authenticated.
 * Renders nothing while auth state is loading (avoids flash of gate for signed-in users).
 */
export default function AuthGate({ children, title, desc }: Props) {
  const { user, loading } = useAuth();
  const { t } = useLabels();
  const [banned, setBanned] = useState(false);

  // One-time read: the flag is set right before AuthProvider's realtime
  // ban-kill signs this tab out, so it's only ever present the instant that
  // fires - clearing it means a normal future sign-out doesn't misreport as
  // a ban.
  useEffect(() => {
    if (sessionStorage.getItem(BAN_NOTICE_KEY)) {
      setBanned(true);
      sessionStorage.removeItem(BAN_NOTICE_KEY);
    }
  }, []);

  if (loading) return null;

  if (!user) {
    return (
      <div className="auth-gate">
        <div className="auth-gate-title">{title ?? t('AUTH_GATE_TITLE')}</div>
        <div className="auth-gate-desc">
          {banned ? t('AUTH_GATE_BANNED_DESC') : (desc ?? t('AUTH_GATE_DESC'))}
        </div>
        <Link href="/login" className="auth-gate-btn">{t('AUTH_GATE_SIGN_IN_BUTTON')}</Link>
      </div>
    );
  }

  return <>{children}</>;
}
