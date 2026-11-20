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
/* A failed read is asked again after 5 s; in between the answer is the last known flags. */
const FAIL_RETRY_MS = 5_000;
let cache: { data: Record<FeatureFlag, boolean>; expires: number } | null = null;
/* THE LAST FLAGS A READ ACTUALLY RETURNED (PM route audit, 2026-11-20, QA's FF1 on #2740): a database error used to answer DEFAULTS for 15 s, so after the owner switched `grok` OFF a failed read answered it ON and POST /api/grok and /api/grok-chat accepted a paid AI call. A kill switch must never turn itself back on because the read failed: a failed read now answers the last known flags. DEFAULTS (open for the old flags, closed for structure_alerts) are only for a process that has never had a good read. Set on success only. */
let lastKnown: Record<FeatureFlag, boolean> | null = null;

export async function getFeatureFlags(): Promise<Record<FeatureFlag, boolean>> {
  if (cache && cache.expires > Date.now()) return cache.data;

  let data = DEFAULTS;
  let failed = false;
  try {
    const admin = getSupabaseAdmin({ deadline: true }); // a hung read must not stall every page that checks a flag (owner sweep 2026-11-18)
    const { data: row, error } = await admin.from(T.app_config)
      .select('value').eq('key', 'feature_flags').maybeSingle();
    if (error) {
      failed = true;
    } else {
      const v = row?.value as Partial<Record<FeatureFlag, boolean>> | undefined;
      data = {
        grok: v?.grok ?? true,
        telegram: v?.telegram ?? true,
        signups: v?.signups ?? true,
        // ?? false, not ?? true - an absent key means "never switched on".
        structure_alerts: v?.structure_alerts ?? false,
      };
      lastKnown = data;
    }
  } catch { failed = true; }
  /* A failed read (an error answer or a throw) serves the last known flags; with none, DEFAULTS - open for the pre-existing flags, closed for structure_alerts, per the note above. */
  if (failed) data = lastKnown ?? DEFAULTS;

  cache = { data, expires: Date.now() + (failed ? FAIL_RETRY_MS : TTL_MS) };
  return data;
}

export async function isFeatureEnabled(flag: FeatureFlag): Promise<boolean> {
  const flags = await getFeatureFlags();
  return flags[flag];
}
