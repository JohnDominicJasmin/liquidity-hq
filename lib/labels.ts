import { createContext, useContext } from 'react';
import type { LabelKey } from './labelKeys';

// Matches the landing page's SUPPORTED_LOCALES (lib/i18n/dictionaries.ts)
// plus the additional languages picked for the app-wide rollout - the two
// systems are deliberately separate (landing stays build-time static) but
// share the same locale codes.
export type Locale = 'en' | 'ko' | 'zh' | 'ar' | 'vi' | 'pt-BR' | 'tr' | 'es' | 'id' | 'ru';
export const SUPPORTED_LOCALES: Locale[] = ['en', 'ko', 'zh', 'ar', 'vi', 'pt-BR', 'tr', 'es', 'id', 'ru'];

export function isSupportedLocale(v: string): v is Locale {
  return (SUPPORTED_LOCALES as string[]).includes(v);
}

export interface LabelsContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: LabelKey, vars?: Record<string, string | number>) => string;
  loading: boolean;
}

// key => key as the ultimate fallback (rather than throwing/blank) means a
// missing provider, an in-flight first fetch, or a key with no row anywhere
// still renders *something* legible instead of breaking the page.
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
}

export const DEFAULT_LABELS_CONTEXT: LabelsContextValue = {
  locale: 'en',
  setLocale: () => {},
  t: (key) => key,
  loading: true,
};

export const LabelsContext = createContext<LabelsContextValue>(DEFAULT_LABELS_CONTEXT);

export function useLabels(): LabelsContextValue {
  return useContext(LabelsContext);
}

export { interpolate };

const LS_KEY = 'lhq_lang_v1';

export function loadLocalLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw && isSupportedLocale(raw)) return raw;
  } catch { /* ignore */ }
  return 'en';
}

export function saveLocalLocale(l: Locale) {
  try { localStorage.setItem(LS_KEY, l); } catch { /* ignore */ }
}
