'use client';
import { useEffect, useState } from 'react';
import { LabelsContext, Locale, loadLocalLocale, saveLocalLocale, interpolate } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

// Not user-scoped (labels are public content, same for every visitor), so
// this mounts outside AuthProvider and doesn't wait on auth to hydrate -
// see components/AppShell.tsx. Mirrors SettingsProvider's localStorage-first
// pattern: the saved locale applies immediately on mount (no flash back to
// English on reload), then a fetch keeps the label map in sync with it.
export default function LabelsProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  const [map, setMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { setLocaleState(loadLocalLocale()); }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/labels?locale=${encodeURIComponent(locale)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => { if (alive) setMap(data); })
      .catch(() => { /* keep last-known map on transient failure */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [locale]);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    saveLocalLocale(l);
  };

  const t = (key: LabelKey, vars?: Record<string, string | number>) => interpolate(map[key] ?? key, vars);

  return (
    <LabelsContext.Provider value={{ locale, setLocale, t, loading }}>
      {children}
    </LabelsContext.Provider>
  );
}
