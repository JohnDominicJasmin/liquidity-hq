'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useSettings } from '@/lib/settings';
import { useGrokUsage } from '@/components/GrokUsageProvider';
import UsageRings from '@/components/UsageRings';
import CoinMultiSelect from '@/components/CoinMultiSelect';
import ThemeChips from '@/components/ThemeChips';
import { track } from '@/lib/analytics';
import { COINS } from '@/lib/marketStore';
import LoadingState from '@/components/LoadingState';
import { SkeletonBar } from '@/components/Skeleton';
import LanguageSelect from '@/components/LanguageSelect';
import { useLabels } from '@/lib/labels';



const TFS    = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'] as const;
const RISK_PRESETS = ['0.25', '0.5', '1', '1.5', '2'];

/* ── Auto-save toast ── */
function SaveToast({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  const { t } = useLabels();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (status === 'saved' || status === 'error') {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(timer);
    }
    if (status === 'saving') setVisible(true);
  }, [status]);
  if (!visible) return null;
  return (
    <div className={`st-save-toast${status === 'error' ? ' error' : status === 'saving' ? ' saving' : ''}`}>
      {status === 'saving' ? t('SETTINGS_STATUS_SAVING') : status === 'saved' ? t('SETTINGS_STATUS_SAVED') : t('SETTINGS_STATUS_FAILED')}
    </div>
  );
}

/* ── Section card wrapper ── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="st-section">
      <h2 className="st-section-title">{title}</h2>
      {children}
    </div>
  );
}


export default function SettingsPage() {
  const router = useRouter();
  const { t } = useLabels();
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
        if (!vapidKey) { alert('Push not configured - VAPID key missing.'); return; }
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
    const LOCKED = [
      t('SETTINGS_SECTION_ACCOUNT'), t('SETTINGS_SECTION_WATCHLIST'), t('SETTINGS_SECTION_TRADING_PROFILE'),
      t('SETTINGS_SECTION_ARENA_DEFAULTS'), t('SETTINGS_SECTION_NOTIFICATIONS'), 'Dashboard Sections',
      t('SETTINGS_SECTION_TELEGRAM'),
    ];
    return (
      <div className="st-page">
        <div className="st-header"><h1 className="st-header-title">{t('SETTINGS_PAGE_TITLE')}</h1></div>

        <Section title={t('SETTINGS_SECTION_APPEARANCE')}>
          <div className="st-field">
            <label className="st-field-label">{t('SETTINGS_FIELD_THEME')}</label>
            <ThemeChips />
          </div>
        </Section>

        <div className="st-section">
          <div className="st-section-title">Sign in to continue</div>
          <div className="st-locked-list" style={{ display: 'flex', flexDirection: 'column', marginBottom: 20, pointerEvents: 'none' }}>
            {LOCKED.map(name => (
              <div key={name} style={{
                padding: '9px 0', borderBottom: '0.5px solid var(--bdr)',
                fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.08em',
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
              fontSize: 'var(--fs-caption)', fontWeight: 700, textAlign: 'center', textDecoration: 'none',
            }}>
              Create free account
            </a>
            <a href="/login" style={{
              flex: 1, display: 'block', padding: '9px 0', borderRadius: 'var(--radius-card)',
              border: '0.5px solid var(--bdr)', color: 'var(--txt2)',
              fontSize: 'var(--fs-caption)', fontWeight: 600, textAlign: 'center', textDecoration: 'none',
            }}>
              Sign in
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return <LoadingState message="Loading…" fullPage />;
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
        <h1 className="st-header-title">{t('SETTINGS_PAGE_TITLE')}</h1>
      </div>

      {/* ── 1. Account ── */}
      <Section title={t('SETTINGS_SECTION_ACCOUNT')}>
        <div className="st-field">
          <div className="st-field-label">{t('SETTINGS_SIGNED_IN_AS')}</div>
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
          {t('SETTINGS_SIGN_OUT_BUTTON')}
        </button>
      </Section>

      {/* ── 2. Watchlist ── */}
      <Section title={t('SETTINGS_SECTION_WATCHLIST')}>
        <div className="st-desc">{t('SETTINGS_WATCHLIST_DESC')}</div>
        <CoinMultiSelect
          value={settings.watchlist ?? []}
          onChange={next => update({ watchlist: next })}
        />
      </Section>

      {/* ── 3. Trading Profile ── */}
      <Section title={t('SETTINGS_SECTION_TRADING_PROFILE')}>
        <div className="st-row">
          <div className="st-field st-field-half">
            <label className="st-field-label">{t('SETTINGS_FIELD_ACCOUNT_SIZE')}</label>
            <div className="st-input-wrap">
              <span className="st-affix">$</span>
              <input
                className="st-input"
                aria-label={t('SETTINGS_FIELD_ACCOUNT_SIZE')}
                type="number"
                min="0"
                placeholder="1000"
                value={settings.account_size || ''}
                onChange={e => update({ account_size: num(e.target.value) })}
              />
            </div>
          </div>
          <div className="st-field st-field-half">
            <label className="st-field-label">{t('SETTINGS_FIELD_RISK_PER_TRADE')}</label>
            <div className="st-input-wrap">
              <input
                className="st-input"
                aria-label={t('SETTINGS_FIELD_RISK_PER_TRADE')}
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
            {t('SETTINGS_AT_RISK_PREFIX')}{' '}
            <strong style={{ color: '#f87171' }}>
              ${(settings.account_size * settings.risk_pct / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </strong>
          </div>
        )}
      </Section>

      {/* ── 3. AI Arena Defaults ── */}
      <Section title={t('SETTINGS_SECTION_ARENA_DEFAULTS')}>
        <div className="st-field">
          <label className="st-field-label">{t('SETTINGS_FIELD_DEFAULT_COIN')}</label>
          <select
            className="st-input"
            aria-label={t('SETTINGS_FIELD_DEFAULT_COIN')}
            value={settings.default_coin}
            onChange={e => update({ default_coin: e.target.value as typeof settings.default_coin })}
          >
            {COINS.map(c => (
              <option key={c} value={c}>{c.toUpperCase()}</option>
            ))}
          </select>
        </div>
        <div className="st-field">
          <label className="st-field-label">{t('SETTINGS_FIELD_DEFAULT_TF')}</label>
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
      <Section title={t('SETTINGS_SECTION_NOTIFICATIONS')}>
        <div className="st-desc">{t('SETTINGS_NOTIF_DESC')}</div>

        {/* Push enable/disable toggle */}
        <div className="st-field" style={{ marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div className="st-field-label" style={{ marginBottom: 2 }}>{t('SETTINGS_FIELD_PUSH_NOTIFICATIONS')}</div>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
                {pushEnabled ? t('SETTINGS_PUSH_ACTIVE') : t('SETTINGS_PUSH_INACTIVE')}
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

        {/* Test notification button - only shown when subscribed */}
        {pushEnabled && (
          <button
            onClick={handleTestPush}
            style={{
              width: '100%', padding: '9px 0', borderRadius: 8, marginBottom: 16,
              background: testResult === 'sent' ? 'rgba(74,222,128,0.1)' : testResult === 'error' ? 'rgba(248,113,113,0.1)' : 'rgba(26,122,255,0.08)',
              border: `0.5px solid ${testResult === 'sent' ? 'rgba(74,222,128,0.3)' : testResult === 'error' ? 'rgba(248,113,113,0.3)' : 'var(--bdr)'}`,
              color: testResult === 'sent' ? 'var(--green)' : testResult === 'error' ? 'var(--red)' : 'var(--txt2)',
              fontSize: 'var(--fs-caption)', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            {testResult === 'sent' ? t('SETTINGS_TEST_PUSH_SENT') : testResult === 'error' ? t('SETTINGS_TEST_PUSH_FAILED') : t('SETTINGS_TEST_PUSH_BUTTON')}
          </button>
        )}

        <div style={{ height: 1, background: 'var(--bdr)', margin: '4px 0 16px' }} />

        <div className="st-row">
          <div className="st-field st-field-half">
            <label className="st-field-label">{t('SETTINGS_FIELD_FUNDING_TRIGGER')}</label>
            <div className="st-input-wrap">
              <input
                className="st-input"
                aria-label={t('SETTINGS_FIELD_FUNDING_TRIGGER')}
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
            <label className="st-field-label">{t('SETTINGS_FIELD_FEAR_BELOW')}</label>
            <div className="st-input-wrap">
              <input
                className="st-input"
                aria-label={t('SETTINGS_FIELD_FEAR_BELOW')}
                type="number"
                min="1"
                max="40"
                value={settings.fng_fear}
                onChange={e => update({ fng_fear: num(e.target.value) })}
              />
            </div>
          </div>
          <div className="st-field st-field-half">
            <label className="st-field-label">{t('SETTINGS_FIELD_GREED_ABOVE')}</label>
            <div className="st-input-wrap">
              <input
                className="st-input"
                aria-label={t('SETTINGS_FIELD_GREED_ABOVE')}
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
            <label className="st-field-label">{t('SETTINGS_FIELD_RSI_OB')}</label>
            <div className="st-input-wrap">
              <input
                className="st-input"
                aria-label={t('SETTINGS_FIELD_RSI_OB')}
                type="number"
                min="60"
                max="90"
                value={settings.rsi_ob}
                onChange={e => update({ rsi_ob: num(e.target.value) })}
              />
            </div>
          </div>
          <div className="st-field st-field-half">
            <label className="st-field-label">{t('SETTINGS_FIELD_RSI_OS')}</label>
            <div className="st-input-wrap">
              <input
                className="st-input"
                aria-label={t('SETTINGS_FIELD_RSI_OS')}
                type="number"
                min="10"
                max="40"
                value={settings.rsi_os}
                onChange={e => update({ rsi_os: num(e.target.value) })}
              />
            </div>
          </div>
        </div>

        <div className="st-row">
          <div className="st-field st-field-half">
            <label className="st-field-label">{t('SETTINGS_FIELD_SQUEEZE_SCORE')}</label>
            <div className="st-input-wrap">
              <input
                className="st-input"
                aria-label={t('SETTINGS_FIELD_SQUEEZE_SCORE')}
                type="number"
                min="40"
                max="95"
                value={settings.squeeze_threshold}
                onChange={e => update({ squeeze_threshold: num(e.target.value) })}
              />
            </div>
          </div>
        </div>

        <div className="st-note">
          {t('SETTINGS_NOTIF_NOTE')}
        </div>
      </Section>

      {/* ── 6. Appearance ── */}
      <Section title={t('SETTINGS_SECTION_APPEARANCE')}>
        <div className="st-field">
          <label className="st-field-label">{t('SETTINGS_FIELD_THEME')}</label>
          <ThemeChips />
        </div>
        <div className="st-field" style={{ marginBottom: 0 }}>
          <label className="st-field-label">{t('SETTINGS_SECTION_LANGUAGE')}</label>
          <LanguageSelect />
        </div>
      </Section>

      {/* ── 7. Telegram Alerts ── */}
      <Section title={t('SETTINGS_SECTION_TELEGRAM')}>
        <div className="st-field">
          <div className="st-field-label">{t('SETTINGS_FIELD_STATUS')}</div>
          <div className="st-tg-status">
            <span
              className="st-tg-dot"
              style={{ background: tgStatus === 'configured' ? 'var(--green)' : 'var(--txt3)' }}
            />
            {tgStatus === 'loading'
              ? <SkeletonBar width={70} height={12} />
              : tgStatus === 'configured'
              ? t('SETTINGS_TG_CONFIGURED')
              : t('SETTINGS_TG_NOT_CONFIGURED')}
          </div>
        </div>
        <Link href="/alerts" className="st-link-btn">
          {tgStatus === 'configured' ? t('SETTINGS_TG_MANAGE_LINK') : t('SETTINGS_TG_SETUP_LINK')}
        </Link>
      </Section>

    </div>
  );
}
