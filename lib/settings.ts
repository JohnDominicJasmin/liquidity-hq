import { createContext, useContext } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

export interface UserSettings {
  // Trading profile
  account_size:       number;
  risk_pct:           number;
  // Onboarding profile answers
  display_name:       string | null;
  country:            string | null;
  trading_experience: string | null;  // 'lt6m' | '6to12m' | '1to3y' | '3plus'
  trading_style:      string | null;  // 'scalp' | 'swing' | 'both' | 'learning'
  trading_challenge:  string | null;  // 'read_signals' | 'entry_exit' | 'risk_management' | 'discipline'
  how_heard:          string | null;  // attribution
  // AI Arena
  default_coin:     string;
  default_tf:       '1m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '1d';
  // Notification thresholds (client-side push alerts)
  fr_threshold:     number;   // e.g. 0.05 = 0.05%
  fng_fear:         number;   // alert when F&G <= this
  fng_greed:        number;   // alert when F&G >= this
  rsi_ob:           number;   // alert when RSI 1h >= this
  rsi_os:           number;   // alert when RSI 1h <= this
  squeeze_threshold: number;  // alert when squeeze/flush score >= this
  // Arena EMA Ribbon signal filter - stricter persistence-based confirmation
  // (fewer, calmer-looking BUY/SELL markers). Server-synced so Telegram/push
  // EMA signal alerts can fire under the exact same filter this user's own
  // chart is drawing with - see STRICT_FILTER_PARAMS in lib/strategyCore.ts.
  anti_chop_enabled: boolean;
  // Telegram - per-user chat ID (empty string = not connected)
  telegram_chat_id: string;
  // View mode
  beginner_mode:    boolean;
  // Personalized watchlist
  watchlist:        string[];
  // UI language - null means no explicit choice saved server-side yet, so
  // the client falls back to whatever it has in localStorage (see lib/labels.ts)
  language:         string | null;
  // IANA timezone, detected from the browser rather than asked for - the
  // server has no other way to know it, and Telegram alerts need it to stamp
  // each subscriber's own local time. Null = not detected yet; the alert route
  // falls back to UTC. See components/TimezoneSync.tsx.
  timezone:         string | null;
  // Arena Strategy Panel - which indicators are selected and any edited calc
  // params, so a Pro user's setup survives reload and syncs across devices
  // (#1020). Null = never saved: empty selection, registry defaults for every
  // param - identical to this app's pre-#1020 in-memory-only behaviour.
  strategy_selection: string[] | null;
  strategy_params:    Record<string, Record<string, string | number | boolean>> | null;
}

export const DEFAULT_SETTINGS: UserSettings = {
  account_size:       1000,
  risk_pct:           1.5,
  display_name:       null,
  country:            null,
  trading_experience: null,
  trading_style:      null,
  trading_challenge:  null,
  how_heard:          null,
  default_coin:       'btc',
  // Free-safe: 15m is a Pro-gated timeframe (see GATED_TFS in lib/limits.ts),
  // so defaulting to it meant a free user's very first Arena load silently
  // rewrote their timeframe to 1h with no explanation. Pro users can still
  // pick any timeframe; this is only the untouched default.
  default_tf:         '1h',
  fr_threshold:       0.05,
  fng_fear:           15,
  fng_greed:          85,
  rsi_ob:             70,
  rsi_os:             30,
  squeeze_threshold:  70,
  anti_chop_enabled:  false,
  telegram_chat_id:   '',
  beginner_mode:      true,
  watchlist:          ['btc', 'eth', 'sol'],
  language:           null,
  timezone:           null,
  strategy_selection: null,
  strategy_params:    null,
};

// ── Context ────────────────────────────────────────────────────────────────

export interface SettingsContextValue {
  settings:   UserSettings;
  loading:    boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  update:     (partial: Partial<UserSettings>) => void;
  // Re-read the saved row from the server. Needed by flows where the SERVER,
  // not this client, writes the value: connecting Telegram is finished by the
  // bot webhook (see app/api/telegram/webhook/route.ts), so the page has no
  // way to learn it happened other than asking again.
  refresh:    () => Promise<void>;
}

export const SettingsContext = createContext<SettingsContextValue>({
  settings:   DEFAULT_SETTINGS,
  loading:    false,
  saveStatus: 'idle',
  update:     () => {},
  refresh:    async () => {},
});

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}

// ── localStorage helpers ───────────────────────────────────────────────────

const LS_KEY = 'lhq_settings_v1';

export function loadLocalSettings(): UserSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  // Arena's Anti-Chop Filter toggle used to be a standalone localStorage-only
  // setting (never synced server-side, so Telegram alerts couldn't see it) -
  // carry over whatever this browser already had it set to, regardless of
  // which branch below returns (an existing lhq_settings_v1 blob predates
  // this field entirely, so it never has anti_chop_enabled of its own).
  // Gated on the migrated-marker (SettingsProvider sets it after the first
  // real sync) so this stops overriding forever once a real value exists -
  // otherwise a later explicit toggle-off would keep getting silently
  // reverted by the stale legacy key on every pre-auth page load.
  let antiChopOverride: Partial<UserSettings> = {};
  try {
    if (!localStorage.getItem('lhq_anti_chop_migrated')) {
      const antiChop = localStorage.getItem('lhq_anti_chop_enabled');
      if (antiChop != null) antiChopOverride = { anti_chop_enabled: antiChop === 'true' };
    }
  } catch { /* ignore */ }

  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw), ...antiChopOverride };
  } catch { /* ignore */ }
  // Migrate legacy keys
  const acc   = localStorage.getItem('ps_account');
  const risk  = localStorage.getItem('ps_risk');
  const theme = localStorage.getItem('theme');
  return {
    ...DEFAULT_SETTINGS,
    account_size: acc  ? (parseFloat(acc)  || DEFAULT_SETTINGS.account_size) : DEFAULT_SETTINGS.account_size,
    risk_pct:     risk ? (parseFloat(risk) || DEFAULT_SETTINGS.risk_pct)     : DEFAULT_SETTINGS.risk_pct,
    ...antiChopOverride,
    // theme is handled separately by NavDrawer, just read it for the theme section
    ...(theme === 'light' ? { _theme: 'light' } as object : {}),
  };
}

export function saveLocalSettings(s: UserSettings) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// ── Unconfirmed-write tracking (#1188 part 3) ─────────────────────────────
//
// THE ACTUAL DEFECT #1188 IS ABOUT. update() writes optimistically to local
// state + localStorage immediately, then debounces a save to the DB. If that
// save fails (even after #1188 parts 1/2's retry), the field's local value
// and the DB's value now disagree - and SettingsProvider's sign-in effect
// re-fetches the DB row on every fresh session and used to overwrite local
// state and localStorage from it UNCONDITIONALLY. A user could change a
// setting, see it apply, and find it silently reverted on their next sign-in,
// with no error ever shown for that second half.
//
// This set is the answer to "can the provider tell a field is dirty at seed
// time?" - yes, if `update()` records it the moment the optimistic write
// happens, PERSISTED (not just an in-memory ref) so it survives the exact
// reload this bug depends on. A key is added here synchronously in update(),
// before the debounce even fires, and removed only when flushToDb's own
// success path confirms that exact key was actually written to the DB - never
// on failure, and never by the sign-in/refresh reads themselves, which must
// treat this set as read-only input to a merge, not something they clear.
const UNCONFIRMED_LS_KEY = 'lhq_settings_unconfirmed_v1';

export function loadUnconfirmedKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(UNCONFIRMED_LS_KEY);
    if (!raw) return new Set();
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((k): k is string => typeof k === 'string')) : new Set();
  } catch { return new Set(); }
}

export function saveUnconfirmedKeys(keys: Set<string>) {
  try {
    if (keys.size === 0) { localStorage.removeItem(UNCONFIRMED_LS_KEY); return; }
    localStorage.setItem(UNCONFIRMED_LS_KEY, JSON.stringify([...keys]));
  } catch { /* ignore */ }
}

// Called on sign-out. Deliberately NOT per-account: `lhq_settings_v1` itself
// isn't namespaced by user id either (a pre-existing, out-of-scope-for-#1188
// property of this whole file - the first paint after switching accounts on
// a shared browser already shows the previous user's cached settings until
// the sign-in DB read corrects it). Left un-cleared, though, a stale
// unconfirmed key from a PREVIOUS account would wrongly protect that same
// field from the NEW account's real DB value during the merge below - worse
// than the pre-existing behaviour, not just as-bad - so this one specifically
// must be cleared on sign-out.
export function clearUnconfirmedKeys() {
  try { localStorage.removeItem(UNCONFIRMED_LS_KEY); } catch { /* ignore */ }
}

// ── DB row ↔ UserSettings conversion ─────────────────────────────────────

export function rowToSettings(row: Record<string, unknown>): UserSettings {
  return {
    account_size:       +(row.account_size    ?? DEFAULT_SETTINGS.account_size),
    risk_pct:           +(row.risk_pct        ?? DEFAULT_SETTINGS.risk_pct),
    display_name:       (row.display_name       as string | null) ?? null,
    country:            (row.country            as string | null) ?? null,
    trading_experience: (row.trading_experience as string | null) ?? null,
    trading_style:      (row.trading_style      as string | null) ?? null,
    trading_challenge:  (row.trading_challenge  as string | null) ?? null,
    how_heard:          (row.how_heard          as string | null) ?? null,
    default_coin:       String(row.default_coin    ?? DEFAULT_SETTINGS.default_coin),
    default_tf:         (row.default_tf as UserSettings['default_tf']) ?? DEFAULT_SETTINGS.default_tf,
    fr_threshold:       +(row.fr_threshold    ?? DEFAULT_SETTINGS.fr_threshold),
    fng_fear:           +(row.fng_fear        ?? DEFAULT_SETTINGS.fng_fear),
    fng_greed:          +(row.fng_greed       ?? DEFAULT_SETTINGS.fng_greed),
    rsi_ob:             +(row.rsi_ob          ?? DEFAULT_SETTINGS.rsi_ob),
    rsi_os:             +(row.rsi_os          ?? DEFAULT_SETTINGS.rsi_os),
    squeeze_threshold:  +(row.squeeze_threshold ?? DEFAULT_SETTINGS.squeeze_threshold),
    anti_chop_enabled:  !!(row.anti_chop_enabled ?? DEFAULT_SETTINGS.anti_chop_enabled),
    telegram_chat_id:   String(row.telegram_chat_id ?? ''),
    beginner_mode:      !!(row.beginner_mode ?? false),
    watchlist:          Array.isArray(row.watchlist) ? row.watchlist as string[] : DEFAULT_SETTINGS.watchlist,
    language:           (row.language as string | null) ?? null,
    timezone:           (row.timezone as string | null) ?? null,
    strategy_selection: Array.isArray(row.strategy_selection)
      ? (row.strategy_selection as unknown[]).filter((v): v is string => typeof v === 'string')
      : null,
    strategy_params: (row.strategy_params && typeof row.strategy_params === 'object' && !Array.isArray(row.strategy_params))
      ? row.strategy_params as Record<string, Record<string, string | number | boolean>>
      : null,
  };
}
