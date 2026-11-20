'use client';
import { use, useMemo, useState } from 'react';
import { LabelsContext, interpolate, useLabels, type Locale } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';
import { loadFullEnglish } from '@/lib/labelsFull';

/* THE VISITOR'S LANGUAGE FROM THE FIRST PAINT, for one page (#1263, PM: GO on "d2", 2026-11-19).
 *
 * LabelsProvider (AppShell) learns the visitor's locale only after hydration, so the server HTML and the first paint are English and every label re-wraps when the locale arrives (QA: /arena, ru, 360 px, CLS 0.125).
 * A page that knows the locale on the server (app/(main)/arena/layout.tsx reads the `lhq_lang` cookie) wraps its content in this provider with that locale's table, so the first paint is already in that language.
 *
 * It steps aside as soon as the app-wide provider has settled (its first load finished): from then on the page reads the app-wide value, which by then holds the same locale and table (or the visitor's real
 * choice, when the cookie was stale), so a language switch made later behaves exactly as everywhere else. Server and client render the same seeded text first, so hydration matches. */
export default function LabelsSeed({ locale, labels, children }: { locale: Locale; labels: Record<string, string>; children: React.ReactNode }) {
  const outer = useLabels();
  /* The whole English table, from its own chunk (#1185 slow-3G, option B, DRAFT). /arena is not a critical-label route, so LabelsProvider above has already waited for it: this returns at once. */
  const DEFAULT_EN_LABELS = use(loadFullEnglish());
  // Once settled, always settled: a later locale switch sets the app-wide `loading` again, and the page must keep following the app-wide value through it, not fall back to the seed.
  const [settled, setSettled] = useState(false);
  if (!outer.loading && !settled) setSettled(true);
  const seeded = useMemo(() => {
    const map: Record<string, string> = { ...DEFAULT_EN_LABELS, ...labels };
    return { locale, setLocale: outer.setLocale, t: (key: LabelKey, vars?: Record<string, string | number>) => interpolate(map[key] ?? key, vars), loading: false };
  }, [DEFAULT_EN_LABELS, locale, labels, outer.setLocale]);
  return <LabelsContext.Provider value={settled || !outer.loading ? outer : seeded}>{children}</LabelsContext.Provider>;
}
