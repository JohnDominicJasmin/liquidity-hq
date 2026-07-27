'use client';
import { useState, useRef } from 'react';
import Link from 'next/link';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { getSupabase } from '@/lib/supabase';
import { friendlyAuthError } from '@/lib/authErrors';
import { useLabels } from '@/lib/labels';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

export default function ForgotPasswordPage() {
  const { t } = useLabels();
  const [email, setEmail]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [sent, setSent]           = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const turnstileRef = useRef<TurnstileInstance>(null);

  const submit = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setError(t('LOGIN_ERROR_COMPLETE_VERIFICATION'));
      return;
    }
    const sb = getSupabase();
    if (!sb) { setError(t('LOGIN_ERROR_SUPABASE_NOT_CONFIGURED')); return; }
    setLoading(true);
    setError('');
    const { error } = await sb.auth.resetPasswordForEmail(trimmed, {
      redirectTo: `${window.location.origin}/reset-password`,
      ...(captchaToken ? { captchaToken } : {}),
    });
    setLoading(false);
    turnstileRef.current?.reset();
    setCaptchaToken('');
    // Same message whether or not the email exists - resetPasswordForEmail
    // doesn't leak that, and neither should this page (don't let the UI
    // become an account-enumeration oracle).
    if (error) setError(friendlyAuthError(error.message));
    else setSent(true);
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">Liquidity<span>HQ</span></div>
        <p className="login-sub">{t('FORGOT_PASSWORD_SUBTITLE')}</p>

        {sent ? (
          <div className="login-success">
            <div className="login-success-icon">✉️</div>
            <div className="login-success-title">{t('FORGOT_PASSWORD_SENT_TITLE')}</div>
            <div className="login-success-desc">
              {t('FORGOT_PASSWORD_SENT_DESC_PRE')} <strong>{email}</strong>.<br />
              {t('FORGOT_PASSWORD_SENT_DESC_POST')}
            </div>
            <Link href="/login" className="login-back-btn">{t('FORGOT_PASSWORD_BACK_TO_LOGIN')}</Link>
          </div>
        ) : (
          <>
            <div className="login-email-wrap">
              <input
                type="email"
                className="login-email-input"
                placeholder={t('LOGIN_EMAIL_INPUT_PLACEHOLDER')}
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()}
                autoComplete="email"
              />
              <button
                className="login-email-btn"
                onClick={submit}
                disabled={loading || !email.trim() || (!!TURNSTILE_SITE_KEY && !captchaToken)}
              >
                {loading ? <span className="login-spinner" /> : t('FORGOT_PASSWORD_SEND_BUTTON')}
              </button>
            </div>

            {TURNSTILE_SITE_KEY && (
              <Turnstile
                id="cf-turnstile-forgot-password"
                ref={turnstileRef}
                siteKey={TURNSTILE_SITE_KEY}
                onSuccess={setCaptchaToken}
                onExpire={() => setCaptchaToken('')}
                onError={() => setCaptchaToken('')}
                className="login-turnstile"
              />
            )}

            {error && <div className="login-error">{error}</div>}

            <Link href="/login" className="login-back-btn" style={{ display: 'block', marginTop: 14 }}>
              {t('FORGOT_PASSWORD_BACK_TO_LOGIN')}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
