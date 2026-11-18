import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

interface AppConfigPayload {
  maintenanceMode: boolean;
  announcementBanner: { text: string; link: string | null; expiresAt: string | null } | null;
  featureFlags: { grok: boolean; telegram: boolean };
}

const SAFE_DEFAULT: AppConfigPayload = {
  maintenanceMode: false,
  announcementBanner: null,
  featureFlags: { grok: true, telegram: true },
};

// Public, allowlisted read of app_config - only these two keys are ever
// exposed; the table may hold other keys later that stay server-only.
// Polled by every page load (see components/AppShell.tsx's useAppConfig), so
// this is cached in-memory for a short TTL rather than hitting Supabase per
// request. Cache is per-process (resets on deploy) - fine, this app runs as a
// persistent Render web service, not serverless. Fails open to SAFE_DEFAULT on
// any error so a misconfigured/unreachable table never takes the app down.
const TTL_MS = 15_000;
let cache: { data: AppConfigPayload; expires: number } | null = null;

/* CONCURRENT MISSES SHARE ONE READ. When the entry expired, every request in the same instant used to hit the database on its own; now the first one reads and the others wait for its answer. The 15 s lifetime is unchanged
   (these are the maintenance switch and the feature kill switches, so no stale window). */
let inflight: Promise<AppConfigPayload> | null = null;

export async function GET() {
  if (cache && cache.expires > Date.now()) return NextResponse.json(cache.data);
  inflight ??= loadConfig().finally(() => { inflight = null; });
  return NextResponse.json(await inflight);
}

async function loadConfig(): Promise<AppConfigPayload> {
  let data = SAFE_DEFAULT;
  try {
    const admin = getSupabaseAdmin({ deadline: true });
    const { data: rows, error: qErr } = await admin.from(T.app_config)
      .select('key, value').in('key', ['maintenance_mode', 'announcement_banner', 'feature_flags']);
    // supabase-js resolves {data, error} on failure rather than throwing - log
    // it (server-side only, response still fails open below) so a bad key/RLS/
    // schema issue shows up somewhere instead of silently looking like "no rows".
    if (qErr) console.error('/api/config query error:', qErr.message);
    const maintenance = rows?.find(r => r.key === 'maintenance_mode')?.value as { enabled?: boolean } | undefined;
    const banner = rows?.find(r => r.key === 'announcement_banner')?.value as { text?: string; link?: string | null; expiresAt?: string | null } | undefined;
    const flags = rows?.find(r => r.key === 'feature_flags')?.value as { grok?: boolean; telegram?: boolean } | undefined;
    // expiresAt is checked at read time, not cleared in the row - simplest way
    // to auto-hide without a cron. Worst case it lingers up to TTL_MS past expiry.
    const expired = !!banner?.expiresAt && new Date(banner.expiresAt).getTime() <= Date.now();
    data = {
      maintenanceMode: !!maintenance?.enabled,
      announcementBanner: banner?.text && !expired
        ? { text: banner.text, link: banner.link ?? null, expiresAt: banner.expiresAt ?? null }
        : null,
      featureFlags: { grok: flags?.grok ?? true, telegram: flags?.telegram ?? true },
    };
  } catch { /* fail open to SAFE_DEFAULT */ }

  cache = { data, expires: Date.now() + TTL_MS };
  return data;
}
