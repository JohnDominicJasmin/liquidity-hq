'use client';
import Link from 'next/link';
import { useAuth } from './AuthProvider';

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

  if (loading) return null;

  if (!user) {
    return (
      <div className="auth-gate">
        
        <div className="auth-gate-title">{title ?? 'Sign in required'}</div>
        <div className="auth-gate-desc">
          {desc ?? 'Create a free account to access this feature.'}
        </div>
        <Link href="/login" className="auth-gate-btn">Sign In</Link>
      </div>
    );
  }

  return <>{children}</>;
}
