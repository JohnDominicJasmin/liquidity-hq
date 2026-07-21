'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useAdminResource, adminFetch, fmtInt, fmtAgo } from '../../_client';
import { Stat, CardShell } from '../../_cards';
import styles from '../../ops.module.css';

interface Detail {
  id: string; email: string | null; createdAt: string; lastSignInAt: string | null;
  banned: boolean; bannedUntil: string | null;
  subscription: { role: 'free' | 'pro'; lsStatus: string | null; currentPeriodEnd: string | null };
  onboarding: { tourSeen: boolean; checklistDone: number; checklistTotal: number };
  pushSubscriptions: number;
  counts: { trades: number; hypotheses: number; priceAlerts: number };
  aiUsage14d: { day: string; total: number }[];
}

type UserAction = 'grant_pro' | 'revoke_pro' | 'ban' | 'unban' | 'reset_ai_limit';

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const { user: me } = useAuth();
  const { data, error, loading, reload } = useAdminResource<Detail>(`/api/ops/users/${params.id}`);
  const isSelf = !!me && data?.id === me.id;
  const aiTotal14d = data?.aiUsage14d.reduce((s, d) => s + d.total, 0) ?? 0;
  const max = data ? Math.max(1, ...data.aiUsage14d.map(d => d.total)) : 1;

  const [busy, setBusy] = useState<UserAction | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  async function doAction(action: UserAction) {
    if (action === 'ban' && !window.confirm('Ban this account? They will be unable to sign in until unbanned.')) return;
    setBusy(action);
    setActionMsg(null);
    const res = await adminFetch(`/api/ops/users/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setBusy(null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) { setActionMsg(j.error ?? 'Action failed.'); return; }
    setActionMsg('Done.');
    reload();
  }

  return (
    <div>
      <Link href="/ops/users" className={styles.backLink}>← Back to users</Link>

      {loading && !data && <div className={styles.loadingText}>Loading…</div>}
      {error && <div className={styles.err}>{error === 'HTTP 404' ? 'User not found' : error === 'HTTP 403' ? 'Not authorized' : error}</div>}

      {data && (
        <>
          <div className={styles.detailHead}>
            <span className={styles.detailEmail}>{data.email ?? data.id}</span>
            {data.subscription.role === 'pro' && <span className={`${styles.badge} ${styles.badgePro}`}>PRO</span>}
            {data.banned && <span className={`${styles.badge} ${styles.badgeBad}`}>BANNED</span>}
          </div>
          <div className={styles.detailSub}>
            joined {fmtAgo(data.createdAt)} · last active {fmtAgo(data.lastSignInAt)} · id {data.id}
          </div>

          <div className={styles.grid}>
            <CardShell title="Subscription" loading={false} error={null} hasData>
              <div className={styles.stats} style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
                <Stat label="Role" val={data.subscription.role} cls={data.subscription.role === 'pro' ? styles.accent : undefined} />
                <Stat label="LS status" val={data.subscription.lsStatus ?? '-'} />
                <Stat label="Period end" val={data.subscription.currentPeriodEnd ? new Date(data.subscription.currentPeriodEnd).toLocaleDateString() : '-'} />
              </div>
            </CardShell>

            <CardShell title="Onboarding & devices" loading={false} error={null} hasData>
              <div className={styles.stats} style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
                <Stat label="Tour seen" val={data.onboarding.tourSeen ? 'Yes' : 'No'} />
                <Stat label="Checklist" val={`${data.onboarding.checklistDone}/${data.onboarding.checklistTotal}`} />
                <Stat label="Push devices" val={fmtInt(data.pushSubscriptions)} />
              </div>
            </CardShell>

            <CardShell title="Activity counts" loading={false} error={null} hasData>
              <div className={styles.stats} style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
                <Stat label="Trades logged" val={fmtInt(data.counts.trades)} />
                <Stat label="Hypotheses" val={fmtInt(data.counts.hypotheses)} />
                <Stat label="Price alerts" val={fmtInt(data.counts.priceAlerts)} />
              </div>
              <p className={styles.note}>Counts only - journal/hypothesis content stays private.</p>
            </CardShell>

            <CardShell title="AI usage · 14d" onReload={reload} loading={loading} error={null} hasData>
              <div className={styles.stats} style={{ gridTemplateColumns: 'repeat(1,1fr)' }}>
                <Stat label="Total calls" val={fmtInt(aiTotal14d)} />
              </div>
              <div className={styles.miniBars} aria-hidden>
                {data.aiUsage14d.map(d => (
                  <div key={d.day} className={styles.bar}
                    style={{ height: `${Math.round((d.total / max) * 100)}%` }}
                    title={`${d.day}: ${d.total}`} />
                ))}
              </div>
            </CardShell>

            <CardShell title="Actions" loading={false} error={null} hasData span2>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {data.subscription.role === 'pro' ? (
                  <button className={styles.pagerBtn} disabled={!!busy} onClick={() => doAction('revoke_pro')}>
                    {busy === 'revoke_pro' ? 'Working…' : 'Revoke Pro'}
                  </button>
                ) : (
                  <button className={styles.pagerBtn} disabled={!!busy} onClick={() => doAction('grant_pro')}>
                    {busy === 'grant_pro' ? 'Working…' : 'Grant Pro'}
                  </button>
                )}
                {data.banned ? (
                  <button className={styles.pagerBtn} disabled={!!busy} onClick={() => doAction('unban')}>
                    {busy === 'unban' ? 'Working…' : 'Unban'}
                  </button>
                ) : isSelf ? (
                  <button className={styles.pagerBtn} disabled title="You can't ban the account you're signed in as.">
                    Ban account (not your own)
                  </button>
                ) : (
                  <button className={styles.pagerBtn} disabled={!!busy} onClick={() => doAction('ban')}>
                    {busy === 'ban' ? 'Working…' : 'Ban account'}
                  </button>
                )}
                <button className={styles.pagerBtn} disabled={!!busy} onClick={() => doAction('reset_ai_limit')}>
                  {busy === 'reset_ai_limit' ? 'Working…' : "Reset today's AI limit"}
                </button>
              </div>
              {actionMsg && <p className={styles.note}>{actionMsg}</p>}
              <p className={styles.note}>
                Grant/Revoke Pro only touches the role - an existing paid subscription's billing
                fields are untouched. Ban blocks sign-in via Supabase Auth; you cannot ban yourself.
                Every action is written to the audit log.
              </p>
            </CardShell>
          </div>
        </>
      )}
    </div>
  );
}
