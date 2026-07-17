'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    const code  = params.get('code');
    const error = params.get('error_description') ?? params.get('error');

    // Honor the ?next= the login page threaded through - same-origin paths
    // only, so the callback can't be turned into an open redirect.
    const rawNext = params.get('next');
    const dest = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/arena';

    if (error) { setErrMsg(error); return; }

    const sb = getSupabase();
    if (!sb) { router.push('/'); return; }

    if (code) {
      // PKCE flow: exchange auth code for session
      sb.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) setErrMsg(error.message);
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

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ alignItems: 'center' }}>
        <div className="login-logo">Liquidity<span>HQ</span></div>
        <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div className="login-spinner-lg" />
          <div style={{ fontSize: 'var(--fs-body)', color: 'var(--txt2)' }}>Signing you in…</div>
        </div>
      </div>
    </div>
  );
}

// useSearchParams requires a Suspense boundary in Next.js App Router
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="login-wrap">
        <div className="login-card" style={{ alignItems: 'center' }}>
          <div className="login-logo">Liquidity<span>HQ</span></div>
          <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div className="login-spinner-lg" />
            <div style={{ fontSize: 'var(--fs-body)', color: 'var(--txt2)' }}>Loading…</div>
          </div>
        </div>
      </div>
    }>
      <CallbackInner />
    </Suspense>
  );
}
