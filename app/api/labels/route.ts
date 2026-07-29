import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/labels';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

// Public, unauthenticated read of translated UI copy. Cached per locale in
// memory for a short TTL - this app runs as a persistent Render service,
// not serverless, so the cache survives across requests (see
// app/api/config/route.ts for the same pattern) - and fails open to an
// empty object on any error rather than 500ing the page; the client's t()
// falls back to the raw key when a lookup misses, so an empty response
// degrades to visible keys instead of a crash.
const TTL_MS = 60_000;
const cache = new Map<string, { data: Record<string, string>; expires: number }>();

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('locale') || 'en';
  // Pin to the known locales BEFORE the cache lookup. Keying the cache on an
  // arbitrary caller-supplied string made this route a memory bomb: every
  // unknown locale missed, ran the paged service-role query below, and added
  // a permanent entry to a Map with no eviction. A few thousand requests to
  // ?locale=<random> would exhaust the Render instance - and on the way down,
  // the Supabase pressure makes lib/featureFlags.ts fail open, quietly
  // disabling the grok/telegram/signups kill switches at the worst moment.
  const locale: Locale = (SUPPORTED_LOCALES as string[]).includes(raw) ? raw as Locale : 'en';

  const hit = cache.get(locale);
  if (hit && hit.expires > Date.now()) return NextResponse.json(hit.data);

  let data: Record<string, string> = {};
  try {
    const admin = getSupabaseAdmin();
    const locales = locale === 'en' ? ['en'] : ['en', locale];
    // PostgREST enforces a server-side db-max-rows cap (1000 on this project)
    // that a client-requested .range() cannot override - it silently clamps
    // to that many rows regardless of what's asked for. This bit us for real
    // once the i18n migration crossed 1000 total label rows. Page through in
    // batches under the cap instead of relying on a single request.
    const PAGE_SIZE = 1000;
    const rows: { key: string; locale: string; value: string }[] = [];
    for (let page = 0; ; page++) {
      const from = page * PAGE_SIZE;
      const { data: batch, error } = await admin
        .from(T.labels)
        .select('key, locale, value')
        .in('locale', locales)
        .range(from, from + PAGE_SIZE - 1);
      if (error) { console.error('/api/labels query error:', error.message); break; }
      if (!batch || batch.length === 0) break;
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }

    // English first, then the requested locale layered on top per key - a
    // key not yet translated in the target locale still resolves to
    // English instead of coming back missing.
    const merged = new Map<string, string>();
    for (const row of rows) {
      if (row.locale === 'en') merged.set(row.key, row.value);
    }
    for (const row of rows) {
      if (row.locale === locale) merged.set(row.key, row.value);
    }
    data = Object.fromEntries(merged);
  } catch { /* fail open to {} */ }

  cache.set(locale, { data, expires: Date.now() + TTL_MS });
  return NextResponse.json(data);
}
