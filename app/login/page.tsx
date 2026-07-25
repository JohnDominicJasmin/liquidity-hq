'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { getSupabase } from '@/lib/supabase';
import { track } from '@/lib/analytics';
import { useAuth } from '@/components/AuthProvider';
import { friendlyAuthError } from '@/lib/authErrors';
import LoadingState from '@/components/LoadingState';
import { useLabels } from '@/lib/labels';

// Only rendered once NEXT_PUBLIC_TURNSTILE_SITE_KEY is set - until then the
// magic-link form works exactly as before (no widget, no token required).
// Site keys are meant to be public (Cloudflare's own docs embed them
// client-side); the paired Secret key lives only in Supabase's Auth
// dashboard config and never touches this app.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

// Only allow same-origin path redirects - anything else ("//evil.com",
// "https://...") falls back to the dashboard, so ?next= can't be used as an
// open redirect.
function safeNext(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/dashboard';
}

function LoginInner() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isSignup     = searchParams.get('signup') === '1';
  const nextUrl      = safeNext(searchParams.get('next'));
  const [email, setEmail]               = useState('');
  const [emailSent, setEmailSent]       = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError]               = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const turnstileRef = useRef<TurnstileInstance>(null);
  const { t } = useLabels();

  // ── Password auth - an alternative to the default magic-link flow above,
  // not a replacement. 'link' is the default every existing user already
  // knows; 'password' reveals a self-contained sign-in/create-account form
  // with its own Turnstile + submit. Kept as local UI state, not a route, so
  // switching is instant and doesn't lose the ?next= carry-through.
  const [authMethod, setAuthMethod]     = useState<'link' | 'password'>('link');
  const [pwMode, setPwMode]             = useState<'signin' | 'signup'>(isSignup ? 'signup' : 'signin');
  const [pwEmail, setPwEmail]           = useState('');
  const [password, setPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwLoading, setPwLoading]       = useState(false);
  const [pwError, setPwError]           = useState('');
  const [pwCaptchaToken, setPwCaptchaToken] = useState('');
  const [confirmEmailSent, setConfirmEmailSent] = useState(false);
  const pwTurnstileRef = useRef<TurnstileInstance>(null);

  // Already signed in - the login form has nothing to offer, go where the
  // user was headed (?next=) or to the dashboard.
  useEffect(() => {
    if (!authLoading && user) router.replace(nextUrl);
  }, [authLoading, user, nextUrl, router]);

  // Carry ?next= through the OAuth/magic-link round trip so /auth/callback
  // can land the user where they originally wanted to go.
  const callbackUrl = () =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextUrl)}`;

  const signInWithGoogle = async () => {
    const sb = getSupabase();
    if (!sb) { setError(t('LOGIN_ERROR_SUPABASE_NOT_CONFIGURED')); return; }
    setGoogleLoading(true);
    setError('');
    track.signIn('google');
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callbackUrl(),
      },
    });
    if (error) { setError(friendlyAuthError(error.message)); setGoogleLoading(false); }
    // On success, browser navigates away - no need to reset loading
  };

  const sendMagicLink = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    // Once a site key is configured, Supabase's server-side CAPTCHA
    // protection (once you enable it in the dashboard) rejects any
    // signInWithOtp call with no/invalid captchaToken - block submission
    // client-side too so the user sees "complete the check" instead of a
    // raw server error.
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setError(t('LOGIN_ERROR_COMPLETE_VERIFICATION'));
      return;
    }
    const sb = getSupabase();
    if (!sb) { setError(t('LOGIN_ERROR_SUPABASE_NOT_CONFIGURED')); return; }
    setEmailLoading(true);
    setError('');
    track.signIn('magic_link');
    const { error } = await sb.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: callbackUrl(),
        ...(captchaToken ? { captchaToken } : {}),
      },
    });
    setEmailLoading(false);
    // Turnstile tokens are single-use - reset regardless of outcome so a
    // retry (e.g. after a typo) gets a fresh token instead of a stale one.
    turnstileRef.current?.reset();
    setCaptchaToken('');
    if (error) setError(friendlyAuthError(error.message));
    else setEmailSent(true);
  };

  const submitPassword = async () => {
    const trimmed = pwEmail.trim();
    if (!trimmed || !password) return;
    if (TURNSTILE_SITE_KEY && !pwCaptchaToken) {
      setPwError(t('LOGIN_ERROR_COMPLETE_VERIFICATION'));
      return;
    }
    if (pwMode === 'signup' && password !== confirmPassword) {
      setPwError(t('LOGIN_PASSWORD_MISMATCH'));
      return;
    }
    if (pwMode === 'signup' && password.length < 8) {
      setPwError(t('LOGIN_PASSWORD_TOO_SHORT'));
      return;
    }
    const sb = getSupabase();
    if (!sb) { setPwError(t('LOGIN_ERROR_SUPABASE_NOT_CONFIGURED')); return; }
    setPwLoading(true);
    setPwError('');

    if (pwMode === 'signup') {
      track.signIn('password_signup');
      const { data, error } = await sb.auth.signUp({
        email: trimmed,
        password,
        options: {
          emailRedirectTo: callbackUrl(),
          ...(pwCaptchaToken ? { captchaToken: pwCaptchaToken } : {}),
        },
      });
      setPwLoading(false);
      pwTurnstileRef.current?.reset();
      setPwCaptchaToken('');
      if (error) { setPwError(friendlyAuthError(error.message)); return; }
      // Same account-creation path as magic-link (auth.users insert), so the
      // existing signup trial / disposable-domain / IP-velocity protections
      // all apply here too - nothing bypasses them just because this is a
      // different frontend form.
      if (data.session) {
        // Confirm-email is off for this project - already signed in, the
        // redirect effect above fires once `user` updates.
        return;
      }
      // Confirm-email is on - Supabase created the user but withheld a
      // session until the emailed link is clicked. Show the same "check your
      // inbox" pattern the magic-link flow already uses.
      setConfirmEmailSent(true);
    } else {
      track.signIn('password_signin');
      const { error } = await sb.auth.signInWithPassword({
        email: trimmed,
        password,
        ...(pwCaptchaToken ? { options: { captchaToken: pwCaptchaToken } } : {}),
      });
      setPwLoading(false);
      pwTurnstileRef.current?.reset();
      setPwCaptchaToken('');
      if (error) setPwError(friendlyAuthError(error.message));
      // On success, onAuthStateChange updates `user` and the redirect effect fires.
    }
  };

  // While the session is resolving (or a redirect is in flight), show the
  // spinner card instead of flashing the sign-in form at a signed-in user.
  if (authLoading || user) return <LoginFallback />;

  return (
    <div className="login-wrap">
      <div className="login-card">

        {/* Logo */}
        <div className="login-logo">Liquidity<span>HQ</span></div>
        <p className="login-sub">{isSignup ? t('LOGIN_SUBTITLE_SIGNUP') : t('LOGIN_SUBTITLE_SIGNIN')}</p>

        {authMethod === 'link' ? (
          emailSent ? (
            /* ── Magic link sent ── */
            <div className="login-success">
              <div className="login-success-icon">✉️</div>
              <div className="login-success-title">{t('LOGIN_SUCCESS_TITLE')}</div>
              <div className="login-success-desc">
                {t('LOGIN_SUCCESS_DESC_PRE')} <strong>{email}</strong>.<br />
                {t('LOGIN_SUCCESS_DESC_POST')}
              </div>
              <button className="login-back-btn" onClick={() => { setEmailSent(false); setEmail(''); }}>
                {t('LOGIN_USE_DIFFERENT_EMAIL_BUTTON')}
              </button>
            </div>
          ) : (
            <>
              {/* ── Google OAuth ── */}
              <button
                className="login-google-btn"
                onClick={signInWithGoogle}
                disabled={googleLoading}
              >
                {googleLoading
                  ? <span className="login-spinner" />
                  : (
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908C16.658 14.253 17.64 11.945 17.64 9.2z" fill="#4285F4"/>
                      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                    </svg>
                  )
                }
                {googleLoading ? t('LOGIN_GOOGLE_SIGNING_IN') : t('LOGIN_GOOGLE_CONTINUE_BUTTON')}
              </button>

              {/* ── Divider ── */}
              <div className="login-divider"><span>{t('LOGIN_DIVIDER_OR')}</span></div>

              {/* ── Email magic link ── */}
              <div className="login-email-wrap">
                <input
                  type="email"
                  className="login-email-input"
                  placeholder={t('LOGIN_EMAIL_INPUT_PLACEHOLDER')}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendMagicLink()}
                />
                <button
                  className="login-email-btn"
                  onClick={sendMagicLink}
                  disabled={emailLoading || !email.trim() || (!!TURNSTILE_SITE_KEY && !captchaToken)}
                >
                  {emailLoading ? <span className="login-spinner" /> : t('LOGIN_SEND_MAGIC_LINK_BUTTON')}
                </button>
              </div>

              {/* CAPTCHA - only rendered once a site key is configured, so the
                  form works unchanged until Turnstile is actually set up. */}
              {TURNSTILE_SITE_KEY && (
                <Turnstile
                  ref={turnstileRef}
                  siteKey={TURNSTILE_SITE_KEY}
                  onSuccess={setCaptchaToken}
                  onExpire={() => setCaptchaToken('')}
                  onError={() => setCaptchaToken('')}
                  className="login-turnstile"
                />
              )}

              {error && <div className="login-error">{error}</div>}

              <button
                className="login-back-btn"
                style={{ marginTop: 14 }}
                onClick={() => { setAuthMethod('password'); setPwError(''); }}
              >
                {t('LOGIN_USE_PASSWORD_LINK')}
              </button>
            </>
          )
        ) : (
          confirmEmailSent ? (
            /* ── Sign-up confirmation email sent ── */
            <div className="login-success">
              <div className="login-success-icon">✉️</div>
              <div className="login-success-title">{t('LOGIN_CONFIRM_EMAIL_TITLE')}</div>
              <div className="login-success-desc">
                {t('LOGIN_CONFIRM_EMAIL_DESC_PRE')} <strong>{pwEmail}</strong>.<br />
                {t('LOGIN_CONFIRM_EMAIL_DESC_POST')}
              </div>
              <button className="login-back-btn" onClick={() => { setConfirmEmailSent(false); setPwEmail(''); setPassword(''); setConfirmPassword(''); }}>
                {t('LOGIN_USE_DIFFERENT_EMAIL_BUTTON')}
              </button>
            </div>
          ) : (
            <>
              {/* ── Sign in / Create account tabs ── */}
              <div className="login-pw-tabs">
                <button
                  className={`login-pw-tab${pwMode === 'signin' ? ' on' : ''}`}
                  onClick={() => { setPwMode('signin'); setPwError(''); }}
                >
                  {t('LOGIN_TAB_SIGNIN')}
                </button>
                <button
                  className={`login-pw-tab${pwMode === 'signup' ? ' on' : ''}`}
                  onClick={() => { setPwMode('signup'); setPwError(''); }}
                >
                  {t('LOGIN_TAB_SIGNUP')}
                </button>
              </div>

              <div className="login-email-wrap">
                <input
                  type="email"
                  className="login-email-input"
                  placeholder={t('LOGIN_EMAIL_INPUT_PLACEHOLDER')}
                  value={pwEmail}
                  onChange={e => setPwEmail(e.target.value)}
                  autoComplete="email"
                />
                <input
                  type="password"
                  className="login-email-input"
                  placeholder={pwMode === 'signup' ? t('LOGIN_PASSWORD_NEW_PLACEHOLDER') : t('LOGIN_PASSWORD_PLACEHOLDER')}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && pwMode === 'signin' && submitPassword()}
                  autoComplete={pwMode === 'signup' ? 'new-password' : 'current-password'}
                />
                {pwMode === 'signup' && (
                  <input
                    type="password"
                    className="login-email-input"
                    placeholder={t('LOGIN_PASSWORD_CONFIRM_PLACEHOLDER')}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitPassword()}
                    autoComplete="new-password"
                  />
                )}
                <button
                  className="login-email-btn"
                  onClick={submitPassword}
                  disabled={pwLoading || !pwEmail.trim() || !password || (!!TURNSTILE_SITE_KEY && !pwCaptchaToken)}
                >
                  {pwLoading ? <span className="login-spinner" /> : (pwMode === 'signup' ? t('LOGIN_CREATE_ACCOUNT_BUTTON') : t('LOGIN_SIGNIN_BUTTON'))}
                </button>
              </div>

              {pwMode === 'signin' && (
                <Link href="/forgot-password" className="login-forgot-link">
                  {t('LOGIN_FORGOT_PASSWORD_LINK')}
                </Link>
              )}

              {TURNSTILE_SITE_KEY && (
                <Turnstile
                  ref={pwTurnstileRef}
                  siteKey={TURNSTILE_SITE_KEY}
                  onSuccess={setPwCaptchaToken}
                  onExpire={() => setPwCaptchaToken('')}
                  onError={() => setPwCaptchaToken('')}
                  className="login-turnstile"
                />
              )}

              {pwError && <div className="login-error">{pwError}</div>}

              <button
                className="login-back-btn"
                style={{ marginTop: 14 }}
                onClick={() => { setAuthMethod('link'); setPwError(''); }}
              >
                {t('LOGIN_USE_MAGIC_LINK_LINK')}
              </button>
            </>
          )
        )}
      </div>

      {/* Skip link */}
      <div className="login-footer">
        <Link href="/" className="login-skip">{t('LOGIN_SKIP_LINK')}</Link>
      </div>
    </div>
  );
}

function LoginFallback() {
  const { t } = useLabels();
  return <LoadingState message={t('LOGIN_LOADING')} fullPage />;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginInner />
    </Suspense>
  );
}
