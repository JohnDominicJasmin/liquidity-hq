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
 * #1188, and this does not close it. A save that still fails after the retry
 * in SettingsProvider.tsx now at least tells the user; it does not stop the
 * next sign-in from silently reverting the value if that retry also failed.
 *
 * `position: fixed` in the shared `.st-save-toast` CSS class means moving the
 * mount point from inline on /settings to app-wide here is a no-op visually -
 * same corner, same look, just reachable from any route now. */
export default function SettingsSaveToast() {
  const { saveStatus } = useSettings();
  const { t } = useLabels();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (saveStatus === 'saved' || saveStatus === 'error' || saveStatus === 'conflict') {
      setVisible(true);
      // #1285: the provider already clears saveStatus back to 'idle' after
      // 3000ms for 'conflict' (same window as 'error') - this timer only
      // controls the toast's own visibility and must not outlive that, or a
      // second conflict landing inside the gap would show nothing.
      const timer = setTimeout(() => setVisible(false), saveStatus === 'saved' ? 2000 : 3000);
      return () => clearTimeout(timer);
    }
    if (saveStatus === 'saving') setVisible(true);
  }, [saveStatus]);
  if (!visible) return null;
  const cls = saveStatus === 'error' ? ' error' : saveStatus === 'conflict' ? ' conflict' : saveStatus === 'saving' ? ' saving' : '';
  const text = saveStatus === 'saving' ? t('SETTINGS_STATUS_SAVING')
    : saveStatus === 'saved' ? t('SETTINGS_STATUS_SAVED')
    : saveStatus === 'conflict' ? t('SETTINGS_STATUS_CONFLICT')
    : t('SETTINGS_STATUS_FAILED');
  return <div className={`st-save-toast${cls}`}>{text}</div>;
}
