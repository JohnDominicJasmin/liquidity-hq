'use client';
import { useTheme } from '@/lib/theme';
import { IconSun, IconMoon } from './icons';

/** Dark/Light chip selector — shared by the Settings page (logged-out and
    logged-in views) and the Settings modal, which used to each hand-roll
    the same data-theme/localStorage/theme-change logic separately. */
export default function ThemeChips() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="st-chip-row">
      {(['dark', 'light'] as const).map(t => (
        <button
          key={t}
          className={`st-chip${theme === t ? ' on' : ''}`}
          onClick={() => setTheme(t)}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {t === 'dark' ? <IconMoon size={13} /> : <IconSun size={13} />}
            {t === 'dark' ? 'Dark' : 'Light'}
          </span>
        </button>
      ))}
    </div>
  );
}
