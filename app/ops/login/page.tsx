'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import styles from '../ops.module.css';

// Admin login. Uses Supabase Auth email+password (signInWithPassword) - the
// consumer app doesn't expose password login, but the same Supabase project
// handles it securely. Owners can also use Google.
//
// Both flows keep the user inside the (chromeless) /ops context: on success a
// session exists and the effect below hands off to /ops. Google returns here to
// /ops/login (not the consumer /auth/callback), so there's no intermediate
// full-chrome "normal app" screen - just a clean "Signing you in…" then the
// console.
export default function OpsLoginPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);

  // Detect an OAuth return (code/token in the URL) to show a clean signing-in
  // state instead of briefly flashing the form.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasCode = window.location.hash.includes('access_token')
      || new URLSearchParams(window.location.search).has('code');
    if (hasCode) setReturning(true);
  }, []);

  // Once a session exists (password or OAuth), hand off to the gated console.
  useEffect(() => {
    if (user) router.replace('/ops');
  }, [user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const sb = getSupabase();
    if (!sb) { setErr('Auth is not configured.'); setBusy(false); return; }
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    // Session is set - the effect above redirects to /ops.
  }

  async function onGoogle() {
    const sb = getSupabase();
    if (!sb) { setErr('Auth is not configured.'); return; }
    setReturning(true);
    await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/ops/login` },
    });
  }

  if (returning || user) {
    return (
      <div className={styles.loginWrap}>
        <div className={styles.loginCard} style={{ alignItems: 'center', textAlign: 'center' }}>
          <div className={styles.loginTitle}>LiquidityHQ <b>Ops</b></div>
          <div className={styles.spinner} aria-hidden />
          <div className={styles.loginSub}>Signing you in…</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.loginWrap}>
      <form className={styles.loginCard} onSubmit={onSubmit}>
        <div className={styles.loginTitle}>LiquidityHQ <b>Ops</b></div>
        <div className={styles.loginSub}>Staff sign in</div>

        <label className={styles.loginLabel}>
          Email
          <input
            className={styles.loginInput}
            type="email"
            autoComplete="username"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </label>

        <label className={styles.loginLabel}>
          Password
          <input
            className={styles.loginInput}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </label>

        {err && <div className={styles.err}>{err}</div>}

        <button className={styles.loginBtn} type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div className={styles.loginDivider}>or</div>

        <button className={styles.loginGoogle} type="button" onClick={onGoogle}>
          Sign in with Google
        </button>
      </form>
    </div>
  );
}
