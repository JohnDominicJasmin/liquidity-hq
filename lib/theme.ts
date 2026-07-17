'use client';
import { useState, useEffect, useCallback } from 'react';

// Single source of truth for theme state - this used to be reimplemented
// four times (NavDrawer's toggle, SettingsModal's chips, and two copies of
// the same chips in app/settings/page.tsx for the logged-out/logged-in
// views), each hand-rolling the same three steps and easy to get out of
// sync (AUDIT.md item #12).

export type Theme = 'dark' | 'light';

function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Explicit choice only - null means the user never toggled, so the app
    should keep following the device theme (including live OS changes). */
export function getExplicitTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem('theme');
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return getExplicitTheme() ?? systemTheme();
}

/** Apply + persist a theme as an explicit user choice. Dispatches
    'theme-change' - KLineProChart and GrokSignalChart re-style only on
    that event, so without it canvas charts stay in the old theme until a
    full reload. */
export function applyTheme(next: Theme) {
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch {}
  window.dispatchEvent(new Event('theme-change'));
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('dark');

  // Read the real stored/system value after mount (SSR has no
  // localStorage/matchMedia, so the initial 'dark' avoids a hydration
  // mismatch - the blocking script in layout.tsx already set the correct
  // data-theme on <html> before paint, so there's no visible flash).
  useEffect(() => {
    setThemeState(getStoredTheme());

    // No explicit choice yet - keep following the device theme live, same
    // as the initial-load behavior, until the user actually toggles.
    if (getExplicitTheme() != null) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      if (getExplicitTheme() != null) return;
      const next = systemTheme();
      document.documentElement.setAttribute('data-theme', next);
      window.dispatchEvent(new Event('theme-change'));
      setThemeState(next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
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
