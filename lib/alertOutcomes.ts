import { getSupabaseAdmin } from './supabase-admin';
import { T } from './tables';

// Only these rule_keys carry an unambiguous implied direction (set as
// SignalEntry.dir at the point they fire in app/api/telegram/alert/route.ts).
// Everything else - news, fear_greed, cvd, oi_spike, sentiment_extremes,
// daily_summary, price_alerts - never gets scored: there's no honest way to
// say what "favorable" means for those without fabricating a side.
// ema_cross is gone (replaced by ema_signal_<tf> - see pendings/ALERTS.md);
// the new signal has a real entry/SL/TP and is at least as trackable.
export const OUTCOME_TRACKED_RULE_KEYS = new Set([
  'squeeze', 'distribution', 'rsi', 'whales',
  'ema_signal_1m', 'ema_signal_5m', 'ema_signal_15m', 'ema_signal_30m',
  'ema_signal_1h', 'ema_signal_2h', 'ema_signal_4h', 'ema_signal_1d',
]);

export interface FireForOutcome {
  ruleKey: string;
  coin: string;
  dir: 'long' | 'short';
  label: string;
  price: number;
  /* How much agreement existed for this coin in the same scan - see the
     migration 20260801a comment for why this rather than the Arena Confluence
     Score (which the cron cannot compute: its Order Flow factor needs data that
     only reaches the browser). Optional so a caller that does not know can omit
     them and the row records null rather than a misleading 1/0. */
  agreeCount?: number;
  agreeNet?: number;
}

export function isOutcomeTracked(ruleKey: string, dir: 'long' | 'short' | undefined, price: number | undefined): dir is 'long' | 'short' {
  return dir != null && price != null && price > 0 && OUTCOME_TRACKED_RULE_KEYS.has(ruleKey);
}

// Mirrors the CD cooldown windows in app/api/telegram/alert/route.ts for each
// outcome-tracked rule_key. The alert cron's own in-memory `lastSent` map is
// meant to suppress re-fires within these windows, but it's a plain module-
// level Map with no persistence - it resets to empty on every deploy/process
// restart, which then lets the same condition "fire" repeatedly within
// minutes. That's harmless for notification noise, but fatal for this
// table's honesty: the same real-world event would get logged (and scored)
// as N separate data points, skewing win-rate stats toward whatever just
// happened to redeploy. The DB is the only state that survives a restart, so
// dedup happens here against it, independent of the cron's own cooldown.
const OUTCOME_DEDUP_MS: Record<string, number> = {
  squeeze: 4 * 3600_000,
  distribution: 4 * 3600_000,
  rsi: 4 * 3600_000,
  whales: 30 * 60_000,
  // EMA Buy/Sell Signal - roughly 2x each timeframe's own candle period.
  // Belt-and-suspenders alongside the cron's own in-memory identity dedup
  // (emaSignalLastTs), which resets on every redeploy - this is the one that
  // survives a restart and keeps the outcome table honest.
  ema_signal_1m: 10 * 60_000,
  ema_signal_5m: 30 * 60_000,
  ema_signal_15m: 60 * 60_000,
  ema_signal_30m: 2 * 3600_000,
  ema_signal_1h: 4 * 3600_000,
  ema_signal_2h: 8 * 3600_000,
  ema_signal_4h: 12 * 3600_000,
  ema_signal_1d: 48 * 3600_000,
};

// Best-effort - outcome logging must never break the alert-send cron.
export async function persistAlertFires(fires: FireForOutcome[]): Promise<void> {
  if (fires.length === 0) return;
  try {
    const admin = getSupabaseAdmin();
    const toInsert: FireForOutcome[] = [];
    for (const f of fires) {
      const windowMs = OUTCOME_DEDUP_MS[f.ruleKey] ?? 0;
      if (windowMs > 0) {
        const cutoff = new Date(Date.now() - windowMs).toISOString();
        const { data } = await admin
          .from(T.alert_fires)
          .select('id')
          .eq('rule_key', f.ruleKey).eq('coin', f.coin).eq('dir', f.dir)
          .gte('fired_at', cutoff)
          .limit(1);
        if (data && data.length > 0) continue; // same event already logged within its cooldown window
      }
      toInsert.push(f);
    }
    if (toInsert.length === 0) return;
    await admin.from(T.alert_fires).insert(
      toInsert.map(f => ({
        rule_key: f.ruleKey, coin: f.coin, dir: f.dir, label: f.label, price_at_fire: f.price,
        agree_count: f.agreeCount ?? null,
        agree_net:   f.agreeNet   ?? null,
      }))
    );
  } catch { /* best-effort */ }
}
