import { createContext, useContext } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

export interface UserSettings {
  // Trading profile
  account_size:     number;
  risk_pct:         number;
  // AI Arena
  default_coin:     string;
  default_tf:       '15m' | '1h' | '4h' | '1d';
  // Notification thresholds (client-side push alerts)
  fr_threshold:     number;   // e.g. 0.05 = 0.05%
  fng_fear:         number;   // alert when F&G <= this
  fng_greed:        number;   // alert when F&G >= this
  rsi_ob:           number;   // alert when RSI 1h >= this
  rsi_os:           number;   // alert when RSI 1h <= this
  // Appearance
  hidden_sections:  string[];
}

export const DEFAULT_SETTINGS: UserSettings = {
  account_size:    1000,
  risk_pct:        1.5,
  default_coin:    'btc',
  default_tf:      '15m',
  fr_threshold:    0.05,
  fng_fear:        15,
  fng_greed:       85,
  rsi_ob:          70,
  rsi_os:          30,
  hidden_sections: [],
};

// Hideable dashboard section ids → display labels
export const DASHBOARD_SECTIONS: { id: string; label: string }[] = [
  { id: 'raid_meter',   label: 'RaidMeter'          },
  { id: 'best_setup',   label: 'Best Setup Now'      },
  { id: 'cascade',      label: 'Cascade Alert'       },
  { id: 'coin_signals', label: 'Coin Signals'        },
  { id: 'session',      label: 'Session Context'     },
  { id: 'catalysts',    label: 'Catalysts & Events'  },
  { id: 'gex',          label: 'GEX (mobile)'        },
  { id: 'macro',        label: 'Macro (mobile)'      },
  { id: 'commandments', label: '8 Commandments'      },
];

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
    account_size:    +(row.account_size    ?? DEFAULT_SETTINGS.account_size),
    risk_pct:        +(row.risk_pct        ?? DEFAULT_SETTINGS.risk_pct),
    default_coin:    String(row.default_coin    ?? DEFAULT_SETTINGS.default_coin),
    default_tf:      (row.default_tf as UserSettings['default_tf']) ?? DEFAULT_SETTINGS.default_tf,
    fr_threshold:    +(row.fr_threshold    ?? DEFAULT_SETTINGS.fr_threshold),
    fng_fear:        +(row.fng_fear        ?? DEFAULT_SETTINGS.fng_fear),
    fng_greed:       +(row.fng_greed       ?? DEFAULT_SETTINGS.fng_greed),
    rsi_ob:          +(row.rsi_ob          ?? DEFAULT_SETTINGS.rsi_ob),
    rsi_os:          +(row.rsi_os          ?? DEFAULT_SETTINGS.rsi_os),
    hidden_sections: (row.hidden_sections  as string[]) ?? DEFAULT_SETTINGS.hidden_sections,
  };
}
