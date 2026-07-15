'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useSettings } from '@/lib/settings';
import { DASHBOARD_SECTIONS } from '@/lib/settings';
import { useGrokUsage } from '@/components/GrokUsageProvider';
import UsageRings from '@/components/UsageRings';
import CoinMultiSelect from '@/components/CoinMultiSelect';
import { track } from '@/lib/analytics';
import { COINS } from '@/lib/marketStore';



const TFS    = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'] as const;
const RISK_PRESETS = ['0.25', '0.5', '1', '1.5', '2'];

/* ── Auto-save toast ── */
function SaveToast({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (status === 'saved' || status === 'error') {
      setVisible(true);
      const t = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(t);
    }
    if (status === 'saving') setVisible(true);
  }, [status]);
  if (!visible) return null;
  return (
    <div className={`st-save-toast${status === 'error' ? ' error' : status === 'saving' ? ' saving' : ''}`}>
      {status === 'saving' ? 'Saving…' : status === 'saved' ? '✓ Saved' : '✕ Save failed'}
    </div>
  );
}

/* ── Section card wrapper ── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="st-section">
      <div className="st-section-title">{title}</div>
      {children}
    </div>
  );
}


export default function SettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const { settings, saveStatus, update } = useSettings();
  const { usage }                                                    = useGrokUsage();
  const [tgStatus, setTgStatus] = useState<'loading' | 'configured' | 'not_configured'>('loading');
  const [pushEnabled,  setPushEnabled]  = useState(false);
  const [pushWorking,  setPushWorking]  = useState(false);
  const [testResult,   setTestResult]   = useState<'idle' | 'sent' | 'error'>('idle');

  // Fetch Telegram status on mount
  useEffect(() => {
    fetch('/api/telegram/status').then(r => r.json())
      .then(d => setTgStatus(d.configured ? 'configured' : 'not_configured'))
      .catch(() => setTgStatus('not_configured'));
  }, []);

  // Detect current push subscription state
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    navigator.serviceWorker.ready.then(reg => {
      reg.pushManager.getSubscription().then(sub => setPushEnabled(!!sub));
    }).catch(() => {});
  }, []);

  async function getToken(): Promise<string | null> {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data } = await sb.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function handlePushToggle() {
    if (pushWorking) return;
    setPushWorking(true);
    try {
      if (pushEnabled) {
        // Unsubscribe
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const token = await getToken();
          await fetch('/api/push/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          await sub.unsubscribe();
        }
        setPushEnabled(false);
      } else {
        // Subscribe
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidKey) { alert('Push not configured — VAPID key missing.'); return; }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKey,
        });
        const token = await getToken();
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(sub.toJSON()),
        });
        setPushEnabled(true);
      }
    } catch (e) {
      console.error('Push toggle error:', e);
    } finally {
      setPushWorking(false);
    }
  }

  async function handleTestPush() {
    setTestResult('idle');
    const token = await getToken();
    const res = await fetch('/api/push/test', {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    setTestResult(res.ok ? 'sent' : 'error');
    setTimeout(() => setTestResult('idle'), 3000);
  }

  // Show limited page (Appearance only) when not signed in
  if (!authLoading && !user) {
    const LOCKED = ['Account', 'My Watchlist', 'Trading Profile', 'AI Arena Defaults', 'Notification Thresholds', 'Dashboard Sections', 'Telegram Alerts'];
    return (
      <div className="st-page">
        <div className="st-header"><div className="st-header-title">Settings</div></div>

        <Section title="Appearance">
          <div className="st-field">
            <label className="st-field-label">Theme</label>
            <div className="st-chip-row">
              {(['dark', 'light'] as const).map(t => (
                <button
                  key={t}
                  className={`st-chip${(typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === t) ? ' on' : ''}`}
                  onClick={() => {
                    document.documentElement.setAttribute('data-theme', t);
                    localStorage.setItem('theme', t);
                    window.dispatchEvent(new Event('theme-change'));
                  }}
                >
                  {t === 'dark' ? 'Dark' : 'Light'}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <div className="st-section">
          <div className="st-section-title">Sign in to continue</div>
          <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 20, opacity: 0.35, pointerEvents: 'none' }}>
            {LOCKED.map(name => (
              <div key={name} style={{
                padding: '9px 0', borderBottom: '0.5px solid var(--bdr)',
                fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
                textTransform: 'uppercase', color: 'var(--txt2)',
              }}>
                {name}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a href="/login?signup=1" style={{
              flex: 1, display: 'block', padding: '9px 0', borderRadius: 'var(--radius-card)',
              background: 'var(--accent-bg)', border: '0.5px solid var(--accent-bdr)', color: 'var(--accent)',
              fontSize: 12, fontWeight: 700, textAlign: 'center', textDecoration: 'none',
            }}>
              Create free account
            </a>
            <a href="/login" style={{
              flex: 1, display: 'block', padding: '9px 0', borderRadius: 'var(--radius-card)',
              border: '0.5px solid var(--bdr)', color: 'var(--txt2)',
              fontSize: 12, fontWeight: 600, textAlign: 'center', textDecoration: 'none',
            }}>
              Sign in
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return <div style={{ padding: '2rem', color: 'var(--txt3)', fontSize: 13 }}>Loading…</div>;
  }

  const num = (v: string | number) => {
    const n = parseFloat(String(v));
    return isNaN(n) ? 0 : n;
  };

  return (
    <div className="st-page">

      <SaveToast status={saveStatus} />

      {/* ── Header ── */}
      <div className="st-header">
        <div className="st-header-title">Settings</div>
      </div>

      {/* ── 1. Account ── */}
      <Section title="Account">
        <div className="st-field">
          <div className="st-field-label">Signed in as</div>
          <div className="st-field-value">{user?.email}</div>
        </div>

        {usage && (
          <div className="st-field">
            <UsageRings usage={usage} />
          </div>
        )}

        <button
          className="st-signout-btn"
          onClick={async () => {
            track.signOut();
            await signOut();
            router.push('/login');
          }}
        >
          Sign Out
        </button>
      </Section>

      {/* ── 2. Watchlist ── */}
      <Section title="My Watchlist">
        <div className="st-desc">Select coins to track in your watchlist feed on the dashboard.</div>
        <CoinMultiSelect
          value={settings.watchlist ?? []}
          onChange={next => update({ watchlist: next })}
        />
      </Section>

      {/* ── 3. Trading Profile ── */}
      <Section title="Trading Profile">
        <div className="st-row">
          <div className="st-field st-field-half">
            <label className="st-field-label">Account Size</label>
            <div className="st-input-wrap">
              <span className="st-affix">$</span>
              <input
                className="st-input"
                aria-label="Account Size"
                type="number"
                min="0"
                placeholder="1000"
                value={settings.account_size || ''}
                onChange={e => update({ account_size: num(e.target.value) })}
              />
            </div>
          </div>
          <div className="st-field st-field-half">
            <label className="st-field-label">Risk Per Trade</label>
            <div className="st-input-wrap">
              <input
                className="st-input"
                aria-label="Risk Per Trade"
                type="number"
                min="0.1"
                max="10"
                step="0.1"
                placeholder="1.5"
                value={settings.risk_pct || ''}
                onChange={e => update({ risk_pct: num(e.target.value) })}
              />
              <span className="st-affix st-suffix">%</span>
            </div>
          </div>
        </div>

        {/* Risk presets */}
        <div className="st-presets">
          {RISK_PRESETS.map(p => (
            <button
              key={p}
              className={`st-preset${String(settings.risk_pct) === p || settings.risk_pct === parseFloat(p) ? ' on' : ''}`}
              onClick={() => update({ risk_pct: parseFloat(p) })}
            >
              {p}%
            </button>
          ))}
        </div>

        {settings.account_size > 0 && settings.risk_pct > 0 && (
          <div className="st-at-risk">
            At risk per trade:{' '}
            <strong style={{ color: '#f87171' }}>
              ${(settings.account_size * settings.risk_pct / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </strong>
          </div>
        )}
      </Section>

      {/* ── 3. AI Arena Defaults ── */}
      <Section title="AI Arena Defaults">
        <div className="st-field">
          <label className="st-field-label">Default Coin</label>
          <select
            className="st-input"
            aria-label="Default Coin"
            value={settings.default_coin}
            onChange={e => update({ default_coin: e.target.value as typeof settings.default_coin })}
          >
            {COINS.map(c => (
              <option key={c} value={c}>{c.toUpperCase()}</option>
            ))}
          </select>
        </div>
        <div className="st-field">
          <label className="st-field-label">Default Timeframe</label>
          <div className="st-chip-row">
            {TFS.map(t => (
              <button
                key={t}
                className={`st-chip${settings.default_tf === t ? ' on' : ''}`}
                onClick={() => update({ default_tf: t })}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* ── 4. Notification Thresholds ── */}
      <Section title="Notification Thresholds">
        <div className="st-desc">Browser push — get alerts even when the tab is closed.</div>

        {/* Push enable/disable toggle */}
        <div className="st-field" style={{ marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div className="st-field-label" style={{ marginBottom: 2 }}>Push Notifications</div>
              <div style={{ fontSize: 11, color: 'var(--txt3)' }}>
                {pushEnabled ? 'Active on this device' : 'Not enabled on this device'}
              </div>
            </div>
            <button
              className={`st-toggle${pushEnabled ? ' on' : ''}`}
              role="switch"
              aria-checked={pushEnabled}
              disabled={pushWorking}
              onClick={handlePushToggle}
              style={{ opacity: pushWorking ? 0.5 : 1 }}
            >
              <span className="st-toggle-thumb" />
            </button>
          </div>
        </div>

        {/* Test notification button — only shown when subscribed */}
        {pushEnabled && (
          <button
            onClick={handleTestPush}
            style={{
              width: '100%', padding: '9px 0', borderRadius: 8, marginBottom: 16,
              background: testResult === 'sent' ? 'rgba(74,222,128,0.1)' : testResult === 'error' ? 'rgba(248,113,113,0.1)' : 'rgba(140,150,255,0.08)',
              border: `0.5px solid ${testResult === 'sent' ? 'rgba(74,222,128,0.3)' : testResult === 'error' ? 'rgba(248,113,113,0.3)' : 'var(--bdr)'}`,
              color: testResult === 'sent' ? 'var(--green)' : testResult === 'error' ? 'var(--red)' : 'var(--txt2)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            {testResult === 'sent' ? 'Notification sent' : testResult === 'error' ? 'Failed — check console' : 'Send test notification'}
          </button>
        )}

        <div style={{ height: 1, background: 'var(--bdr)', margin: '4px 0 16px' }} />

        <div className="st-row">
          <div className="st-field st-field-half">
            <label className="st-field-label">Funding Rate trigger</label>
            <div className="st-input-wrap">
              <input
                className="st-input"
                aria-label="Funding Rate trigger"
                type="number"
                min="0.01"
                max="0.5"
                step="0.01"
                value={settings.fr_threshold}
                onChange={e => update({ fr_threshold: num(e.target.value) })}
              />
              <span className="st-affix st-suffix">%</span>
            </div>
          </div>
        </div>

        <div className="st-row">
          <div className="st-field st-field-half">
            <label className="st-field-label">Extreme Fear below</label>
            <div className="st-input-wrap">
              <input
                className="st-input"
                aria-label="Extreme Fear below"
                type="number"
                min="1"
                max="40"
                value={settings.fng_fear}
                onChange={e => update({ fng_fear: num(e.target.value) })}
              />
            </div>
          </div>
          <div className="st-field st-field-half">
            <label className="st-field-label">Extreme Greed above</label>
            <div className="st-input-wrap">
              <input
                className="st-input"
                aria-label="Extreme Greed above"
                type="number"
                min="60"
                max="99"
                value={settings.fng_greed}
                onChange={e => update({ fng_greed: num(e.target.value) })}
              />
            </div>
          </div>
        </div>

        <div className="st-row">
          <div className="st-field st-field-half">
            <label className="st-field-label">RSI 1h overbought</label>
            <div className="st-input-wrap">
              <input
                className="st-input"
                aria-label="RSI 1h overbought"
                type="number"
                min="60"
                max="90"
                value={settings.rsi_ob}
                onChange={e => update({ rsi_ob: num(e.target.value) })}
              />
            </div>
          </div>
          <div className="st-field st-field-half">
            <label className="st-field-label">RSI 1h oversold</label>
            <div className="st-input-wrap">
              <input
                className="st-input"
                aria-label="RSI 1h oversold"
                type="number"
                min="10"
                max="40"
                value={settings.rsi_os}
                onChange={e => update({ rsi_os: num(e.target.value) })}
              />
            </div>
          </div>
        </div>

        <div className="st-note">
          Telegram server alerts use fixed defaults — threshold changes apply to browser push only.
        </div>
      </Section>

      {/* ── 5. Dashboard Sections ── */}
      <Section title="Dashboard Sections">
        <div className="st-desc">Toggle off to hide a section from the dashboard.</div>
        <div className="st-checkbox-grid">
          {DASHBOARD_SECTIONS.map(({ id, label }) => {
            const visible = !settings.hidden_sections.includes(id);
            return (
              <label key={id} className="st-checkbox-item">
                <span className="st-toggle-label">{label}</span>
                <button
                  role="switch"
                  aria-checked={visible}
                  className={`st-toggle${visible ? ' on' : ''}`}
                  onClick={() => {
                    const next = visible
                      ? [...settings.hidden_sections, id]
                      : settings.hidden_sections.filter(s => s !== id);
                    update({ hidden_sections: next });
                  }}
                >
                  <span className="st-toggle-thumb" />
                </button>
              </label>
            );
          })}
        </div>
      </Section>

      {/* ── 6. Appearance ── */}
      <Section title="Appearance">
        <div className="st-field">
          <label className="st-field-label">Theme</label>
          <div className="st-chip-row">
            {(['dark', 'light'] as const).map(t => (
              <button
                key={t}
                className={`st-chip${(typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === t) ? ' on' : ''}`}
                onClick={() => {
                  document.documentElement.setAttribute('data-theme', t);
                  localStorage.setItem('theme', t);
                  // Force re-render so the active state updates
                  window.dispatchEvent(new Event('theme-change'));
                }}
              >
                {t === 'dark' ? 'Dark' : 'Light'}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* ── 7. Telegram Alerts ── */}
      <Section title="Telegram Alerts">
        <div className="st-field">
          <div className="st-field-label">Status</div>
          <div className="st-tg-status">
            <span
              className="st-tg-dot"
              style={{ background: tgStatus === 'configured' ? 'var(--green)' : 'var(--txt3)' }}
            />
            {tgStatus === 'loading'
              ? 'Checking…'
              : tgStatus === 'configured'
              ? 'Configured'
              : 'Not configured'}
          </div>
        </div>
        <Link href="/alerts" className="st-link-btn">
          {tgStatus === 'configured' ? 'Manage alerts →' : 'Set up Telegram →'}
        </Link>
      </Section>

    </div>
  );
}
