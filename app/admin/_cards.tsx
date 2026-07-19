'use client';
import { useAdminResource, fmtInt, fmtPct, fmtAgo } from './_client';
import styles from './admin.module.css';

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
  return (
    <section className={`${styles.card} ${span2 ? styles.cardSpan2 : ''}`}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{title}</span>
        {meta ? <span className={styles.cardMeta}>{meta}</span>
              : onReload ? <button className={styles.reload} onClick={onReload} aria-label="Reload">↻</button> : null}
      </div>
      {loading && !hasData && <div className={styles.loadingText}>Loading…</div>}
      {error && <div className={styles.err}>{error === 'HTTP 403' ? 'Not authorized' : error}</div>}
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
  const { data, error, loading, reload } = useAdminResource<Overview>('/api/admin/overview');
  const proRate = data && data.totalUsers ? Math.round((data.proUsers / data.totalUsers) * 100) : null;
  return (
    <CardShell title="Users & revenue" onReload={reload} loading={loading} error={error} hasData={!!data} span2>
      {data && (
        <div className={styles.stats}>
          <Stat label="Total users" val={fmtInt(data.totalUsers)} />
          <Stat label="Pro" val={fmtInt(data.proUsers)} cls={styles.accent} sub={`${fmtInt(data.activePaying)} paying`} />
          <Stat label="Free" val={fmtInt(data.freeUsers)} />
          <Stat label="New · 7d" val={fmtInt(data.signups7d)} sub={`${fmtInt(data.signups30d)} in 30d`} />
          <Stat label="Active · 7d" val={fmtInt(data.active7d)} sub={`${fmtInt(data.active30d)} in 30d`} />
          <Stat label="Pro rate" val={proRate == null ? '-' : `${proRate}%`} />
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
  const { data, error, loading, reload } = useAdminResource<CronsData>('/api/admin/crons');
  return (
    <CardShell title="Cron health" onReload={reload} loading={loading} error={error} hasData={!!data}>
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
            Scanner &amp; tracker show last activity, not last run - a quiet market fires nothing.
            The resolver&apos;s overdue count is the true health signal.
          </p>
        </>
      )}
    </CardShell>
  );
}

// ── AI cost (Grok) ─────────────────────────────────────────────────────────
interface AiCost {
  system: { total24h: number; total7d: number; perDay: { day: string; count: number }[]; byType: { type: string; count: number }[] };
  topUsers: { userId: string; email: string | null; total: number }[];
  generatedAt: string;
}

export function AiCostCard() {
  const { data, error, loading, reload } = useAdminResource<AiCost>('/api/admin/ai-cost');
  const max = data ? Math.max(1, ...data.system.perDay.map(d => d.count)) : 1;
  return (
    <CardShell title="AI cost · Grok" onReload={reload} loading={loading} error={error} hasData={!!data}>
      {data && (
        <>
          <div className={styles.stats} style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
            <Stat label="Cron calls · 24h" val={fmtInt(data.system.total24h)} />
            <Stat label="Cron calls · 7d" val={fmtInt(data.system.total7d)} />
          </div>
          <div className={styles.miniBars} aria-hidden>
            {data.system.perDay.map(d => (
              <div key={d.day} className={styles.bar}
                style={{ height: `${Math.round((d.count / max) * 100)}%` }}
                title={`${d.day}: ${d.count}`} />
            ))}
          </div>
          <div className={styles.rows} style={{ marginTop: 12 }}>
            {data.topUsers.length === 0 && <div className={styles.rowSub}>No per-user AI usage in the last 7 days.</div>}
            {data.topUsers.map(u => (
              <div className={styles.row} key={u.userId}>
                <span className={styles.rowLabel}>
                  <span className={styles.rowName}>{u.email ?? `${u.userId.slice(0, 8)}…`}</span>
                </span>
                <span className={styles.rowVal}>{fmtInt(u.total)}</span>
              </div>
            ))}
          </div>
          <p className={styles.note}>14-day system call volume; top AI users last 7d (deep + quick + chat + search + briefing).</p>
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
  const { data, error, loading, reload } = useAdminResource<Accuracy>('/api/admin/accuracy');
  const avgR = data?.liveSignals.avgR ?? null;
  return (
    <CardShell title="Signal accuracy" onReload={reload} loading={loading} error={error} hasData={!!data}>
      {data && (
        <>
          <div className={styles.stats} style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            <Stat label="Alert 24h win" val={fmtPct(data.alerts.overall.winRate)}
              sub={`${fmtInt(data.alerts.overall.n)} resolved`} cls={winCls(data.alerts.overall.winRate)} />
            <Stat label="Live sig win" val={fmtPct(data.liveSignals.winRate)}
              sub={`${fmtInt(data.liveSignals.n)} resolved`} cls={winCls(data.liveSignals.winRate)} />
            <Stat label="Avg R" val={avgR == null ? '-' : avgR.toFixed(2)}
              cls={avgR == null ? undefined : avgR > 0 ? styles.good : styles.bad} />
          </div>
          <div className={styles.rows} style={{ marginTop: 12 }}>
            {data.alerts.byRule.length === 0 && <div className={styles.rowSub}>No resolved alerts yet.</div>}
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
