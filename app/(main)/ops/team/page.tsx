'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { adminFetch, fmtAgo } from '../_client';
import styles from '../ops.module.css';
import { useLabels } from '@/lib/labels';

interface Admin {
  user_id: string; email: string; role: 'owner' | 'staff';
  active: boolean; created_at: string;
}

export default function TeamPage() {
  const { t } = useLabels();
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
    if (!res || !res.ok) { setError(res ? `HTTP ${res.status}` : t('OPS_TEAM_ERR_NOT_SIGNED_IN')); return; }
    const j = await res.json();
    setAdmins(j.admins ?? []);
  }, [t]);

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
    if (!res || !res.ok) { setFormMsg(j.error ?? t('OPS_TEAM_ERR_FAILED_TO_ADD')); return; }
    const base = j.passwordSet
      ? t('OPS_TEAM_ADD_SUCCESS_NEW', { email: j.email })
      : t('OPS_TEAM_ADD_SUCCESS_EXISTING', { email: j.email });
    const emailNote = j.emailSent
      ? ' ' + t('OPS_TEAM_ADD_EMAIL_SENT_NOTE')
      : ' ' + t('OPS_TEAM_ADD_EMAIL_NOT_SENT_NOTE');
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
    else { const j = res ? await res.json().catch(() => ({})) : {}; setError(j.error ?? t('OPS_TEAM_ERR_UPDATE_FAILED')); }
  }

  async function remove(id: string, email: string) {
    setBusy(true);
    const res = await adminFetch(`/api/ops/team/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (res && res.ok) load();
    else { const j = res ? await res.json().catch(() => ({})) : {}; setError(j.error ?? t('OPS_TEAM_ERR_REMOVE_FAILED')); }
    void email;
  }

  return (
    <div>
      <div className={styles.cardHead} style={{ marginBottom: 14 }}>
        <span className={styles.cardTitle}>{t('OPS_TEAM_PAGE_TITLE')} {admins ? `· ${admins.length}` : ''}</span>
      </div>

      <section className={styles.card} style={{ marginBottom: 16 }}>
        <div className={styles.cardHead}><span className={styles.cardTitle}>{t('OPS_TEAM_ADD_ADMIN_HEADING')}</span></div>
        <form onSubmit={addStaff} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className={styles.searchInput} type="email" placeholder={t('OPS_TEAM_EMAIL_PLACEHOLDER')} autoComplete="off"
            value={email} onChange={e => setEmail(e.target.value)} required />
          <input className={styles.searchInput} type="text" placeholder={t('OPS_TEAM_PASSWORD_PLACEHOLDER')}
            autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select className={styles.searchInput} style={{ maxWidth: 160 }}
              value={role} onChange={e => setRole(e.target.value as 'staff' | 'owner')}>
              <option value="staff">{t('OPS_TEAM_ROLE_STAFF')}</option>
              <option value="owner">{t('OPS_TEAM_ROLE_OWNER')}</option>
            </select>
            <button className={styles.loginBtn} type="submit" disabled={busy} style={{ marginTop: 0 }}>
              {busy ? t('OPS_TEAM_ADDING_BUTTON') : t('OPS_TEAM_ADD_BUTTON')}
            </button>
          </div>
          {formMsg && <div className={styles.rowSub}>{formMsg}</div>}
        </form>
      </section>

      {error && <div className={styles.err} style={{ marginBottom: 10 }}>{error === 'HTTP 403' ? t('OPS_TEAM_ERR_OWNER_ONLY') : error}</div>}

      <div className={styles.rows}>
        {!admins && <div className={styles.loadingText}>{t('OPS_TEAM_LOADING')}</div>}
        {admins && admins.length === 0 && <div className={styles.rowSub}>{t('OPS_TEAM_EMPTY')}</div>}
        {admins?.map(a => {
          const isSelf = a.user_id === user?.id;
          return (
            <div className={styles.row} key={a.user_id}>
              <span className={styles.rowLabel}>
                <span className={styles.rowName}>{a.email}</span>
                <span className={`${styles.badge} ${a.role === 'owner' ? styles.badgePro : styles.badgeGood}`}>{a.role}</span>
                {!a.active && <span className={`${styles.badge} ${styles.badgeBad}`}>{t('OPS_TEAM_DISABLED_BADGE')}</span>}
                {isSelf && <span className={styles.rowSub}>{t('OPS_TEAM_YOU_SUFFIX')}</span>}
                <br />
                <span className={styles.rowSub}>{t('OPS_TEAM_ADDED_AGO', { ago: fmtAgo(a.created_at) })}</span>
              </span>
              {!isSelf && (
                <span style={{ display: 'flex', gap: 8 }}>
                  <button className={styles.pagerBtn} disabled={busy}
                    onClick={() => patch(a.user_id, { role: a.role === 'owner' ? 'staff' : 'owner' })}>
                    {a.role === 'owner' ? t('OPS_TEAM_MAKE_STAFF') : t('OPS_TEAM_MAKE_OWNER')}
                  </button>
                  <button className={styles.pagerBtn} disabled={busy}
                    onClick={() => patch(a.user_id, { active: !a.active })}>
                    {a.active ? t('OPS_TEAM_DISABLE') : t('OPS_TEAM_ENABLE')}
                  </button>
                  <button className={styles.pagerBtn} disabled={busy}
                    onClick={() => remove(a.user_id, a.email)}>{t('OPS_TEAM_REMOVE')}</button>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <p className={styles.note}>
        {t('OPS_TEAM_FOOTER_NOTE')}
      </p>
    </div>
  );
}
