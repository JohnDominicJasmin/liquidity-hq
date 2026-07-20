'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { adminFetch, fmtAgo } from '../_client';
import styles from '../ops.module.css';

interface Admin {
  user_id: string; email: string; role: 'owner' | 'staff';
  active: boolean; created_at: string;
}

export default function TeamPage() {
  const { user } = useAuth();
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // add-staff form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'staff' | 'owner'>('staff');
  const [formMsg, setFormMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await adminFetch('/api/ops/team');
    if (!res || !res.ok) { setError(res ? `HTTP ${res.status}` : 'Not signed in'); return; }
    const j = await res.json();
    setAdmins(j.admins ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addStaff(e: React.FormEvent) {
    e.preventDefault();
    setFormMsg(null);
    setBusy(true);
    const res = await adminFetch('/api/ops/team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role }),
    });
    setBusy(false);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) { setFormMsg(j.error ?? 'Failed to add.'); return; }
    const base = j.passwordSet
      ? `Added ${j.email}. They can sign in now with the password you set.`
      : `${j.email} already had an account - granted admin access (their existing password is unchanged).`;
    const emailNote = j.emailSent
      ? ' Emailed them a heads-up.'
      : ' (No email sent - notifications not configured.)';
    setFormMsg(base + emailNote);
    setEmail(''); setPassword(''); setRole('staff');
    load();
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    const res = await adminFetch(`/api/ops/team/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res && res.ok) load();
    else { const j = res ? await res.json().catch(() => ({})) : {}; setError(j.error ?? 'Update failed.'); }
  }

  async function remove(id: string, email: string) {
    setBusy(true);
    const res = await adminFetch(`/api/ops/team/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (res && res.ok) load();
    else { const j = res ? await res.json().catch(() => ({})) : {}; setError(j.error ?? 'Remove failed.'); }
    void email;
  }

  return (
    <div>
      <div className={styles.cardHead} style={{ marginBottom: 14 }}>
        <span className={styles.cardTitle}>Team {admins ? `· ${admins.length}` : ''}</span>
      </div>

      <section className={styles.card} style={{ marginBottom: 16 }}>
        <div className={styles.cardHead}><span className={styles.cardTitle}>Add admin</span></div>
        <form onSubmit={addStaff} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className={styles.searchInput} type="email" placeholder="Email" autoComplete="off"
            value={email} onChange={e => setEmail(e.target.value)} required />
          <input className={styles.searchInput} type="text" placeholder="Initial password (min 8 chars)"
            autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select className={styles.searchInput} style={{ maxWidth: 160 }}
              value={role} onChange={e => setRole(e.target.value as 'staff' | 'owner')}>
              <option value="staff">Staff</option>
              <option value="owner">Owner</option>
            </select>
            <button className={styles.loginBtn} type="submit" disabled={busy} style={{ marginTop: 0 }}>
              {busy ? 'Adding…' : 'Add'}
            </button>
          </div>
          {formMsg && <div className={styles.rowSub}>{formMsg}</div>}
        </form>
      </section>

      {error && <div className={styles.err} style={{ marginBottom: 10 }}>{error === 'HTTP 403' ? 'Owner only' : error}</div>}

      <div className={styles.rows}>
        {!admins && <div className={styles.loadingText}>Loading…</div>}
        {admins && admins.length === 0 && <div className={styles.rowSub}>No admins yet.</div>}
        {admins?.map(a => {
          const isSelf = a.user_id === user?.id;
          return (
            <div className={styles.row} key={a.user_id}>
              <span className={styles.rowLabel}>
                <span className={styles.rowName}>{a.email}</span>
                <span className={`${styles.badge} ${a.role === 'owner' ? styles.badgePro : styles.badgeGood}`}>{a.role}</span>
                {!a.active && <span className={`${styles.badge} ${styles.badgeBad}`}>DISABLED</span>}
                {isSelf && <span className={styles.rowSub}>(you)</span>}
                <br />
                <span className={styles.rowSub}>added {fmtAgo(a.created_at)}</span>
              </span>
              {!isSelf && (
                <span style={{ display: 'flex', gap: 8 }}>
                  <button className={styles.pagerBtn} disabled={busy}
                    onClick={() => patch(a.user_id, { role: a.role === 'owner' ? 'staff' : 'owner' })}>
                    {a.role === 'owner' ? 'Make staff' : 'Make owner'}
                  </button>
                  <button className={styles.pagerBtn} disabled={busy}
                    onClick={() => patch(a.user_id, { active: !a.active })}>
                    {a.active ? 'Disable' : 'Enable'}
                  </button>
                  <button className={styles.pagerBtn} disabled={busy}
                    onClick={() => remove(a.user_id, a.email)}>Remove</button>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <p className={styles.note}>
        Passwords are handled by Supabase Auth, never stored here. Removing an admin revokes /ops
        access but does not delete their app account.
      </p>
    </div>
  );
}
