'use client';
import { useEffect, useState } from 'react';
import { useAdminResource, adminFetch } from '../_client';
import styles from '../ops.module.css';

interface ConfigData {
  maintenance_mode: { enabled: boolean };
  announcement_banner: { text: string; link: string | null };
}

export default function ConfigPage() {
  const { data, error, loading, reload } = useAdminResource<ConfigData>('/api/ops/config');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [bannerText, setBannerText] = useState('');
  const [bannerLink, setBannerLink] = useState('');

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
            <p className={styles.note}>
              Shown above the app on every page (dismissible per-visitor). Empty text = hidden.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input className={styles.searchInput} type="text" placeholder="Banner text (empty = hidden)"
                value={bannerText} onChange={e => setBannerText(e.target.value)} />
              <input className={styles.searchInput} type="text" placeholder="Link (optional, e.g. /about)"
                value={bannerLink} onChange={e => setBannerLink(e.target.value)} />
              <button
                className={styles.loginBtn}
                style={{ marginTop: 0, alignSelf: 'flex-start' }}
                disabled={busy}
                onClick={() => save('announcement_banner', { text: bannerText.trim(), link: bannerLink.trim() || null })}
              >
                {busy ? 'Saving…' : 'Save banner'}
              </button>
            </div>
          </section>

          {msg && <p className={styles.note}>{msg}</p>}
        </>
      )}
    </div>
  );
}
