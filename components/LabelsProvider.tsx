'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { LabelsContext, Locale, loadLocalLocale, saveLocalLocale, interpolate } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';
import DEFAULT_EN_LABELS from '@/lib/labelDefaults.en.json';

// Not user-scoped (labels are public content, same for every visitor), so
// this mounts outside AuthProvider and doesn't wait on auth to hydrate -
// see components/AppShell.tsx. Mirrors SettingsProvider's localStorage-first
// pattern: the saved locale applies immediately on mount (no flash back to
// English on reload), then a fetch keeps the label map in sync with it.
//
// DEFAULT_EN_LABELS (a static build-time snapshot of the `en` locale - see
// "regenerating lib/labelDefaults.en.json" in pendings/I18N_MIGRATION.md for
// how/when to refresh it) seeds the initial `map` state instead of `{}`. Every
// full page load / hard navigation (typing a URL, refresh - not just a
// client-side Link click) server-renders this component from scratch with
// no access to localStorage, so without a real default the FIRST PAINT -
// including the server-rendered HTML itself, confirmed via curl - showed
// raw KEY_NAME strings for every label on the page until the post-mount
// effect below resolved. Seeding with real English text instead means the
// worst case is a brief flash of English before the user's real locale
// swaps in (same as any i18n framework's default-locale fallback), never a
// raw internal key. Hydration-safe: server and client run this exact same
// static import for the initial render, so there's no mismatch - the
// locale/live-data swap only happens in the effect, same as before.

const MAP_CACHE_PREFIX = 'lhq_labels_cache_v1_';

// Last-known-good label map per locale, so a repeat visit/navigation can
// paint real text immediately instead of raw KEY_NAME fallbacks for however
// long the network fetch takes. Never cache a fail-open {} - that would
// poison every future load with permanent raw keys.
function loadCachedMap(locale: Locale): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(MAP_CACHE_PREFIX + locale);
    return raw ? JSON.parse(raw) as Record<string, string> : null;
  } catch { return null; }
}
function saveCachedMap(locale: Locale, map: Record<string, string>) {
  if (Object.keys(map).length === 0) return;
  try { localStorage.setItem(MAP_CACHE_PREFIX + locale, JSON.stringify(map)); } catch { /* ignore */ }
}

export default function LabelsProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  const [map, setMap] = useState<Record<string, string>>(DEFAULT_EN_LABELS);
  const [loading, setLoading] = useState(true);
  const reqId = useRef(0);

  const fetchLabels = useCallback((l: Locale) => {
    const id = ++reqId.current;
    setLoading(true);
    fetch(`/api/labels?locale=${encodeURIComponent(l)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (reqId.current !== id) return; // a newer locale switch has since started
        setMap(data);
        saveCachedMap(l, data);
      })
      .catch(() => { /* keep last-known map on transient failure */ })
      .finally(() => { if (reqId.current === id) setLoading(false); });
  }, []);

  // Runs once, after hydration (avoids an SSR-vs-client text mismatch from
  // reading localStorage during render). Resolves the real saved locale and
  // fetches it directly - deliberately NOT two effects chained through a
  // `locale` state change, which used to fetch English first and then the
  // real locale a beat later (a wasted request, and a longer raw-key flash).
  useEffect(() => {
    const real = loadLocalLocale();
    setLocaleState(real);
    const cached = loadCachedMap(real);
    if (cached) { setMap(cached); setLoading(false); }
    fetchLabels(real);
  }, [fetchLabels]);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    saveLocalLocale(l);
    const cached = loadCachedMap(l);
    if (cached) setMap(cached);
    fetchLabels(l);
  };

  const t = (key: LabelKey, vars?: Record<string, string | number>) => interpolate(map[key] ?? key, vars);

  return (
    <LabelsContext.Provider value={{ locale, setLocale, t, loading }}>
      {children}
    </LabelsContext.Provider>
  );
}
