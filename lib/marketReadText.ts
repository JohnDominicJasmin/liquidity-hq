import type { LabelKey } from './labelKeys.ts';
import { SESSION_KEYS } from './sessionText.ts';

/* THE MARKET READ'S AND THE SESSION BADGE'S ENGLISH, TRANSLATED AT THE POINT OF DISPLAY (#1185, PM 2026-11-13: /ru dashboard still showed "Decent conditions - be selective", "High greed", "Friday",
 * "Long-heavy", "Leaning bear", "NY Session"). `lib/marketRead.ts` and `lib/session.ts` compute with English strings, and the AI-prompt builders read those same strings, so they are NOT changed; the
 * components that SHOW them pass each string through `trText`, which swaps an exactly-known English string for its label and leaves anything else untouched. Keys that already existed are reused
 * (days, funding sides, Bullish/Bearish, Fear & Greed); the rest are new MARKET_READ_TXT_* and SESSION_NAME_* keys, in the label table with the English as the default. */
const KEYS: Record<string, LabelKey> = {
  ...SESSION_KEYS,
  'Fear & Greed': 'BRIEFING_FNG_LABEL',
  'Funding': 'SETUP_SCANNER_STAT_FUNDING',
  'Neutral': 'FUNDING_NEUTRAL_LABEL',
  'Sunday': 'HOURS_DAY_SUN',
  'Monday': 'HOURS_DAY_MON',
  'Tuesday': 'HOURS_DAY_TUE',
  'Wednesday': 'HOURS_DAY_WED',
  'Thursday': 'HOURS_DAY_THU',
  'Friday': 'HOURS_DAY_FRI',
  'Saturday': 'HOURS_DAY_SAT',
  'Long-heavy': 'MARKET_READ_FUND_LONG',
  'Short-heavy': 'MARKET_READ_FUND_SHORT',
  'Bullish': 'MULTI_TF_ALIGNMENT_BIAS_BULLISH',
  'Bearish': 'MULTI_TF_ALIGNMENT_BIAS_BEARISH',
  'Longs overcrowded': 'DASH_SIDEBAR_SIG_LONGS_OVERCROWDED',
  'Reading the market…': 'MARKET_READ_TXT_READING_MARKET',
  'Good time to trade': 'MARKET_READ_TXT_GOOD_TIME',
  'Decent conditions - be selective': 'MARKET_READ_TXT_DECENT',
  'Weak setup - better to wait': 'MARKET_READ_TXT_WEAK',
  'Several signals line up in your favor. A cleaner, higher-confidence window - still mind your risk.': 'MARKET_READ_TXT_SUB_GOOD',
  'Conditions are mixed but tradeable. Be picky with entries and keep your size modest.': 'MARKET_READ_TXT_SUB_MID',
  'Signals are thin and momentum is unclear. No real edge right now - waiting is a position too.': 'MARKET_READ_TXT_SUB_WEAK',
  'Waiting for {items} data before giving a read.': 'MARKET_READ_TXT_WAITING',
  'and': 'MARKET_READ_TXT_AND',
  'Order wall': 'MARKET_READ_TXT_ORDER_WALL',
  'Day': 'MARKET_READ_TXT_DAY',
  'Smart money': 'MARKET_READ_TXT_SMART_MONEY',
  'Tight': 'MARKET_READ_TXT_TIGHT',
  'Nearby': 'MARKET_READ_TXT_NEARBY',
  'Far': 'MARKET_READ_TXT_FAR',
  'Extreme fear': 'MARKET_READ_TXT_FNG_EXTREME_FEAR',
  'Fear': 'MARKET_READ_TXT_FNG_FEAR',
  'Mild fear': 'MARKET_READ_TXT_FNG_MILD_FEAR',
  'Greed': 'MARKET_READ_TXT_FNG_GREED',
  'High greed': 'MARKET_READ_TXT_FNG_HIGH_GREED',
  'Extreme greed': 'MARKET_READ_TXT_FNG_EXTREME_GREED',
  'Reading…': 'MARKET_READ_TXT_READING',
  'Leaning bull': 'MARKET_READ_TXT_LEANING_BULL',
  'Leaning bear': 'MARKET_READ_TXT_LEANING_BEAR',
  'Shorts overcrowded': 'MARKET_READ_TXT_SHORTS_OVERCROWDED',
  'All 3 crowd signals lean bearish - high flush risk. Tighten stops or wait.': 'MARKET_READ_TXT_CROWD_ALL3_BEAR',
  'Crowd is leaning long - elevated flush risk. Avoid chasing longs.': 'MARKET_READ_TXT_CROWD_LEAN_LONG',
  'All 3 crowd signals lean bullish - high squeeze potential. Watch for a sharp reversal.': 'MARKET_READ_TXT_CROWD_ALL3_BULL',
  'Crowd is leaning short - squeeze risk building. Watch for a reversal, not a buy yet.': 'MARKET_READ_TXT_CROWD_LEAN_SHORT',
  'no walls': 'MARKET_READ_TXT_NO_WALLS',
  'God Tier': 'SESSION_NAME_GOD',
  'Prime': 'SESSION_NAME_PRIME',
  'Mon Evening': 'SESSION_NAME_MON_EVE',
  'NY Session': 'SESSION_NAME_NY',
  'London Open': 'SESSION_NAME_LONDON',
  'Pre-NY': 'SESSION_NAME_PRE_NY',
  'Asia Session': 'SESSION_NAME_ASIA',
  'Dead Zone': 'SESSION_NAME_DEAD',
  'Ask AI': 'GROK_FAB_LABEL',
};

const WALL_PATTERNS: Array<[RegExp, LabelKey]> = [
  [/^([\d.]+)% away · tight$/, 'MARKET_READ_TXT_WALL_TIGHT'],
  [/^([\d.]+)% away · close$/, 'MARKET_READ_TXT_WALL_CLOSE'],
  [/^([\d.]+)% away · far$/, 'MARKET_READ_TXT_WALL_FAR'],
  [/^([\d.]+)% away$/, 'MARKET_READ_TXT_WALL_AWAY'],
  [/^([\d.]+)% · too far$/, 'MARKET_READ_TXT_WALL_TOO_FAR'],
];

type T = (key: LabelKey, vars?: Record<string, string | number>) => string;

/** The visitor's-language text for a string `lib/marketRead.ts` / `lib/session.ts` produced, or the string itself when it is not a known one. */
export function trText(t: T, s: string): string {
  const key = KEYS[s];
  if (key) return t(key);
  for (const [re, k] of WALL_PATTERNS) {
    const m = s.match(re);
    if (m) return t(k, { pct: m[1] });
  }
  const w = s.match(/^Waiting for (.+) data before giving a read\.$/);
  if (w) {
    const items = w[1].split(' and ').map(x => (x === 'Fear & Greed' ? t('BRIEFING_FNG_LABEL') : x === 'funding' ? t('SETUP_SCANNER_STAT_FUNDING') : x));
    return t('MARKET_READ_TXT_WAITING', { items: items.join(' ' + t('MARKET_READ_TXT_AND') + ' ') });
  }
  return s;
}
