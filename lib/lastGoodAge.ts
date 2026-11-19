import type { LabelKey } from '@/lib/labelKeys';

type TFn = (key: LabelKey, vars?: Record<string, string | number>) => string;

/** "just now" / "12m ago" / "3h ago" / "2d ago" for the age of a last-good value shown while a refresh fails.
 *  Reuses the news time labels, so no new label exists for it. `ts` is epoch milliseconds. */
export function lastGoodAge(ts: number, t: TFn, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60)    return t('NEWS_TIME_JUST_NOW');
  if (s < 3600)  return t('NEWS_TIME_MINUTES_AGO', { n: Math.floor(s / 60) });
  if (s < 86400) return t('NEWS_TIME_HOURS_AGO', { n: Math.floor(s / 3600) });
  return t('NEWS_TIME_DAYS_AGO', { n: Math.floor(s / 86400) });
}

/** Per-key last-good value in localStorage: `{ v, ts }`. Never stores a failure; a failed read keeps the old entry. */
export function readLastGood<T>(key: string): { v: T; ts: number } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const o = JSON.parse(raw) as { v?: T; ts?: number } | null;
    if (!o || o.v == null || typeof o.ts !== 'number') return null;
    return { v: o.v, ts: o.ts };
  } catch { return null; }
}

export function writeLastGood<T>(key: string, v: T): void {
  try { localStorage.setItem(key, JSON.stringify({ v, ts: Date.now() })); } catch { /* storage full or blocked: the value just is not kept */ }
}
