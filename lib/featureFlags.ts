import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export type FeatureFlag = 'grok' | 'telegram';

// Same shape as app_config's other keys (maintenance_mode, announcement_banner) -
// a single row, value = { grok: bool, telegram: bool }. Missing key or any
// lookup failure fails OPEN (feature stays on) - a broken config read must
// never silently take down a feature nobody meant to kill.
const DEFAULTS: Record<FeatureFlag, boolean> = { grok: true, telegram: true };

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
    data = { grok: v?.grok ?? true, telegram: v?.telegram ?? true };
  } catch { /* fail open to DEFAULTS */ }

  cache = { data, expires: Date.now() + TTL_MS };
  return data;
}

export async function isFeatureEnabled(flag: FeatureFlag): Promise<boolean> {
  const flags = await getFeatureFlags();
  return flags[flag];
}
