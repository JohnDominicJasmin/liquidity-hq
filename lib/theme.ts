'use client';
import { useState, useEffect, useCallback } from 'react';

// Single source of truth for theme state — this used to be reimplemented
// four times (NavDrawer's toggle, SettingsModal's chips, and two copies of
// the same chips in app/settings/page.tsx for the logged-out/logged-in
// views), each hand-rolling the same three steps and easy to get out of
// sync (AUDIT.md item #12).

export type Theme = 'dark' | 'light';

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    return localStorage.getItem('theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Apply + persist a theme. Dispatches 'theme-change' — KLineProChart and
    GrokSignalChart re-style only on that event, so without it canvas charts
    stay in the old theme until a full reload. */
export function applyTheme(next: Theme) {
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch {}
  window.dispatchEvent(new Event('theme-change'));
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('dark');

  // Read the real stored value after mount (SSR has no localStorage/DOM,
  // so the initial 'dark' avoids a hydration mismatch).
  useEffect(() => {
    setThemeState(getStoredTheme());
  }, []);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return { theme, setTheme, toggleTheme };
}
