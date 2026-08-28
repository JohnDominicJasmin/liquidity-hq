'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import { friendlyAuthError } from '@/lib/authErrors';
import LoadingState from '@/components/LoadingState';
import PasswordField from '@/components/PasswordField';
import { passwordMeetsPolicy } from '@/lib/passwordPolicy';
import { useLabels } from '@/lib/labels';
import { useDesignMode } from '@/components/DesignModeProvider';

// Landed on directly from the password-reset email link
// (resetPasswordForEmail's redirectTo), not routed through /auth/callback -
// a recovery link needs its own "set a new password" form, not the normal
// "sign in and go to the dashboard" handling that page does. Supabase's
// client SDK auto-detects the access_token in the URL hash (implicit flow,
// same as everywhere else in this app) and fires a PASSWORD_RECOVERY auth
// event once it's parsed - that's the signal this form is safe to show.
export default function ResetPasswordPage() {
  const mode = useDesignMode();
  const router = useRouter();
  const { t } = useLabels();
  const [ready, setReady]     = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword]               = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [done, setDone]       = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) { setInvalid(true); return; }

    // A recovery link's redirect carries type=recovery in the URL hash.
    // Without that marker there's no possibility this visit came from an
    // actual reset email - e.g. someone opened this URL directly, or a
    // prior user on a shared device left an ordinary session behind. In
    // that case getSession() below would still resolve truthy (their
    // regular session, not a recovery one), which would wrongly let this
    // form treat "already signed in" as "link verified" and skip the
    // invalid-link gate entirely.
    const isRecoveryRedirect = window.location.hash.includes('type=recovery');
    if (!isRecoveryRedirect) { setInvalid(true); return; }

    const { data: { subscription } } = sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });

    // If the hash was already parsed before this listener attached (e.g. a
    // fast reload), a recovery session may already be live - check directly
    // rather than waiting for an event that already fired. Safe here since
    // isRecoveryRedirect already confirmed this navigation came from the
    // reset email link.
    sb.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });

    // No valid recovery link within a few seconds - either it's expired,
    // already used, or this page was opened directly with nothing to act on.
    const timeout = setTimeout(() => setReady(r => { if (!r) setInvalid(true); return r; }), 4000);

    return () => { subscription.unsubscribe(); clearTimeout(timeout); };
  }, []);

  const submit = async () => {
    if (!password) return;
    if (password !== confirmPassword) { setError(t('LOGIN_PASSWORD_MISMATCH')); return; }
    if (!passwordMeetsPolicy(password)) { setError(t('LOGIN_PASSWORD_POLICY_ERROR')); return; }
    const sb = getSupabase();
    if (!sb) { setError(t('LOGIN_ERROR_SUPABASE_NOT_CONFIGURED')); return; }
    setLoading(true);
    setError('');
    const { error } = await sb.auth.updateUser({ password });
    setLoading(false);
    if (error) { setError(friendlyAuthError(error.message)); return; }
    setDone(true);
    setTimeout(() => router.push('/dashboard'), 1500);
  };

  if (invalid) {
    return (
      <div className={`login-wrap${mode === 'terminal' ? ' login-term-wrap' : ''}`}>
        <div className="login-card">
          <div className="login-logo">Liquidity<span>HQ</span></div>
          <div className="login-error" data-testid="login-error" style={{ marginTop: 16 }}>{t('RESET_PASSWORD_INVALID_LINK')}</div>
          <Link href="/forgot-password" className="login-back-btn" style={{ display: 'block', marginTop: 14 }}>
            {t('RESET_PASSWORD_REQUEST_NEW_LINK')}
          </Link>
        </div>
      </div>
    );
  }

  if (!ready) return <LoadingState message={t('LOGIN_LOADING')} fullPage />;

  return (
    <div className={`login-wrap${mode === 'terminal' ? ' login-term-wrap' : ''}`}>
      <div className="login-card">
        <div className="login-logo">Liquidity<span>HQ</span></div>
        <p className="login-sub">{t('RESET_PASSWORD_SUBTITLE')}</p>

        {done ? (
          <div className="login-success">
            <div className="login-success-icon">✅</div>
            <div className="login-success-title">{t('RESET_PASSWORD_SUCCESS_TITLE')}</div>
            <div className="login-success-desc">{t('RESET_PASSWORD_SUCCESS_DESC')}</div>
          </div>
        ) : (
          <>
            <div className="login-email-wrap">
              <PasswordField
                label={t('LOGIN_PASSWORD_NEW_PLACEHOLDER')}
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                showRules
              />
              <PasswordField
                label={t('LOGIN_PASSWORD_CONFIRM_PLACEHOLDER')}
                value={confirmPassword}
                onChange={setConfirmPassword}
                onEnter={submit}
                autoComplete="new-password"
              />
              <button
                className="login-email-btn"
                onClick={submit}
                disabled={loading || !password || !confirmPassword}
              >
                {loading ? <span className="login-spinner" /> : t('RESET_PASSWORD_SUBMIT_BUTTON')}
              </button>
            </div>

            {error && <div className="login-error" data-testid="login-error">{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}
