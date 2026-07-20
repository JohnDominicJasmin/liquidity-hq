'use client';
import { useEffect, useState } from 'react';
import { useAdminResource, adminFetch, fmtAgo, fmtIn } from '../_client';
import styles from '../ops.module.css';

interface BannerValue { text: string; link: string | null; expiresAt: string | null }
interface BannerHistoryItem { value: BannerValue; actor_email: string; created_at: string }

interface ConfigData {
  maintenance_mode: { enabled: boolean };
  announcement_banner: BannerValue;
  banner_history: BannerHistoryItem[];
}

// value in hours, '' = no expiry
const DURATION_OPTIONS: { value: string; label: string }[] = [
  { value: '',   label: 'No expiry' },
  { value: '1',  label: '1 hour' },
  { value: '6',  label: '6 hours' },
  { value: '24', label: '24 hours' },
  { value: '72', label: '3 days' },
  { value: '168', label: '7 days' },
];

type Status = 'live' | 'expired' | 'off' | 'replaced';

function bannerStatus(v: BannerValue): 'live' | 'expired' | 'off' {
  if (!v.text) return 'off';
  if (v.expiresAt && new Date(v.expiresAt).getTime() <= Date.now()) return 'expired';
  return 'live';
}

const STATUS_LABEL: Record<Status, string> = {
  live: 'Live', expired: 'Expired', off: 'Off', replaced: 'Replaced',
};

function StatusBadge({ status }: { status: Status }) {
  const cls = status === 'live' ? styles.badgeGood : status === 'expired' ? styles.badgeBad : styles.badge;
  return <span className={`${styles.badge} ${cls}`}>{STATUS_LABEL[status]}</span>;
}

export default function ConfigPage() {
  const { data, error, loading, reload } = useAdminResource<ConfigData>('/api/ops/config');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [bannerText, setBannerText] = useState('');
  const [bannerLink, setBannerLink] = useState('');
  const [durationHrs, setDurationHrs] = useState('');

  // Forces expiresAt-derived badges (live -> expired) to update on their own
  // while an admin is sitting on this page, without needing a manual reload.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!data) return;
    setBannerText(data.announcement_banner.text);
    setBannerLink(data.announcement_banner.link ?? '');
  }, [data]);

  async function save(key: 'maintenance_mode' | 'announcement_banner', value: unknown) {
    setBusy(true);
    setMsg(null);
    const res = await adminFetch('/api/ops/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
    setBusy(false);
    if (!res || !res.ok) {
      const j = res ? await res.json().catch(() => ({})) : {};
      setMsg(j.error ?? 'Save failed.');
      return;
    }
    setMsg('Saved. Live app picks it up within ~15s.');
    reload();
  }

  function reuse(v: BannerValue) {
    setBannerText(v.text);
    setBannerLink(v.link ?? '');
    setDurationHrs('');
    setMsg(null);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  const currentStatus = data ? bannerStatus(data.announcement_banner) : null;

  return (
    <div>
      <div className={styles.cardHead} style={{ marginBottom: 14 }}>
        <span className={styles.cardTitle}>App config</span>
      </div>

      {loading && !data && <div className={styles.loadingText}>Loading…</div>}
      {error && <div className={styles.err}>{error === 'HTTP 403' ? 'Owner only' : error}</div>}

      {data && (
        <>
          <section className={styles.card} style={{ marginBottom: 16 }}>
            <div className={styles.cardHead}>
              <span className={styles.cardTitle}>Maintenance mode</span>
              {data.maintenance_mode.enabled && <span className={`${styles.badge} ${styles.badgeBad}`}>ON</span>}
            </div>
            <p className={styles.note}>
              When on, every page except /ops shows a maintenance screen - the whole app is closed to
              signed-in users too. /ops stays reachable so you can turn it back off.
            </p>
            <button
              className={styles.pagerBtn}
              disabled={busy}
              onClick={() => save('maintenance_mode', { enabled: !data.maintenance_mode.enabled })}
            >
              {busy ? 'Working…' : data.maintenance_mode.enabled ? 'Turn off maintenance mode' : 'Turn on maintenance mode'}
            </button>
          </section>

          <section className={styles.card} style={{ marginBottom: 16 }}>
            <div className={styles.cardHead}><span className={styles.cardTitle}>Announcement banner</span></div>

            {/* Current status - the one thing an owner glancing at this page needs first. */}
            <div className={styles.row} style={{ marginBottom: 14 }}>
              <span className={styles.rowLabel}>
                {currentStatus && <StatusBadge status={currentStatus} />}
                <span className={styles.rowName} style={{ marginLeft: 8 }}>
                  {data.announcement_banner.text || 'No banner set'}
                </span>
                <br />
                <span className={styles.rowSub}>
                  {currentStatus === 'live' && (data.announcement_banner.expiresAt
                    ? `Visible to everyone, auto-hides ${fmtIn(data.announcement_banner.expiresAt)} (${new Date(data.announcement_banner.expiresAt).toLocaleString()})`
                    : 'Visible to everyone, no expiry set')}
                  {currentStatus === 'expired' && `Expired ${new Date(data.announcement_banner.expiresAt!).toLocaleString()} - no longer shown`}
                  {currentStatus === 'off' && 'Nothing shown on the live app'}
                </span>
              </span>
              {currentStatus !== 'off' && (
                <button className={styles.pagerBtn} disabled={busy}
                  onClick={() => save('announcement_banner', { text: '', link: null, expiresAt: null })}>
                  Clear
                </button>
              )}
            </div>

            <p className={styles.note}>
              Shown above the app on every page (dismissible per-visitor). Empty text = hidden.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input className={styles.searchInput} type="text" placeholder="Banner text (empty = hidden)"
                value={bannerText} onChange={e => setBannerText(e.target.value)} />
              <input className={styles.searchInput} type="text" placeholder="Link (optional, e.g. /about)"
                value={bannerLink} onChange={e => setBannerLink(e.target.value)} />
              <select className={styles.searchInput} value={durationHrs} onChange={e => setDurationHrs(e.target.value)}>
                {DURATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button
                className={styles.loginBtn}
                style={{ marginTop: 0, alignSelf: 'flex-start' }}
                disabled={busy}
                onClick={() => save('announcement_banner', {
                  text: bannerText.trim(),
                  link: bannerLink.trim() || null,
                  expiresAt: durationHrs ? new Date(Date.now() + Number(durationHrs) * 3_600_000).toISOString() : null,
                })}
              >
                {busy ? 'Saving…' : 'Post banner'}
              </button>
            </div>

            {data.banner_history.length > 0 && (
              <>
                <div className={styles.cardHead} style={{ marginTop: 22 }}>
                  <span className={styles.cardTitle}>History</span>
                </div>
                <div className={styles.rows}>
                  {data.banner_history.map((h, i) => {
                    const status: Status = i === 0 ? bannerStatus(h.value) : (h.value.text ? 'replaced' : 'off');
                    return (
                      <div className={styles.row} key={h.created_at}>
                        <span className={styles.rowLabel}>
                          <StatusBadge status={status} />
                          <span className={styles.rowName} style={{ marginLeft: 8 }}>
                            {h.value.text || '(cleared)'}
                          </span>
                          <br />
                          <span className={styles.rowSub}>
                            {fmtAgo(h.created_at)} by {h.actor_email}
                            {h.value.expiresAt && status !== 'off' ? ` · expiry ${new Date(h.value.expiresAt).toLocaleString()}` : ''}
                          </span>
                        </span>
                        {h.value.text && (
                          <button className={styles.pagerBtn} disabled={busy} onClick={() => reuse(h.value)}>
                            Reuse
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          {msg && <p className={styles.note}>{msg}</p>}
        </>
      )}
    </div>
  );
}
