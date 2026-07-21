import { NextResponse } from 'next/server';
import { withOwner } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

type ConfigKey = 'maintenance_mode' | 'announcement_banner' | 'feature_flags';
const VALID_KEYS: ConfigKey[] = ['maintenance_mode', 'announcement_banner', 'feature_flags'];

// GET /api/ops/config - current values for the /ops/config form, plus the last
// 10 banner saves (from admin_audit_log) so the page can show which banner is
// live vs a past/replaced one. There's nothing admin-only in the values
// themselves, only in who may change them (see PATCH below).
export const GET = withOwner(async () => {
  const admin = getSupabaseAdmin();
  const [configRes, historyRes] = await Promise.all([
    admin.from(T.app_config).select('key, value').in('key', VALID_KEYS),
    admin.from(T.admin_audit_log)
      .select('actor_email, detail, created_at')
      .eq('action', 'config_announcement_banner')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);
  if (configRes.error) return NextResponse.json({ error: configRes.error.message }, { status: 500 });

  const byKey = Object.fromEntries((configRes.data ?? []).map(r => [r.key, r.value]));
  return NextResponse.json({
    maintenance_mode: byKey.maintenance_mode ?? { enabled: false },
    announcement_banner: byKey.announcement_banner ?? { text: '', link: null, expiresAt: null },
    feature_flags: byKey.feature_flags ?? { grok: true, telegram: true },
    banner_history: (historyRes.data ?? []).map(r => ({
      value: r.detail?.value ?? {},
      actor_email: r.actor_email,
      created_at: r.created_at,
    })),
  });
});

// PATCH /api/ops/config - owner-only. Body: { key, value }. Upserts a single
// app_config row. Public /api/config picks it up within its 15s cache TTL -
// a few seconds of staleness is fine for maintenance mode / a banner, not
// worth a cross-route cache-invalidation mechanism for this.
export const PATCH = withOwner(async (req, { user }) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const key = body.key as ConfigKey;
  if (!VALID_KEYS.includes(key)) {
    return NextResponse.json({ error: 'Unknown config key.' }, { status: 400 });
  }
  const value = body.value;
  if (typeof value !== 'object' || value === null) {
    return NextResponse.json({ error: 'value must be an object.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from(T.app_config).upsert(
    { key, value, updated_by: user.email, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from(T.admin_audit_log).insert({
    actor_email: user.email,
    action: `config_${key}`,
    detail: { value },
  });

  return NextResponse.json({ ok: true });
});
