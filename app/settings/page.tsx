'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useSettings } from '@/lib/settings';
import { DASHBOARD_SECTIONS } from '@/lib/settings';
import { useGrokUsage } from '@/components/GrokUsageProvider';
import { track } from '@/lib/analytics';
import { COINS } from '@/lib/marketStore';

const TFS    = ['15m', '1h', '4h', '1d'] as const;
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
function Section({ title, icon, children }: { title: string; icon?: string; children: React.ReactNode }) {
  return (
    <div className="st-section">
      <div className="st-section-title">
        {icon && <span className="st-section-icon">{icon}</span>}
        {title}
      </div>
      {children}
    </div>
  );
}

/* ── Usage mini-bar (reused from Arena) ── */
function MiniUsageBar({ label, used, limit, color }: { label: string; used: number; limit: number; color: string }) {
  const pct = Math.min((used / limit) * 100, 100);
  return (
    <div className="st-usage-row">
      <span className="st-usage-label">{label}</span>
      <div className="st-usage-track"><div className="st-usage-fill" style={{ width: pct + '%', background: color }} /></div>
      <span className="st-usage-count" style={{ color }}>{used}<span style={{ color: 'var(--txt3)', fontWeight: 400 }}>/{limit}</span></span>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const { settings, saveStatus, update } = useSettings();
  const { usage }                                                    = useGrokUsage();
  const [tgStatus, setTgStatus] = useState<'loading' | 'configured' | 'not_configured'>('loading');

  // Fetch Telegram status on mount
  useEffect(() => {
    fetch('/api/telegram/status').then(r => r.json())
      .then(d => setTgStatus(d.configured ? 'configured' : 'not_configured'))
      .catch(() => setTgStatus('not_configured'));
  }, []);

  // Show limited page (Appearance only) when not signed in
  if (!authLoading && !user) {
    return (
      <div className="st-page">
        <div className="st-header"><div className="st-header-title">Settings</div></div>
        <Section title="Appearance" icon="🎨">
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
                  {t === 'dark' ? '◑ Dark' : '☀ Light'}
                </button>
              ))}
            </div>
          </div>
        </Section>
        <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--txt3)', fontSize: 12 }}>
          <a href="/login" style={{ color: 'var(--purple)', fontWeight: 600 }}>Sign in</a> to access full settings
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
      <Section title="Account" icon="👤">
        <div className="st-field">
          <div className="st-field-label">Signed in as</div>
          <div className="st-field-value">{user?.email}</div>
        </div>

        {usage && (
          <div className="st-field" style={{ gap: 8 }}>
            <div className="st-field-label">AI usage today</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
              {[
                { label: '⚡ Quick',    used: usage.quick_used,    limit: usage.quick_limit,    base: '#34d399' },
                { label: '🔬 Deep',     used: usage.deep_used,     limit: usage.deep_limit,     base: '#b8aeff' },
                { label: '💬 Chat',     used: usage.chat_used,     limit: usage.chat_limit,     base: '#60a5fa' },
                { label: '🌐 Search',   used: usage.search_used,   limit: usage.search_limit,   base: '#a78bfa' },
                { label: '📋 Briefing', used: usage.briefing_used, limit: usage.briefing_limit, base: '#f59e0b' },
              ].map(({ label, used, limit, base }) => (
                <MiniUsageBar
                  key={label}
                  label={label}
                  used={used}
                  limit={limit}
                  color={used / limit >= 0.9 ? '#f87171' : used / limit >= 0.7 ? '#fbbf24' : base}
                />
              ))}
              <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>Resets midnight UTC</div>
            </div>
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

      {/* ── 2. Trading Profile ── */}
      <Section title="Trading Profile" icon="📊">
        <div className="st-row">
          <div className="st-field st-field-half">
            <label className="st-field-label">Account Size</label>
            <div className="st-input-wrap">
              <span className="st-affix">$</span>
              <input
                className="st-input"
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
      <Section title="AI Arena Defaults" icon="⚡">
        <div className="st-field">
          <label className="st-field-label">Default Coin</label>
          <div className="st-chip-row">
            {COINS.map(c => (
              <button
                key={c}
                className={`st-chip${settings.default_coin === c ? ' on' : ''}`}
                onClick={() => update({ default_coin: c })}
              >
                {c.toUpperCase()}
              </button>
            ))}
          </div>
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
      <Section title="Notification Thresholds" icon="🔔">
        <div className="st-desc">Controls browser push alerts in AI Arena.</div>

        <div className="st-row">
          <div className="st-field st-field-half">
            <label className="st-field-label">Funding Rate trigger</label>
            <div className="st-input-wrap">
              <input
                className="st-input"
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
      <Section title="Dashboard Sections" icon="📋">
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
      <Section title="Appearance" icon="🎨">
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
                {t === 'dark' ? '◑ Dark' : '☀ Light'}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* ── 7. Telegram Alerts ── */}
      <Section title="Telegram Alerts" icon="📱">
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
