'use client';
import Link from 'next/link';
import { useAuth } from './AuthProvider';
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

  if (loading) return null;

  if (!user) {
    return (
      <div className="auth-gate">
        <div className="auth-gate-title">{title ?? t('AUTH_GATE_TITLE')}</div>
        <div className="auth-gate-desc">
          {desc ?? t('AUTH_GATE_DESC')}
        </div>
        <Link href="/login" className="auth-gate-btn">{t('AUTH_GATE_SIGN_IN_BUTTON')}</Link>
      </div>
    );
  }

  return <>{children}</>;
}
