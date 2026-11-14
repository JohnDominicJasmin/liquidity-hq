import type { LabelKey } from '@/lib/labelKeys';

/* A COUNTDOWN IN THE VISITOR'S LANGUAGE (#1185, PM). "2h 19m 00s" had English unit letters in every language; the three unit words
   are label keys now. English reads exactly as before ("2h 19m 00s", "19m 05s", "5s", "0s"). `padMinutes` keeps the clock look
   (zero-padded minutes and seconds after the first unit) for the live timers and drops it for the "2h 19m away" line. */
type T = (key: LabelKey) => string;

export function fmtDuration(t: T, totalSeconds: number, padded: boolean): string {
  const pad = (n: number) => (padded && n < 10 ? '0' + n : '' + n);
  const total = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
  const H = t('DURATION_UNIT_H'), M = t('DURATION_UNIT_M'), S = t('DURATION_UNIT_S');
  if (total <= 0) return '0' + S;
  if (!padded) return h > 0 ? h + H + ' ' + m + M : m + M;
  if (h > 0) return h + H + ' ' + pad(m) + M + ' ' + pad(sec) + S;
  if (m > 0) return m + M + ' ' + pad(sec) + S;
  return sec + S;
}
