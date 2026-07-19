import { getSupabaseAdmin } from './supabase-admin';
import { T } from './tables';

// Only these rule_keys carry an unambiguous implied direction (set as
// SignalEntry.dir at the point they fire in app/api/telegram/alert/route.ts).
// Everything else - news, fear_greed, cvd, oi_spike, sentiment_extremes,
// daily_summary, price_alerts - never gets scored: there's no honest way to
// say what "favorable" means for those without fabricating a side.
export const OUTCOME_TRACKED_RULE_KEYS = new Set(['squeeze', 'ema_cross', 'distribution', 'rsi', 'whales']);

export interface FireForOutcome {
  ruleKey: string;
  coin: string;
  dir: 'long' | 'short';
  label: string;
  price: number;
}

export function isOutcomeTracked(ruleKey: string, dir: 'long' | 'short' | undefined, price: number | undefined): dir is 'long' | 'short' {
  return dir != null && price != null && price > 0 && OUTCOME_TRACKED_RULE_KEYS.has(ruleKey);
}

// Best-effort - outcome logging must never break the alert-send cron.
export async function persistAlertFires(fires: FireForOutcome[]): Promise<void> {
  if (fires.length === 0) return;
  try {
    await getSupabaseAdmin().from(T.alert_fires).insert(
      fires.map(f => ({
        rule_key: f.ruleKey, coin: f.coin, dir: f.dir, label: f.label, price_at_fire: f.price,
      }))
    );
  } catch { /* best-effort */ }
}
