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
// persistent Render web service, not serverless. A FAILED read answers the LAST KNOWN
// config (see below); SAFE_DEFAULT only when nothing was ever read, so a misconfigured or
// unreachable table never takes the app down.
const TTL_MS = 15_000;
/* A failed read is asked again after 5 s, not 15 s: the answer in between is the last known one. */
const FAIL_RETRY_MS = 5_000;
let cache: { data: AppConfigPayload; expires: number } | null = null;
/* THE LAST CONFIG A READ ACTUALLY RETURNED (PM route audit, 2026-11-20): a database error used to answer SAFE_DEFAULT for 15 s, which silently turned maintenance mode OFF, dropped the banner and switched every kill switch back ON. A kill switch must never turn itself off because the read failed, so a failed read now answers the last known state (the banner dropped if its expiry has passed meanwhile). SAFE_DEFAULT is only for a process that has never had a good read. Set on success only. */
let lastKnown: AppConfigPayload | null = null;

/* CONCURRENT MISSES SHARE ONE READ. When the entry expired, every request in the same instant used to hit the database on its own; now the first one reads and the others wait for its answer. The 15 s lifetime is unchanged
   (these are the maintenance switch and the feature kill switches, so no stale window). */
let inflight: Promise<AppConfigPayload> | null = null;

export async function GET() {
  if (cache && cache.expires > Date.now()) return NextResponse.json(cache.data);
  inflight ??= loadConfig().finally(() => { inflight = null; });
  return NextResponse.json(await inflight);
}

function lastKnownOrDefault(): AppConfigPayload {
  if (!lastKnown) return SAFE_DEFAULT;
  const b = lastKnown.announcementBanner;
  const expired = !!b?.expiresAt && new Date(b.expiresAt).getTime() <= Date.now();
  return expired ? { ...lastKnown, announcementBanner: null } : lastKnown;
}

async function loadConfig(): Promise<AppConfigPayload> {
  let data = SAFE_DEFAULT;
  let failed = false;
  try {
    const admin = getSupabaseAdmin({ deadline: true });
    const { data: rows, error: qErr } = await admin.from(T.app_config)
      .select('key, value').in('key', ['maintenance_mode', 'announcement_banner', 'feature_flags']);
    // supabase-js resolves {data, error} on failure rather than throwing - log
    // it (server-side only, response still fails open below) so a bad key/RLS/
    // schema issue shows up somewhere instead of silently looking like "no rows".
    if (qErr) { console.error('/api/config query error (serving the last known config):', qErr.message); failed = true; }
    else {
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
      lastKnown = data;
    }
  } catch (e) {
    failed = true;
    console.error('/api/config read failed (serving the last known config):', e instanceof Error ? e.message : String(e));
  }
  if (failed) data = lastKnownOrDefault();

  cache = { data, expires: Date.now() + (failed ? FAIL_RETRY_MS : TTL_MS) };
  return data;
}
