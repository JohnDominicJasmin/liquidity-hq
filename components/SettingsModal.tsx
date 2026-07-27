'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { useSettings } from '@/lib/settings';
import { useLabels } from '@/lib/labels';
import LanguageSelect from './LanguageSelect';
import { COINS } from '@/lib/marketStore';
import CoinMultiSelect from '@/components/CoinMultiSelect';
import ThemeChips from '@/components/ThemeChips';
import { track } from '@/lib/analytics';

const TFS          = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'] as const;
const RISK_PRESETS = ['0.25', '0.5', '1', '1.5', '2'];

function SaveIndicator({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  const { t } = useLabels();
  if (status === 'idle') return null;
  const map = { saving: [t('SETTINGS_STATUS_SAVING'), 'var(--txt3)'], saved: [t('SETTINGS_STATUS_SAVED'), 'var(--green)'], error: [t('SETTINGS_STATUS_FAILED'), 'var(--red)'] } as const;
  const [txt, col] = map[status];
  return <span style={{ fontSize: 'var(--fs-caption)', color: col, fontWeight: 600 }}>{txt}</span>;
}

interface Props { open: boolean; onClose: () => void; }

export default function SettingsModal({ open, onClose }: Props) {
  const router = useRouter();
  const { t } = useLabels();
  const { user, signOut } = useAuth();
  const { settings, saveStatus, update } = useSettings();
  const [tgStatus, setTgStatus] = useState<'loading' | 'configured' | 'not_configured'>('loading');

  // Close on Escape
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, handleKey]);

  // Lock body scroll while modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Fetch Telegram status when modal opens
  useEffect(() => {
    if (!open) return;
    fetch('/api/telegram/status').then(r => r.json())
      .then(d => setTgStatus(d.configured ? 'configured' : 'not_configured'))
      .catch(() => setTgStatus('not_configured'));
  }, [open]);

  if (!open) return null;

  const num = (v: string | number) => { const n = parseFloat(String(v)); return isNaN(n) ? 0 : n; };


  return (
    <>
      {/* Backdrop */}
      <div className="smod-backdrop" onClick={onClose} />

      {/* Panel */}
      <div className="smod-panel" role="dialog" aria-modal="true" aria-label="Settings">

        {/* Header */}
        <div className="smod-header">
          <span className="smod-title">{t('SETTINGS_PAGE_TITLE')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SaveIndicator status={saveStatus} />
            <button className="smod-close" onClick={onClose} aria-label="Close settings">✕</button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="smod-body">

          {/* ── Account ── */}
          <div className="smod-section">
            <div className="smod-section-title">{t('SETTINGS_SECTION_ACCOUNT')}</div>
            {user && <div className="smod-email">{user.email}</div>}

            {user && (
              <button className="st-signout-btn" onClick={async () => {
                onClose();
                track.signOut();
                await signOut();
                router.push('/login');
              }}>{t('SETTINGS_SIGN_OUT_BUTTON')}</button>
            )}
          </div>

          {/* ── Watchlist ── */}
          <div className="smod-section">
            <div className="smod-section-title">{t('SETTINGS_SECTION_WATCHLIST')}</div>
            <div className="st-desc">{t('SETTINGS_WATCHLIST_DESC')}</div>
            <CoinMultiSelect
              value={settings.watchlist ?? []}
              onChange={next => update({ watchlist: next })}
            />
          </div>

          {/* ── Trading Profile ── */}
          <div className="smod-section">
            <div className="smod-section-title">{t('SETTINGS_SECTION_TRADING_PROFILE')}</div>
            <div className="st-row">
              <div className="st-field st-field-half">
                <label className="st-field-label">{t('SETTINGS_FIELD_ACCOUNT_SIZE')}</label>
                <div className="st-input-wrap">
                  <span className="st-affix">$</span>
                  <input className="st-input" type="number" min="0" placeholder="1000"
                    value={settings.account_size || ''}
                    onChange={e => update({ account_size: num(e.target.value) })} />
                </div>
              </div>
              <div className="st-field st-field-half">
                <label className="st-field-label">{t('SETTINGS_FIELD_RISK_PER_TRADE')}</label>
                <div className="st-input-wrap">
                  <input className="st-input" type="number" min="0.1" max="10" step="0.1" placeholder="1.5"
                    value={settings.risk_pct || ''}
                    onChange={e => update({ risk_pct: num(e.target.value) })} />
                  <span className="st-affix st-suffix">%</span>
                </div>
              </div>
            </div>
            <div className="st-presets">
              {RISK_PRESETS.map(p => (
                <button key={p}
                  className={`st-preset${settings.risk_pct === parseFloat(p) ? ' on' : ''}`}
                  onClick={() => update({ risk_pct: parseFloat(p) })}>{p}%</button>
              ))}
            </div>
            {settings.account_size > 0 && settings.risk_pct > 0 && (
              <div className="st-at-risk">
                {t('SETTINGS_AT_RISK_PREFIX')} <strong style={{ color: '#f87171' }}>
                  ${(settings.account_size * settings.risk_pct / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </strong>
              </div>
            )}
          </div>

          {/* ── AI Arena Defaults ── */}
          <div className="smod-section">
            <div className="smod-section-title">{t('SETTINGS_SECTION_ARENA_DEFAULTS')}</div>
            <div className="st-field">
              <label className="st-field-label">{t('SETTINGS_FIELD_DEFAULT_COIN')}</label>
              <select
                className="st-input"
                value={settings.default_coin}
                onChange={e => update({ default_coin: e.target.value as typeof settings.default_coin })}
              >
                {COINS.map(c => (
                  <option key={c} value={c}>{c.toUpperCase()}</option>
                ))}
              </select>
            </div>
            <div className="st-field" style={{ marginBottom: 0 }}>
              <label className="st-field-label">{t('SETTINGS_FIELD_DEFAULT_TF')}</label>
              <div className="st-chip-row">
                {TFS.map(t => (
                  <button key={t} className={`st-chip${settings.default_tf === t ? ' on' : ''}`}
                    onClick={() => update({ default_tf: t })}>{t}</button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Notification Thresholds ── */}
          <div className="smod-section">
            <div className="smod-section-title">{t('SETTINGS_SECTION_NOTIFICATIONS')}</div>
            <div className="st-desc">Controls browser push alerts in AI Arena. RSI and Squeeze/Flush also apply to Telegram.</div>
            <div className="st-row">
              <div className="st-field st-field-half">
                <label className="st-field-label">{t('SETTINGS_FIELD_FUNDING_TRIGGER')}</label>
                <div className="st-input-wrap">
                  <input className="st-input" type="number" min="0.01" max="0.5" step="0.01"
                    value={settings.fr_threshold}
                    onChange={e => update({ fr_threshold: num(e.target.value) })} />
                  <span className="st-affix st-suffix">%</span>
                </div>
              </div>
            </div>
            <div className="st-row">
              <div className="st-field st-field-half">
                <label className="st-field-label">{t('SETTINGS_FIELD_FEAR_BELOW')}</label>
                <div className="st-input-wrap">
                  <input className="st-input" type="number" min="1" max="40"
                    value={settings.fng_fear}
                    onChange={e => update({ fng_fear: num(e.target.value) })} />
                </div>
              </div>
              <div className="st-field st-field-half">
                <label className="st-field-label">{t('SETTINGS_FIELD_GREED_ABOVE')}</label>
                <div className="st-input-wrap">
                  <input className="st-input" type="number" min="60" max="99"
                    value={settings.fng_greed}
                    onChange={e => update({ fng_greed: num(e.target.value) })} />
                </div>
              </div>
            </div>
            <div className="st-row">
              <div className="st-field st-field-half">
                <label className="st-field-label">{t('SETTINGS_FIELD_RSI_OB')}</label>
                <div className="st-input-wrap">
                  <input className="st-input" type="number" min="60" max="90"
                    value={settings.rsi_ob}
                    onChange={e => update({ rsi_ob: num(e.target.value) })} />
                </div>
              </div>
              <div className="st-field st-field-half">
                <label className="st-field-label">{t('SETTINGS_FIELD_RSI_OS')}</label>
                <div className="st-input-wrap">
                  <input className="st-input" type="number" min="10" max="40"
                    value={settings.rsi_os}
                    onChange={e => update({ rsi_os: num(e.target.value) })} />
                </div>
              </div>
            </div>
            <div className="st-row">
              <div className="st-field st-field-half">
                <label className="st-field-label">{t('SETTINGS_FIELD_SQUEEZE_SCORE')}</label>
                <div className="st-input-wrap">
                  <input className="st-input" type="number" min="40" max="95"
                    value={settings.squeeze_threshold}
                    onChange={e => update({ squeeze_threshold: num(e.target.value) })} />
                </div>
              </div>
            </div>
            <div className="st-note">{t('SETTINGS_NOTIF_NOTE')}</div>
          </div>

          {/* ── Appearance ── */}
          <div className="smod-section">
            <div className="smod-section-title">{t('SETTINGS_SECTION_APPEARANCE')}</div>
            <div className="st-field">
              <label className="st-field-label">{t('SETTINGS_FIELD_THEME')}</label>
              <ThemeChips />
            </div>
            <div className="st-field" style={{ marginBottom: 0 }}>
              <label className="st-field-label">{t('SETTINGS_SECTION_LANGUAGE')}</label>
              <LanguageSelect />
            </div>
          </div>

          {/* ── Telegram Alerts ── */}
          <div className="smod-section">
            <div className="smod-section-title">{t('SETTINGS_SECTION_TELEGRAM')}</div>
            <div className="st-field" style={{ marginBottom: 8 }}>
              <div className="st-field-label">{t('SETTINGS_FIELD_STATUS')}</div>
              <div className="st-tg-status">
                <span className="st-tg-dot"
                  style={{ background: tgStatus === 'configured' ? 'var(--green)' : 'var(--txt3)' }} />
                {tgStatus === 'loading' ? t('SETTINGS_TG_CHECKING') : tgStatus === 'configured' ? t('SETTINGS_TG_CONFIGURED') : t('SETTINGS_TG_NOT_CONFIGURED')}
              </div>
            </div>
            <Link href="/alerts" className="st-link-btn" onClick={onClose}>
              {tgStatus === 'configured' ? t('SETTINGS_TG_MANAGE_LINK') : t('SETTINGS_TG_SETUP_LINK')}
            </Link>
          </div>

        </div>{/* end smod-body */}
      </div>
    </>
  );
}
