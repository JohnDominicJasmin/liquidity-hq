import { createContext, useContext } from 'react';
import type { LabelKey } from './labelKeys';

// The locale list lives in ./locales so server code can import it without
// dragging this file's React imports across the client/server boundary.
// Re-exported here so every existing `from '@/lib/labels'` import still works.
export { SUPPORTED_LOCALES, AVAILABLE_LOCALES, isSupportedLocale, resolveOfferedLocale, type Locale } from './locales';
import { resolveOfferedLocale, type Locale } from './locales';

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
    /* resolveOfferedLocale, not isSupportedLocale: a stored preference for a
       language that is no longer OFFERED must come back as English, or the user
       is stuck in it with no picker entry to change it (#165). */
    return resolveOfferedLocale(raw);
  } catch { /* ignore */ }
  return 'en';
}

export function saveLocalLocale(l: Locale) {
  try { localStorage.setItem(LS_KEY, l); } catch { /* ignore */ }
}
