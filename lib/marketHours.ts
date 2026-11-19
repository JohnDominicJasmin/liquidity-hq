/* THE US CASH SESSION, for tokenized stocks (PM, 2026-11-19). The Binance / Bybit stock perpetuals trade around the clock, the real market does not: 09:30-16:00 New York on a weekday, which is 13:30-20:00 UTC in summer time and
 * 14:30-21:00 UTC in winter time (so it is computed from the New York clock, never fixed). US market holidays are NOT modelled: on one the perp trades and this says "open". Pure. */
const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', weekday: 'short', hour: 'numeric', minute: 'numeric' });
export const US_OPEN_MIN = 9 * 60 + 30;
export const US_CLOSE_MIN = 16 * 60;

export function usCashOpen(ms: number): boolean {
  if (!Number.isFinite(ms)) return false;
  const parts = NY.formatToParts(new Date(ms));
  const get = (t: string) => parts.find(p => p.type === t)?.value;
  const wd = get('weekday');
  if (wd === 'Sat' || wd === 'Sun') return false;
  const min = Number(get('hour')) * 60 + Number(get('minute'));
  return min >= US_OPEN_MIN && min < US_CLOSE_MIN;
}
