'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useAdminResource, adminFetch, fmtInt, fmtAgo } from '../../_client';
import { fmtUsd } from '@/lib/aiCost';
import { Stat, CardShell, CallsByType } from '../../_cards';
import styles from '../../ops.module.css';
import { useLabels } from '@/lib/labels';

interface Detail {
  id: string; email: string | null; createdAt: string; lastSignInAt: string | null;
  banned: boolean; bannedUntil: string | null;
  subscription: { role: 'free' | 'pro'; lsStatus: string | null; currentPeriodEnd: string | null };
  onboarding: { tourSeen: boolean; checklistDone: number; checklistTotal: number };
  pushSubscriptions: number;
  counts: { trades: number; hypotheses: number; priceAlerts: number };
  aiUsage14d: { day: string; total: number }[];
  aiCost14d: { day: string; cost: number }[];
  callsByType: { type: string; count: number }[];
  cost14dTotal: number;
  revenueMonthly: number;
  margin14d: number;
}

type UserAction = 'grant_pro' | 'revoke_pro' | 'ban' | 'unban' | 'reset_ai_limit';

export default function UserDetailPage() {
  const { t } = useLabels();
  const params = useParams<{ id: string }>();
  const { user: me } = useAuth();
  const { data, error, loading, reload } = useAdminResource<Detail>(`/api/ops/users/${params.id}`);
  const isSelf = !!me && data?.id === me.id;
  const aiTotal14d = data?.aiUsage14d.reduce((s, d) => s + d.total, 0) ?? 0;
  const max = data ? Math.max(1, ...data.aiUsage14d.map(d => d.total)) : 1;

  const [busy, setBusy] = useState<UserAction | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  async function doAction(action: UserAction) {
    if (action === 'ban' && !window.confirm(t('OPS_USER_DETAIL_BAN_CONFIRM'))) return;
    setBusy(action);
    setActionMsg(null);
    const res = await adminFetch(`/api/ops/users/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setBusy(null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) { setActionMsg(j.error ?? t('OPS_USER_DETAIL_ACTION_FAILED')); return; }
    setActionMsg(t('OPS_USER_DETAIL_DONE'));
    reload();
  }

  return (
    <div>
      <Link href="/ops/users" className={styles.backLink}>{t('OPS_USER_DETAIL_BACK_LINK')}</Link>

      {loading && !data && <div className={styles.loadingText}>{t('OPS_USER_DETAIL_LOADING')}</div>}
      {error && <div className={styles.err}>{error === 'HTTP 404' ? t('OPS_USER_DETAIL_NOT_FOUND') : error === 'HTTP 403' ? t('OPS_USER_DETAIL_NOT_AUTHORIZED') : error}</div>}

      {data && (
        <>
          <div className={styles.detailHead}>
            <span className={styles.detailEmail}>{data.email ?? data.id}</span>
            {data.subscription.role === 'pro' && <span className={`${styles.badge} ${styles.badgePro}`}>{t('OPS_USER_DETAIL_PRO_BADGE')}</span>}
            {data.banned && <span className={`${styles.badge} ${styles.badgeBad}`}>{t('OPS_USER_DETAIL_BANNED_BADGE')}</span>}
          </div>
          <div className={styles.detailSub}>
            {t('OPS_USER_DETAIL_META', { joined: fmtAgo(data.createdAt), active: fmtAgo(data.lastSignInAt), id: data.id })}
          </div>

          <div className={styles.grid}>
            <CardShell title={t('OPS_USER_DETAIL_SUBSCRIPTION')} loading={false} error={null} hasData>
              <div className={styles.stats} style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
                <Stat label={t('OPS_USER_DETAIL_ROLE')} val={data.subscription.role} cls={data.subscription.role === 'pro' ? styles.accent : undefined} />
                <Stat label={t('OPS_USER_DETAIL_LS_STATUS')} val={data.subscription.lsStatus ?? '-'} />
                <Stat label={t('OPS_USER_DETAIL_PERIOD_END')} val={data.subscription.currentPeriodEnd ? new Date(data.subscription.currentPeriodEnd).toLocaleDateString() : '-'} />
              </div>
            </CardShell>

            <CardShell title={t('OPS_USER_DETAIL_ONBOARDING_DEVICES')} loading={false} error={null} hasData>
              <div className={styles.stats} style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
                <Stat label={t('OPS_USER_DETAIL_TOUR_SEEN')} val={data.onboarding.tourSeen ? t('OPS_USER_DETAIL_YES') : t('OPS_USER_DETAIL_NO')} />
                <Stat label={t('OPS_USER_DETAIL_CHECKLIST')} val={`${data.onboarding.checklistDone}/${data.onboarding.checklistTotal}`} />
                <Stat label={t('OPS_USER_DETAIL_PUSH_DEVICES')} val={fmtInt(data.pushSubscriptions)} />
              </div>
            </CardShell>

            <CardShell title={t('OPS_USER_DETAIL_ACTIVITY_COUNTS')} loading={false} error={null} hasData>
              <div className={styles.stats} style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
                <Stat label={t('OPS_USER_DETAIL_TRADES_LOGGED')} val={fmtInt(data.counts.trades)} />
                <Stat label={t('OPS_USER_DETAIL_HYPOTHESES')} val={fmtInt(data.counts.hypotheses)} />
                <Stat label={t('OPS_USER_DETAIL_PRICE_ALERTS')} val={fmtInt(data.counts.priceAlerts)} />
              </div>
              <p className={styles.note}>{t('OPS_USER_DETAIL_COUNTS_NOTE')}</p>
            </CardShell>

            <CardShell title={t('OPS_USER_DETAIL_AI_USAGE_TITLE')} onReload={reload} loading={loading} error={null} hasData>
              <div className={styles.stats} style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
                <Stat label={t('OPS_USER_DETAIL_TOTAL_CALLS')} val={fmtInt(aiTotal14d)} />
                <Stat label={t('OPS_USER_DETAIL_EST_COST_14D')} val={fmtUsd(data.cost14dTotal)} />
                <Stat label={t('OPS_USER_DETAIL_MARGIN_14D')} val={fmtUsd(data.margin14d)}
                  cls={data.margin14d < 0 ? styles.bad : styles.good} />
              </div>
              <div className={styles.miniBars} aria-hidden>
                {data.aiUsage14d.map(d => (
                  <div key={d.day} className={styles.bar}
                    style={{ height: `${Math.round((d.total / max) * 100)}%` }}
                    title={`${d.day}: ${d.total}`} />
                ))}
              </div>
              <p className={styles.cardMeta} style={{ marginTop: 10, marginBottom: 4 }}>{t('OPS_USER_DETAIL_CALLS_BY_TYPE')}</p>
              <CallsByType items={data.callsByType} />
              <p className={styles.note}>{t('OPS_USER_DETAIL_MARGIN_NOTE')}</p>
            </CardShell>

            <CardShell title={t('OPS_USER_DETAIL_ACTIONS')} loading={false} error={null} hasData span2>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {data.subscription.role === 'pro' ? (
                  <button className={styles.pagerBtn} disabled={!!busy} onClick={() => doAction('revoke_pro')}>
                    {busy === 'revoke_pro' ? t('OPS_USER_DETAIL_WORKING') : t('OPS_USER_DETAIL_REVOKE_PRO')}
                  </button>
                ) : (
                  <button className={styles.pagerBtn} disabled={!!busy} onClick={() => doAction('grant_pro')}>
                    {busy === 'grant_pro' ? t('OPS_USER_DETAIL_WORKING') : t('OPS_USER_DETAIL_GRANT_PRO')}
                  </button>
                )}
                {data.banned ? (
                  <button className={styles.pagerBtn} disabled={!!busy} onClick={() => doAction('unban')}>
                    {busy === 'unban' ? t('OPS_USER_DETAIL_WORKING') : t('OPS_USER_DETAIL_UNBAN')}
                  </button>
                ) : isSelf ? (
                  <button className={styles.pagerBtn} disabled title={t('OPS_USER_DETAIL_BAN_SELF_TITLE')}>
                    {t('OPS_USER_DETAIL_BAN_SELF_LABEL')}
                  </button>
                ) : (
                  <button className={styles.pagerBtn} disabled={!!busy} onClick={() => doAction('ban')}>
                    {busy === 'ban' ? t('OPS_USER_DETAIL_WORKING') : t('OPS_USER_DETAIL_BAN_ACCOUNT')}
                  </button>
                )}
                <button className={styles.pagerBtn} disabled={!!busy} onClick={() => doAction('reset_ai_limit')}>
                  {busy === 'reset_ai_limit' ? t('OPS_USER_DETAIL_WORKING') : t('OPS_USER_DETAIL_RESET_AI_LIMIT')}
                </button>
              </div>
              {actionMsg && <p className={styles.note}>{actionMsg}</p>}
              <p className={styles.note}>
                {t('OPS_USER_DETAIL_ACTIONS_NOTE')}
              </p>
            </CardShell>
          </div>
        </>
      )}
    </div>
  );
}
