'use client';
import { safeNextPath } from '@/lib/safeNext';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { friendlyAuthError } from '@/lib/authErrors';
import LoadingState from '@/components/LoadingState';

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    const code = params.get('code');
    // Implicit-flow errors (magic-link redemption, Google OAuth) land in the
    // URL hash fragment, not the query string - useSearchParams() only ever
    // sees the query, so a ban rejection on those two paths was silently
    // swallowed here (falls into the `else` below, redirects with no session
    // and no explanation). Check both; query wins if somehow both are set.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const error = params.get('error_description') ?? params.get('error')
      ?? hashParams.get('error_description') ?? hashParams.get('error');

    // Honor the ?next= the login page threaded through - same-origin paths
    // only, so the callback can't be turned into an open redirect. Shared with
    // the login page (lib/safeNext.ts) because both had the same backslash
    // hole: `/\evil.com` passed a startsWith('/') check and the browser then
    // resolved it off-origin.
    const dest = safeNextPath(params.get('next'), '/arena');

    if (error) { setErrMsg(friendlyAuthError(error)); return; }

    const sb = getSupabase();
    if (!sb) { router.push('/'); return; }

    if (code) {
      // PKCE flow: exchange auth code for session
      sb.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) setErrMsg(friendlyAuthError(error.message));
        else router.push(dest);
      });
    } else {
      // Implicit flow: Supabase picks up token from URL hash automatically
      router.push(dest);
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  if (errMsg) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="login-logo">Liquidity<span>HQ</span></div>
          <div className="login-error" style={{ marginTop: 24, textAlign: 'left' }}>
            Sign-in failed: {errMsg}
          </div>
          <a href="/login" className="login-back-btn" style={{ display: 'block', textAlign: 'center', marginTop: 16 }}>
            Try again
          </a>
        </div>
      </div>
    );
  }

  return <LoadingState message="Signing you in…" fullPage />;
}

// useSearchParams requires a Suspense boundary in Next.js App Router
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<LoadingState message="Loading…" fullPage />}>
      <CallbackInner />
    </Suspense>
  );
}
