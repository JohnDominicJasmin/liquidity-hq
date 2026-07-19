'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import styles from '../ops.module.css';

// Admin login. Uses Supabase Auth email+password (signInWithPassword) - the
// consumer app doesn't expose password login, but the same Supabase project
// handles it securely (hashing, sessions, rate-limiting). Owners can also use
// Google. On success the session is stored and we hand off to /ops, whose gate
// re-checks server-side.
export default function OpsLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const sb = getSupabase();
    if (!sb) { setErr('Auth is not configured.'); setBusy(false); return; }
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.replace('/ops');
  }

  async function onGoogle() {
    const sb = getSupabase();
    if (!sb) { setErr('Auth is not configured.'); return; }
    await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback?next=/ops` },
    });
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
