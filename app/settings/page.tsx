'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useSettings } from '@/lib/settings';
import { DASHBOARD_SECTIONS } from '@/lib/settings';
import { fetchGrokUsage, GrokUsageInfo } from '@/lib/grok';
import { track } from '@/lib/analytics';
import { COINS } from '@/lib/marketStore';

const TFS    = ['15m', '1h', '4h', '1d'] as const;
const RISK_PRESETS = ['0.25', '0.5', '1', '1.5', '2'];

/* ── Small save indicator ── */
function SaveIndicator({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (status === 'idle') return null;
  const map = {
    saving: { txt: 'Saving…',   col: 'var(--txt3)' },
    saved:  { txt: 'Saved ✓',   col: 'var(--green)' },
    error:  { txt: 'Save failed', col: 'var(--red)' },
  } as const;
  const { txt, col } = map[status];
  return (
    <span style={{ fontSize: 11, color: col, fontWeight: 600, marginLeft: 8 }}>{txt}</span>
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
  const [usage, setUsage] = useState<GrokUsageInfo | null>(null);
  const [tgStatus, setTgStatus] = useState<'loading' | 'configured' | 'not_configured'>('loading');

  // Fetch Grok usage + Telegram status on mount
  useEffect(() => {
    fetchGrokUsage().then(u => { if (u) setUsage(u); });
    fetch('/api/telegram/status').then(r => r.json())
      .then(d => setTgStatus(d.configured ? 'configured' : 'not_configured'))
      .catch(() => setTgStatus('not_configured'));
  }, []);

  // Redirect to login if not signed in
  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [user, authLoading, router]);

  if (authLoading || !user) {
    return <div style={{ padding: '2rem', color: 'var(--txt3)', fontSize: 13 }}>Loading…</div>;
  }

  const num = (v: string | number) => {
    const n = parseFloat(String(v));
    return isNaN(n) ? 0 : n;
  };

  return (
    <div className="st-page">

      {/* ── Header ── */}
      <div className="st-header">
        <div className="st-header-title">Settings</div>
        <SaveIndicator status={saveStatus} />
      </div>

      {/* ── 1. Account ── */}
      <Section title="Account">
        <div className="st-field">
          <div className="st-field-label">Signed in as</div>
          <div className="st-field-value">{user.email}</div>
        </div>

        {usage && (
          <div className="st-field" style={{ gap: 8 }}>
            <div className="st-field-label">AI Arena usage today</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
              <MiniUsageBar
                label="⚡ Quick"
                used={usage.quick_used}
                limit={usage.quick_limit}
                color={usage.quick_used / usage.quick_limit >= 0.9 ? '#f87171' : usage.quick_used / usage.quick_limit >= 0.7 ? '#fbbf24' : '#34d399'}
              />
              <MiniUsageBar
                label="🔬 Deep"
                used={usage.deep_used}
                limit={usage.deep_limit}
                color={usage.deep_used / usage.deep_limit >= 0.9 ? '#f87171' : usage.deep_used / usage.deep_limit >= 0.7 ? '#fbbf24' : '#b8aeff'}
              />
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
      <Section title="Trading Profile">
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
      <Section title="AI Arena Defaults">
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
      <Section title="Notification Thresholds">
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
      <Section title="Dashboard Sections">
        <div className="st-desc">Uncheck to hide a section from the dashboard.</div>
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
                {t === 'dark' ? '◑ Dark' : '☀ Light'}
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
