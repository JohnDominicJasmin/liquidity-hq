/* WHAT A FAILED PRICE-ALERT REQUEST SAYS, IN THE READER'S LANGUAGE (#1263). The route answers with a code and an English sentence; the
 * pages showed them as they came. The code picks a label here, and anything unrecognised gets the caller's own "it failed" label: server
 * text is never shown. */
import { ACTIVE_ALERT_CAP } from './ownRowLimits.ts';
import type { LabelKey } from './labelKeys.ts';

type T = (key: LabelKey, vars?: Record<string, string | number>) => string;

export function alertErrorText(t: T, status: number, code: string | undefined, fallback: LabelKey): string {
  if (status === 401) return t('ALERTS_ERR_SIGN_IN');
  switch (code) {
    case 'PRO_REQUIRED':     return t('ALERTS_PRICE_LOCKED_DESC');
    case 'COIN_NOT_COVERED': return t('ARENA_ALERT_MAIN_COINS_ONLY');
    case 'ALERT_LIMIT':      return t('ALERTS_ERR_LIMIT', { max: ACTIVE_ALERT_CAP });
    case 'TOO_LONG':         return t('ALERTS_ERR_NOTE_TOO_LONG');
    case 'INVALID_INPUT':    return t('ALERTS_ERR_INVALID');
    default:                 return t(fallback);
  }
}
