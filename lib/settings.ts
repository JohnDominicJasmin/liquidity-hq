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
  // Telegram - per-user chat ID (empty string = not connected)
  telegram_chat_id: string;
  // View mode
  beginner_mode:    boolean;
  // Personalized watchlist
  watchlist:        string[];
  // UI language - null means no explicit choice saved server-side yet, so
  // the client falls back to whatever it has in localStorage (see lib/labels.ts)
  language:         string | null;
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
  default_tf:         '15m',
  fr_threshold:       0.05,
  fng_fear:           15,
  fng_greed:          85,
  rsi_ob:             70,
  rsi_os:             30,
  squeeze_threshold:  70,
  telegram_chat_id:   '',
  beginner_mode:      true,
  watchlist:          ['btc', 'eth', 'sol'],
  language:           null,
};

// ── Context ────────────────────────────────────────────────────────────────

export interface SettingsContextValue {
  settings:   UserSettings;
  loading:    boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  update:     (partial: Partial<UserSettings>) => void;
}

export const SettingsContext = createContext<SettingsContextValue>({
  settings:   DEFAULT_SETTINGS,
  loading:    false,
  saveStatus: 'idle',
  update:     () => {},
});

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}

// ── localStorage helpers ───────────────────────────────────────────────────

const LS_KEY = 'lhq_settings_v1';

export function loadLocalSettings(): UserSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  // Migrate legacy keys
  const acc   = localStorage.getItem('ps_account');
  const risk  = localStorage.getItem('ps_risk');
  const theme = localStorage.getItem('theme');
  return {
    ...DEFAULT_SETTINGS,
    account_size: acc  ? (parseFloat(acc)  || DEFAULT_SETTINGS.account_size) : DEFAULT_SETTINGS.account_size,
    risk_pct:     risk ? (parseFloat(risk) || DEFAULT_SETTINGS.risk_pct)     : DEFAULT_SETTINGS.risk_pct,
    // theme is handled separately by NavDrawer, just read it for the theme section
    ...(theme === 'light' ? { _theme: 'light' } as object : {}),
  };
}

export function saveLocalSettings(s: UserSettings) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
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
    telegram_chat_id:   String(row.telegram_chat_id ?? ''),
    beginner_mode:      !!(row.beginner_mode ?? false),
    watchlist:          Array.isArray(row.watchlist) ? row.watchlist as string[] : DEFAULT_SETTINGS.watchlist,
    language:           (row.language as string | null) ?? null,
  };
}
