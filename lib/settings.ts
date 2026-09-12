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
  // #1246: distinct from `loading` on purpose. `loading` flips false as soon
  // as the SYNCHRONOUS localStorage read completes on mount, before the
  // sign-in effect has even checked whether a real account exists to fetch a
  // DB row for - a consumer gating on `!loading` alone can start rendering
  // (and accepting input against) `settings` before the authoritative source
  // has been consulted at all. `settingsLoaded` is true only once that source
  // - a resolved DB read for a signed-in user, or a confirmed sign-out with
  // nothing to fetch - has actually landed, and it goes false again if the
  // signed-in account changes, since a new account's row hasn't been read yet
  // even though the previous one's had. Added for the Strategy Panel
  // pre-load write race (a chip clicked before this is true was writing an
  // empty selection over a real saved one) but generic: any consumer that
  // must not act on `settings` before the authoritative value is known
  // should gate on this instead of inferring it from a field being non-null,
  // since null can legitimately mean "confirmed, never saved".
  settingsLoaded: boolean;
  // #1285: 'conflict' is distinct from 'error' - the save itself succeeded
  // (the server accepted the request and answered), it's just that this
  // client's value for one or more fields lost to a newer write from another
  // device and got overwritten locally with the server's authoritative value.
  // Telling the user "save failed" for that would be wrong twice over: it
  // did not fail, and the fix is not "try again" (retrying would just lose
  // again to the same newer write).
  saveStatus: 'idle' | 'saving' | 'saved' | 'error' | 'conflict';
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
  settingsLoaded: false,
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
// #1202 symptom 3: was a single global key, same scope as `lhq_settings_v1`
// itself. That meant a stale marker surviving a skipped sign-out cleanup (a
// crash, or any path that doesn't run the effect that calls this) could
// wrongly protect a field for the NEXT account signed in on a shared
// browser. Namespacing by user id removes the failure mode at the root:
// two accounts now simply never share a key, so there is nothing left for a
// missed cleanup to leak into.
//
// PM/DevOps caught a real regression in the first version of this (#1214):
// namespacing the MARKER isn't enough on its own, because that first version
// only ever stored KEY NAMES here and restored the actual value from
// `settingsRef.current` / `lhq_settings_v1` - which is NOT namespaced and
// can hold whichever account most recently used this tab. Account A's failed
// edit, unconfirmed under `…:A`, would restore whatever value the SHARED
// cache happened to hold at merge time - which could be account B's real,
// confirmed value if B signed in and out in between. B's setting would then
// display as A's own, permanently, since nothing would ever know it was
// wrong. Storing the VALUE alongside the marker, per account, removes the
// shared-cache dependency entirely - the merge in applyDbSettings (below,
// SettingsProvider.tsx) never reads from `lhq_settings_v1` for an
// unconfirmed field again.
const UNCONFIRMED_LS_KEY = 'lhq_settings_unconfirmed_v1';
const unconfirmedKeyFor = (userId: string) => `${UNCONFIRMED_LS_KEY}:${userId}`;

// Keyed by UserSettings field name; `unknown` because everything here has
// crossed a JSON.parse boundary and cannot be trusted to be well-typed
// without a runtime check, same reasoning rowToSettings already applies to
// a DB row.
export type UnconfirmedMap = Record<string, unknown>;

export function loadUnconfirmed(userId: string): UnconfirmedMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(unconfirmedKeyFor(userId));
    if (!raw) return {};
    const obj: unknown = JSON.parse(raw);
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj as UnconfirmedMap : {};
  } catch { return {}; }
}

export function saveUnconfirmed(userId: string, map: UnconfirmedMap) {
  try {
    const key = unconfirmedKeyFor(userId);
    if (Object.keys(map).length === 0) { localStorage.removeItem(key); return; }
    localStorage.setItem(key, JSON.stringify(map));
  } catch { /* ignore */ }
}

// Drops the pre-#1202 global key (shipped with #1188 part 3, genuinely live
// on deployed environments) once, on first load after authLoading settles -
// NOT migrated into whichever account happens to sign in next.
//
// An earlier version of this function migrated it, seeding the value from
// `lhq_settings_v1` (the shared local cache) since the legacy key only ever
// stored key NAMES, never values. PM/DevOps caught why that is wrong: the
// legacy key has no owner. If the old sign-out clear didn't run and a
// DIFFERENT account signs in first after this deploy, migrating would copy
// account A's key names AND account B's currently-cached values into B's own
// protected set under A's old marker - reconstructing this exact rewrite's
// cross-account leak, one step earlier than where it lived before.
//
// Dropping instead trades a narrower, visible loss for that unrecoverable
// one: an edit that had ALREADY failed to save before this deploy reverts to
// its DB value, once - the user sees their own genuinely-already-broken save
// silently resolve to the server's answer, which is what would have
// happened anyway had the original sign-out clear run as designed.
export function dropLegacyUnconfirmedKey() {
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
