'use client';
import { useEffect, useState } from 'react';
import { useAdminResource, adminFetch, fmtAgo, fmtIn } from '../_client';
import styles from '../ops.module.css';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

interface BannerValue { text: string; link: string | null; expiresAt: string | null }
interface BannerHistoryItem { value: BannerValue; actor_email: string; created_at: string }

interface FeatureFlags { grok: boolean; telegram: boolean; signups: boolean }

interface ConfigData {
  maintenance_mode: { enabled: boolean };
  announcement_banner: BannerValue;
  feature_flags: FeatureFlags;
  banner_history: BannerHistoryItem[];
}

const FEATURE_LABEL_KEYS: Record<keyof FeatureFlags, LabelKey> = {
  grok: 'OPS_CONFIG_FEATURE_GROK',
  telegram: 'OPS_CONFIG_FEATURE_TELEGRAM',
  signups: 'OPS_CONFIG_FEATURE_SIGNUPS',
};

// value in hours, '' = no expiry
const DURATION_OPTIONS: { value: string; labelKey: LabelKey }[] = [
  { value: '',   labelKey: 'OPS_CONFIG_DURATION_NO_EXPIRY' },
  { value: '1',  labelKey: 'OPS_CONFIG_DURATION_1H' },
  { value: '6',  labelKey: 'OPS_CONFIG_DURATION_6H' },
  { value: '24', labelKey: 'OPS_CONFIG_DURATION_24H' },
  { value: '72', labelKey: 'OPS_CONFIG_DURATION_3D' },
  { value: '168', labelKey: 'OPS_CONFIG_DURATION_7D' },
];

type Status = 'live' | 'expired' | 'off' | 'replaced';

function bannerStatus(v: BannerValue): 'live' | 'expired' | 'off' {
  if (!v.text) return 'off';
  if (v.expiresAt && new Date(v.expiresAt).getTime() <= Date.now()) return 'expired';
  return 'live';
}

const STATUS_LABEL_KEYS: Record<Status, LabelKey> = {
  live: 'OPS_CONFIG_STATUS_LIVE', expired: 'OPS_CONFIG_STATUS_EXPIRED',
  off: 'OPS_CONFIG_STATUS_OFF', replaced: 'OPS_CONFIG_STATUS_REPLACED',
};

function StatusBadge({ status }: { status: Status }) {
  const { t } = useLabels();
  const cls = status === 'live' ? styles.badgeGood : status === 'expired' ? styles.badgeBad : styles.badge;
  return <span className={`${styles.badge} ${cls}`}>{t(STATUS_LABEL_KEYS[status])}</span>;
}

export default function ConfigPage() {
  const { t } = useLabels();
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
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!data) return;
    setBannerText(data.announcement_banner.text);
    setBannerLink(data.announcement_banner.link ?? '');
  }, [data]);

  async function save(key: 'maintenance_mode' | 'announcement_banner' | 'feature_flags', value: unknown) {
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
      setMsg(j.error ?? t('OPS_CONFIG_SAVE_FAILED'));
      return;
    }
    setMsg(t('OPS_CONFIG_SAVE_SUCCESS'));
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
        <span className={styles.cardTitle}>{t('OPS_CONFIG_TITLE')}</span>
      </div>

      {loading && !data && <div className={styles.loadingText}>{t('OPS_CONFIG_LOADING')}</div>}
      {error && <div className={styles.err}>{error === 'HTTP 403' ? t('OPS_CONFIG_ERR_OWNER_ONLY') : error}</div>}

      {data && (
        <>
          <section className={styles.card} style={{ marginBottom: 16 }}>
            <div className={styles.cardHead}>
              <span className={styles.cardTitle}>{t('OPS_CONFIG_MAINTENANCE_TITLE')}</span>
              {data.maintenance_mode.enabled && <span className={`${styles.badge} ${styles.badgeBad}`}>{t('OPS_CONFIG_MAINTENANCE_ON_BADGE')}</span>}
            </div>
            <p className={styles.note}>
              {t('OPS_CONFIG_MAINTENANCE_NOTE')}
            </p>
            <button
              className={styles.pagerBtn}
              disabled={busy}
              onClick={() => save('maintenance_mode', { enabled: !data.maintenance_mode.enabled })}
            >
              {busy ? t('OPS_CONFIG_WORKING') : data.maintenance_mode.enabled ? t('OPS_CONFIG_TURN_OFF_MAINTENANCE') : t('OPS_CONFIG_TURN_ON_MAINTENANCE')}
            </button>
          </section>

          <section className={styles.card} style={{ marginBottom: 16 }}>
            <div className={styles.cardHead}><span className={styles.cardTitle}>{t('OPS_CONFIG_FEATURE_FLAGS_TITLE')}</span></div>
            <p className={styles.note}>
              {t('OPS_CONFIG_FEATURE_FLAGS_NOTE')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
              {(Object.keys(FEATURE_LABEL_KEYS) as (keyof FeatureFlags)[]).map(key => {
                const on = data.feature_flags[key];
                return (
                  <div className={styles.row} key={key}>
                    <span className={styles.rowLabel}>
                      {!on && <span className={`${styles.badge} ${styles.badgeBad}`}>{t('OPS_CONFIG_OFF_BADGE')}</span>}
                      <span className={styles.rowName} style={{ marginLeft: on ? 0 : 8 }}>{t(FEATURE_LABEL_KEYS[key])}</span>
                    </span>
                    <button
                      className={styles.pagerBtn}
                      disabled={busy}
                      onClick={() => save('feature_flags', { ...data.feature_flags, [key]: !on })}
                    >
                      {busy ? t('OPS_CONFIG_WORKING') : on ? t('OPS_CONFIG_TURN_OFF') : t('OPS_CONFIG_TURN_ON')}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className={styles.card} style={{ marginBottom: 16 }}>
            <div className={styles.cardHead}><span className={styles.cardTitle}>{t('OPS_CONFIG_BANNER_TITLE')}</span></div>

            {/* Current status - the one thing an owner glancing at this page needs first. */}
            <div className={styles.row} style={{ marginBottom: 14 }}>
              <span className={styles.rowLabel}>
                {currentStatus && <StatusBadge status={currentStatus} />}
                <span className={styles.rowName} style={{ marginLeft: 8 }}>
                  {data.announcement_banner.text || t('OPS_CONFIG_NO_BANNER_SET')}
                </span>
                <br />
                <span className={styles.rowSub}>
                  {currentStatus === 'live' && (data.announcement_banner.expiresAt
                    ? t('OPS_CONFIG_BANNER_VISIBLE_EXPIRY', { expiry: fmtIn(data.announcement_banner.expiresAt), date: new Date(data.announcement_banner.expiresAt).toLocaleString() })
                    : t('OPS_CONFIG_BANNER_VISIBLE_NO_EXPIRY'))}
                  {currentStatus === 'expired' && t('OPS_CONFIG_BANNER_EXPIRED', { date: new Date(data.announcement_banner.expiresAt!).toLocaleString() })}
                  {currentStatus === 'off' && t('OPS_CONFIG_BANNER_NOTHING_SHOWN')}
                </span>
              </span>
              {currentStatus !== 'off' && (
                <button className={styles.pagerBtn} disabled={busy}
                  onClick={() => save('announcement_banner', { text: '', link: null, expiresAt: null })}>
                  {t('OPS_CONFIG_CLEAR_BUTTON')}
                </button>
              )}
            </div>

            <p className={styles.note}>
              {t('OPS_CONFIG_BANNER_NOTE')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input className={styles.searchInput} type="text" placeholder={t('OPS_CONFIG_BANNER_TEXT_PLACEHOLDER')}
                value={bannerText} onChange={e => setBannerText(e.target.value)} />
              <input className={styles.searchInput} type="text" placeholder={t('OPS_CONFIG_BANNER_LINK_PLACEHOLDER')}
                value={bannerLink} onChange={e => setBannerLink(e.target.value)} />
              <select className={styles.searchInput} value={durationHrs} onChange={e => setDurationHrs(e.target.value)}>
                {DURATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
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
                {busy ? t('OPS_CONFIG_SAVING') : t('OPS_CONFIG_POST_BANNER')}
              </button>
            </div>

            {data.banner_history.length > 0 && (
              <>
                <div className={styles.cardHead} style={{ marginTop: 22 }}>
                  <span className={styles.cardTitle}>{t('OPS_CONFIG_HISTORY_TITLE')}</span>
                </div>
                <div className={styles.rows}>
                  {data.banner_history.map((h, i) => {
                    const status: Status = i === 0 ? bannerStatus(h.value) : (h.value.text ? 'replaced' : 'off');
                    return (
                      <div className={styles.row} key={h.created_at}>
                        <span className={styles.rowLabel}>
                          <StatusBadge status={status} />
                          <span className={styles.rowName} style={{ marginLeft: 8 }}>
                            {h.value.text || t('OPS_CONFIG_CLEARED')}
                          </span>
                          <br />
                          <span className={styles.rowSub}>
                            {t('OPS_CONFIG_HISTORY_BY', { ago: fmtAgo(h.created_at), email: h.actor_email })}
                            {h.value.expiresAt && status !== 'off' ? t('OPS_CONFIG_HISTORY_EXPIRY_SUFFIX', { date: new Date(h.value.expiresAt).toLocaleString() }) : ''}
                          </span>
                        </span>
                        {h.value.text && (
                          <button className={styles.pagerBtn} disabled={busy} onClick={() => reuse(h.value)}>
                            {t('OPS_CONFIG_REUSE_BUTTON')}
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
