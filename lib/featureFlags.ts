import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export type FeatureFlag = 'grok' | 'telegram' | 'signups' | 'structure_alerts';

// Same shape as app_config's other keys (maintenance_mode, announcement_banner) -
// a single row, value = { grok: bool, telegram: bool, signups: bool }. Missing
// key or any lookup failure fails OPEN (feature stays on) - a broken config
// read must never silently take down a feature nobody meant to kill.
//
// 'signups' is also read directly by the hook_restrict_signup_velocity
// Postgres function (supabase/migrations/20260729_signups_kill_switch.sql) -
// that's a SEPARATE read (Auth Hooks run inside Supabase, not this app
// process), so this app-side flag and the DB-side enforcement can never
// drift out of sync with each other, but do share the same app_config row.
// 'structure_alerts' is the ONE flag here that fails CLOSED. The others guard
// features that already existed and were already being delivered, so a broken
// config read must not silently kill them. This one guards a brand-new alert
// type, and the failure it exists to prevent is the opposite: sending an alert
// nobody asked for. Shipped on 2026-07-31 defaulting off after exactly that -
// the intended "off by default" lived in the /alerts page bootstrap, which is
// client-side, so the server-side cron never saw it and started delivering to
// every connected chat on its first run. A default that depends on someone
// loading a page is not a default.
const DEFAULTS: Record<FeatureFlag, boolean> = {
  grok: true, telegram: true, signups: true, structure_alerts: false,
};

const TTL_MS = 15_000;
let cache: { data: Record<FeatureFlag, boolean>; expires: number } | null = null;

export async function getFeatureFlags(): Promise<Record<FeatureFlag, boolean>> {
  if (cache && cache.expires > Date.now()) return cache.data;

  let data = DEFAULTS;
  try {
    const admin = getSupabaseAdmin();
    const { data: row } = await admin.from(T.app_config)
      .select('value').eq('key', 'feature_flags').maybeSingle();
    const v = row?.value as Partial<Record<FeatureFlag, boolean>> | undefined;
    data = {
      grok: v?.grok ?? true,
      telegram: v?.telegram ?? true,
      signups: v?.signups ?? true,
      // ?? false, not ?? true - an absent key means "never switched on".
      structure_alerts: v?.structure_alerts ?? false,
    };
  } catch { /* falls back to DEFAULTS - open for the pre-existing flags,
               closed for structure_alerts, per the note above */ }

  cache = { data, expires: Date.now() + TTL_MS };
  return data;
}

export async function isFeatureEnabled(flag: FeatureFlag): Promise<boolean> {
  const flags = await getFeatureFlags();
  return flags[flag];
}
