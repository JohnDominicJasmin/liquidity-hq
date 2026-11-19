import type { LabelKey } from './labelKeys.ts';

/** "just now" / "12m ago" / "3h ago" for a last-good value kept on screen while a refresh is failing. Reuses the Arena freshness labels, so no new copy and
 *  the wording matches the Arena's read age. Pure: the caller passes the age in ms (from a `useNow` clock, never a `Date.now()` in a render). */
export function ageLabel(ageMs: number, t: (key: LabelKey, vars?: Record<string, string | number>) => string): string {
  const s = Math.max(0, Math.floor(ageMs / 1000));
  if (s < 60) return t('ARENA_FRESHNESS_JUST_NOW');
  if (s < 3600) return t('ARENA_FRESHNESS_MINUTES_AGO', { n: Math.floor(s / 60) });
  return t('ARENA_FRESHNESS_HOURS_AGO', { n: Math.floor(s / 3600) });
}
