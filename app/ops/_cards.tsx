'use client';
import Link from 'next/link';
import { useAdminResource, fmtInt, fmtPct, fmtAgo } from './_client';
import { fmtUsd } from '@/lib/aiCost';
import { useLabels } from '@/lib/labels';
import styles from './ops.module.css';

// Shared stat tile.
export function Stat({ label, val, sub, cls }: { label: string; val: string; sub?: string; cls?: string }) {
  return (
    <div className={styles.stat}>
      <span className={`${styles.statVal} ${cls ?? ''}`}>{val}</span>
      <span className={styles.statLabel}>{label}</span>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  );
}

// Shared card chrome + loading/error handling.
export function CardShell({
  title, meta, onReload, loading, error, hasData, span2, children,
}: {
  title: string; meta?: string; onReload?: () => void;
  loading: boolean; error: string | null; hasData: boolean; span2?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useLabels();
  return (
    <section className={`${styles.card} ${span2 ? styles.cardSpan2 : ''}`}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{title}</span>
        {meta ? <span className={styles.cardMeta}>{meta}</span>
              : onReload ? <button className={styles.reload} onClick={onReload} aria-label={t('OPS_CARDS_RELOAD_ARIA')}>↻</button> : null}
      </div>
      {loading && !hasData && <div className={styles.loadingText}>{t('OPS_CARDS_LOADING')}</div>}
      {error && <div className={styles.err}>{error === 'HTTP 403' ? t('OPS_CARDS_NOT_AUTHORIZED') : error}</div>}
      {children}
    </section>
  );
}

interface Overview {
  totalUsers: number; proUsers: number; freeUsers: number; activePaying: number;
  signups7d: number; signups30d: number; active7d: number; active30d: number;
  generatedAt: string;
}

export function OverviewCard() {
  const { t } = useLabels();
  const { data, error, loading, reload } = useAdminResource<Overview>('/api/ops/overview');
  const proRate = data && data.totalUsers ? Math.round((data.proUsers / data.totalUsers) * 100) : null;
  return (
    <CardShell title={t('OPS_CARDS_OVERVIEW_TITLE')} onReload={reload} loading={loading} error={error} hasData={!!data} span2>
      {data && (
        <div className={styles.stats}>
          <Stat label={t('OPS_CARDS_TOTAL_USERS')} val={fmtInt(data.totalUsers)} />
          <Stat label={t('OPS_CARDS_PRO')} val={fmtInt(data.proUsers)} cls={styles.accent} sub={t('OPS_CARDS_PAYING_SUB', { count: fmtInt(data.activePaying) })} />
          <Stat label={t('OPS_CARDS_FREE')} val={fmtInt(data.freeUsers)} />
          <Stat label={t('OPS_CARDS_NEW_7D')} val={fmtInt(data.signups7d)} sub={t('OPS_CARDS_IN_30D_SUB', { count: fmtInt(data.signups30d) })} />
          <Stat label={t('OPS_CARDS_ACTIVE_7D')} val={fmtInt(data.active7d)} sub={t('OPS_CARDS_IN_30D_SUB', { count: fmtInt(data.active30d) })} />
          <Stat label={t('OPS_CARDS_PRO_RATE')} val={proRate == null ? '-' : `${proRate}%`} />
        </div>
      )}
    </CardShell>
  );
}

// ── Cron health ────────────────────────────────────────────────────────────
interface Cron {
  key: string; name: string; route: string; cadence: string;
  kind: 'proxy' | 'health';
  lastActivity?: string | null; overdue24?: number;
  status: 'ok' | 'warn' | 'bad'; detail: string;
}
interface CronsData { crons: Cron[]; generatedAt: string }

const dotFor = (s: Cron['status']) =>
  s === 'ok' ? styles.dotGood : s === 'warn' ? styles.dotWarn : styles.dotBad;

export function CronsCard() {
  const { t } = useLabels();
  const { data, error, loading, reload } = useAdminResource<CronsData>('/api/ops/crons');
  return (
    <CardShell title={t('OPS_CARDS_CRON_HEALTH_TITLE')} onReload={reload} loading={loading} error={error} hasData={!!data}>
      {data && (
        <>
          <div className={styles.rows}>
            {data.crons.map(c => (
              <div className={styles.row} key={c.key}>
                <span className={styles.rowLabel}>
                  <span className={`${styles.dot} ${dotFor(c.status)}`} />
                  <span>
                    <span className={styles.rowName}>{c.name}</span>{' '}
                    <span className={styles.rowSub}>{c.cadence}</span>
                    <br />
                    <span className={styles.rowSub}>
                      {c.kind === 'proxy' ? `${c.detail} · ${fmtAgo(c.lastActivity)}` : c.detail}
                    </span>
                  </span>
                </span>
              </div>
            ))}
          </div>
          <p className={styles.note}>
            {t('OPS_CARDS_CRON_NOTE')}
          </p>
        </>
      )}
    </CardShell>
  );
}

// ── AI cost (Grok) ─────────────────────────────────────────────────────────
// Prettifies raw snake_case type keys (alert cron signal_type strings and
// grok_usage column names, both flow through this) - "ema_signal_1h" ->
// "EMA signal 1h", "whale_trade" -> "Whale trade". Known domain acronyms
// stay uppercase regardless of position; everything else is sentence case.
const TYPE_ACRONYMS = new Set(['ema', 'smc', 'oi', 'tf']);
function prettifyType(type: string): string {
  return type.split('_').map((w, i) => {
    if (TYPE_ACRONYMS.has(w)) return w.toUpperCase();
    return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  }).join(' ');
}

function CallsByType({ items }: { items: { type: string; count: number }[] }) {
  if (items.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map(b => (
        <span key={b.type} style={{
          fontSize: 'var(--fs-caption)', color: 'var(--txt2)', background: 'var(--bg2)',
          border: '0.5px solid var(--bdr)', borderRadius: 'var(--radius-chip)', padding: '2px 8px',
        }}>
          {prettifyType(b.type)} <b style={{ color: 'var(--txt)', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(b.count)}</b>
        </span>
      ))}
    </div>
  );
}

interface AiCost {
  system: { total24h: number; total7d: number; perDay: { day: string; count: number }[]; byType: { type: string; count: number }[] };
  userCallsByType: { type: string; count: number }[];
  topSpenders: {
    userId: string; email: string | null; role: string;
    cost24h: number; cost7d: number; cost30d: number;
    revenueMonthly: number; margin: number;
  }[];
  cost: { global24h: number; global7d: number; global30d: number };
  globalBreaker: { todayCalls: number; capCalls: number | null; spikeAlert: boolean };
  generatedAt: string;
}

// Top-of-page notification when today's xAI usage is approaching the global
// daily cap - same data/threshold as AiCostCard's buried note below, just in
// a spot an admin can't miss without opening that card.
export function SpikeBanner() {
  const { t } = useLabels();
  const { data } = useAdminResource<AiCost>('/api/ops/ai-cost');
  const gb = data?.globalBreaker;
  if (!gb?.spikeAlert || gb.capCalls == null) return null;
  const pct = Math.round((gb.todayCalls / gb.capCalls) * 100);
  return (
    <div className={styles.spikeBanner}>
      {t('OPS_SPIKE_BANNER', { calls: fmtInt(gb.todayCalls), cap: fmtInt(gb.capCalls), pct: String(pct) })}
    </div>
  );
}

export function AiCostCard() {
  const { t } = useLabels();
  const { data, error, loading, reload } = useAdminResource<AiCost>('/api/ops/ai-cost');
  const max = data ? Math.max(1, ...data.system.perDay.map(d => d.count)) : 1;
  const gb = data?.globalBreaker;
  return (
    <CardShell title={t('OPS_CARDS_AI_COST_TITLE')} onReload={reload} loading={loading} error={error} hasData={!!data} span2>
      {data && (
        <>
          <div className={styles.stats} style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
            <Stat label={t('OPS_CARDS_CRON_CALLS_24H')} val={fmtInt(data.system.total24h)} />
            <Stat label={t('OPS_CARDS_CRON_CALLS_7D')} val={fmtInt(data.system.total7d)} />
          </div>
          <div className={styles.stats} style={{ gridTemplateColumns: 'repeat(4,1fr)', marginTop: 12 }}>
            <Stat label={t('OPS_CARDS_AI_SPEND_24H')} val={fmtUsd(data.cost.global24h)} />
            <Stat label={t('OPS_CARDS_AI_SPEND_7D')} val={fmtUsd(data.cost.global7d)} />
            <Stat label={t('OPS_CARDS_AI_SPEND_30D')} val={fmtUsd(data.cost.global30d)} />
            <Stat
              label={t('OPS_CARDS_GLOBAL_CAP_TODAY')}
              val={gb?.capCalls != null ? `${fmtInt(gb.todayCalls)} / ${fmtInt(gb.capCalls)}` : fmtInt(gb?.todayCalls)}
              cls={gb?.spikeAlert ? styles.bad : undefined}
              sub={gb?.capCalls == null ? t('OPS_CARDS_GLOBAL_CAP_UNSET') : undefined}
            />
          </div>
          {gb?.spikeAlert && <p className={styles.err} style={{ marginTop: 8 }}>{t('OPS_CARDS_SPIKE_ALERT')}</p>}
          <div className={styles.miniBars} aria-hidden>
            {data.system.perDay.map(d => (
              <div key={d.day} className={styles.bar}
                style={{ height: `${Math.round((d.count / max) * 100)}%` }}
                title={`${d.day}: ${d.count}`} />
            ))}
          </div>
          <p className={styles.cardMeta} style={{ marginTop: 10, marginBottom: 4 }}>{t('OPS_CARDS_ALERT_CALLS_BY_TYPE')}</p>
          <CallsByType items={data.system.byType} />
          <p className={styles.cardMeta} style={{ marginTop: 10, marginBottom: 4 }}>{t('OPS_CARDS_USER_CALLS_BY_TYPE')}</p>
          <CallsByType items={data.userCallsByType} />
          <p className={styles.cardMeta} style={{ marginTop: 10, marginBottom: 4 }}>{t('OPS_CARDS_TOP_SPENDERS_TITLE')}</p>
          <div className={styles.rows}>
            {data.topSpenders.length === 0 && <div className={styles.rowSub}>{t('OPS_CARDS_NO_AI_USAGE')}</div>}
            {data.topSpenders.map(u => (
              <Link href={`/ops/users/${u.userId}`} key={u.userId} className={styles.row} style={{ textDecoration: 'none' }}>
                <span className={styles.rowLabel}>
                  <span className={styles.rowName}>{u.email ?? `${u.userId.slice(0, 8)}…`}</span>
                  {u.role === 'pro' && <span className={`${styles.badge} ${styles.badgePro}`}>{t('OPS_USERS_PRO_BADGE')}</span>}
                </span>
                <span className={styles.rowVal}>
                  {fmtUsd(u.cost30d)}
                  <span className={`${styles.rowSub} ${u.margin < 0 ? styles.bad : styles.good}`} style={{ marginLeft: 8 }}>
                    {t('OPS_CARDS_MARGIN_LABEL', { margin: fmtUsd(u.margin) })}
                  </span>
                </span>
              </Link>
            ))}
          </div>
          <p className={styles.note}>{t('OPS_CARDS_AI_COST_NOTE')}</p>
        </>
      )}
    </CardShell>
  );
}

// ── Signal accuracy ────────────────────────────────────────────────────────
interface Accuracy {
  alerts: {
    overall: { n: number; winRate: number | null; avgPct: number | null };
    byRule: { rule: string; n: number; winRate: number | null; avgPct: number | null }[];
  };
  liveSignals: { n: number; winRate: number | null; avgR: number | null };
  generatedAt: string;
}

const winCls = (rate: number | null): string | undefined =>
  rate == null ? undefined : rate >= 50 ? styles.good : styles.bad;

export function AccuracyCard() {
  const { t } = useLabels();
  const { data, error, loading, reload } = useAdminResource<Accuracy>('/api/ops/accuracy');
  const avgR = data?.liveSignals.avgR ?? null;
  return (
    <CardShell title={t('OPS_CARDS_SIGNAL_ACCURACY_TITLE')} onReload={reload} loading={loading} error={error} hasData={!!data}>
      {data && (
        <>
          <div className={styles.stats} style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            <Stat label={t('OPS_CARDS_ALERT_24H_WIN')} val={fmtPct(data.alerts.overall.winRate)}
              sub={t('OPS_CARDS_RESOLVED_SUB', { count: fmtInt(data.alerts.overall.n) })} cls={winCls(data.alerts.overall.winRate)} />
            <Stat label={t('OPS_CARDS_LIVE_SIG_WIN')} val={fmtPct(data.liveSignals.winRate)}
              sub={t('OPS_CARDS_RESOLVED_SUB', { count: fmtInt(data.liveSignals.n) })} cls={winCls(data.liveSignals.winRate)} />
            <Stat label={t('OPS_CARDS_AVG_R')} val={avgR == null ? '-' : avgR.toFixed(2)}
              cls={avgR == null ? undefined : avgR > 0 ? styles.good : styles.bad} />
          </div>
          <div className={styles.rows} style={{ marginTop: 12 }}>
            {data.alerts.byRule.length === 0 && <div className={styles.rowSub}>{t('OPS_CARDS_NO_RESOLVED_ALERTS')}</div>}
            {data.alerts.byRule.map(r => (
              <div className={styles.row} key={r.rule}>
                <span className={styles.rowLabel}>
                  <span className={styles.rowName}>{r.rule}</span>{' '}
                  <span className={styles.rowSub}>{fmtInt(r.n)}</span>
                </span>
                <span className={`${styles.rowVal} ${winCls(r.winRate) ?? ''}`}>{fmtPct(r.winRate)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </CardShell>
  );
}
