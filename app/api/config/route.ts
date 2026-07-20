import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

interface AppConfigPayload {
  maintenanceMode: boolean;
  announcementBanner: { text: string; link: string | null; expiresAt: string | null } | null;
}

const SAFE_DEFAULT: AppConfigPayload = { maintenanceMode: false, announcementBanner: null };

// Public, allowlisted read of app_config - only these two keys are ever
// exposed; the table may hold other keys later that stay server-only.
// Polled by every page load (see components/AppShell.tsx's useAppConfig), so
// this is cached in-memory for a short TTL rather than hitting Supabase per
// request. Cache is per-process (resets on deploy) - fine, this app runs as a
// persistent Render web service, not serverless. Fails open to SAFE_DEFAULT on
// any error so a misconfigured/unreachable table never takes the app down.
const TTL_MS = 15_000;
let cache: { data: AppConfigPayload; expires: number } | null = null;

export async function GET() {
  if (cache && cache.expires > Date.now()) return NextResponse.json(cache.data);

  let data = SAFE_DEFAULT;
  try {
    const admin = getSupabaseAdmin();
    const { data: rows, error: qErr } = await admin.from(T.app_config)
      .select('key, value').in('key', ['maintenance_mode', 'announcement_banner']);
    // supabase-js resolves {data, error} on failure rather than throwing - log
    // it (server-side only, response still fails open below) so a bad key/RLS/
    // schema issue shows up somewhere instead of silently looking like "no rows".
    if (qErr) console.error('/api/config query error:', qErr.message);
    const maintenance = rows?.find(r => r.key === 'maintenance_mode')?.value as { enabled?: boolean } | undefined;
    const banner = rows?.find(r => r.key === 'announcement_banner')?.value as { text?: string; link?: string | null; expiresAt?: string | null } | undefined;
    // expiresAt is checked at read time, not cleared in the row - simplest way
    // to auto-hide without a cron. Worst case it lingers up to TTL_MS past expiry.
    const expired = !!banner?.expiresAt && new Date(banner.expiresAt).getTime() <= Date.now();
    data = {
      maintenanceMode: !!maintenance?.enabled,
      announcementBanner: banner?.text && !expired
        ? { text: banner.text, link: banner.link ?? null, expiresAt: banner.expiresAt ?? null }
        : null,
    };
  } catch { /* fail open to SAFE_DEFAULT */ }

  cache = { data, expires: Date.now() + TTL_MS };
  return NextResponse.json(data);
}
