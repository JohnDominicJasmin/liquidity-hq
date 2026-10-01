'use client';
import { useState, useEffect } from 'react';
import { useSettings } from '@/lib/settings';
import { useLabels } from '@/lib/labels';

/* Mounted app-wide (AppShell), not just on /settings - #1188.
 *
 * useSettings().update() is called from 9 files (app/settings/page.tsx,
 * app/alerts/page.tsx, app/arena/page.tsx, DashboardTerminal, LanguageNavSwitcher,
 * LanguageSelect, OnboardingFlow, PositionSizer, TimezoneSync), and before this,
 * only app/settings/page.tsx ever rendered a status toast. A save triggered from
 * any of the other 8 - a timeframe change on Arena, a language switch from the
 * nav - failed with zero visible signal: saveStatus flipped to 'error' in
 * context with nothing listening. This is the "8 of 9 call sites show nothing"
 * half of #1188, not the reconciliation half - that is still open, tracked on
 * #1188, and this does not close it.
 *
 * TOP-CENTRE, UNDER THE TOP BAR (owner, 2026-10-01, #1498). It used to sit in
 * the bottom-right corner, where the Ask AI button and, on phones, the tab bar
 * already are; the owner rejected it overlapping both. A save message is
 * passive status, so it now sits where the app already shows status, under the
 * top bar, and cannot collide with the FAB or the tab bar by construction. The
 * old answer - hiding the FAB while the toast showed (body.settings-toast-open)
 * and lifting the toast over the tab bar - is removed with it.
 *
 * States: "Saving…", "Saved" (2s) and "Updated from another device" (4s) are
 * polite status; "Couldn't save" is an alert that stays until the visitor
 * retries or dismisses it, because a failed save is the one they need to act
 * on. None of them moves focus. */
type Shown = 'saving' | 'saved' | 'conflict' | 'error';

export default function SettingsSaveToast() {
  const { saveStatus, retrySave } = useSettings();
  const { t } = useLabels();
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    if (saveStatus === 'saving') { setShown('saving'); return; }
    if (saveStatus === 'error') { setShown('error'); return; }
    if (saveStatus === 'saved' || saveStatus === 'conflict') {
      setShown(saveStatus);
      const timer = setTimeout(() => setShown(s => (s === saveStatus ? null : s)), saveStatus === 'saved' ? 2000 : 4000);
      return () => clearTimeout(timer);
    }
    // 'idle': the provider resets after its own timers. An error stays on
    // screen until acted on; a "Saving…" that ended without a result does not.
    setShown(s => (s === 'saving' ? null : s));
  }, [saveStatus]);

  if (!shown) return null;

  if (shown === 'error') {
    return (
      <div className="st-save-toast error" role="alert">
        <svg className="st-save-toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span className="st-save-toast-text">{t('SETTINGS_SAVE_FAILED_TITLE')}</span>
        <button type="button" className="st-save-toast-retry" onClick={() => { setShown('saving'); retrySave(); }}>
          {t('SETTINGS_SAVE_RETRY_BUTTON')}
        </button>
        <button type="button" className="st-save-toast-close" onClick={() => setShown(null)} aria-label={t('SETTINGS_SAVE_DISMISS_ARIA')} title={t('SETTINGS_SAVE_DISMISS_ARIA')}>
          ✕
        </button>
      </div>
    );
  }

  const cls = shown === 'conflict' ? ' conflict' : shown === 'saving' ? ' saving' : '';
  const text = shown === 'saving' ? t('SETTINGS_STATUS_SAVING')
    : shown === 'saved' ? t('SETTINGS_STATUS_SAVED')
    : t('SETTINGS_STATUS_CONFLICT');
  return (
    <div className={`st-save-toast${cls}`} role="status" aria-live="polite">
      <span className="st-save-toast-text">{text}</span>
    </div>
  );
}
