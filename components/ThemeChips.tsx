'use client';
import { useTheme } from '@/lib/theme';
import { IconSun, IconMoon } from './icons';
import { useLabels } from '@/lib/labels';

/** Dark/Light chip selector - shared by the Settings page (logged-out and
    logged-in views) and the Settings modal, which used to each hand-roll
    the same data-theme/localStorage/theme-change logic separately. */
export default function ThemeChips() {
  const { theme, setTheme } = useTheme();
  const { t } = useLabels();
  return (
    <div className="st-chip-row">
      {(['dark', 'light'] as const).map(mode => (
        <button
          key={mode}
          className={`st-chip${theme === mode ? ' on' : ''}`}
          onClick={() => setTheme(mode)}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {mode === 'dark' ? <IconMoon size={13} /> : <IconSun size={13} />}
            {mode === 'dark' ? t('THEME_CHIPS_DARK') : t('THEME_CHIPS_LIGHT')}
          </span>
        </button>
      ))}
    </div>
  );
}
