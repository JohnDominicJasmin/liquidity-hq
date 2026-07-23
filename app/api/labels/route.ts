import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
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
  const locale = req.nextUrl.searchParams.get('locale') || 'en';

  const hit = cache.get(locale);
  if (hit && hit.expires > Date.now()) return NextResponse.json(hit.data);

  let data: Record<string, string> = {};
  try {
    const admin = getSupabaseAdmin();
    const locales = locale === 'en' ? ['en'] : ['en', locale];
    const { data: rows, error } = await admin
      .from(T.labels)
      .select('key, locale, value')
      .in('locale', locales);
    if (error) console.error('/api/labels query error:', error.message);

    // English first, then the requested locale layered on top per key - a
    // key not yet translated in the target locale still resolves to
    // English instead of coming back missing.
    const merged = new Map<string, string>();
    for (const row of rows ?? []) {
      if (row.locale === 'en') merged.set(row.key, row.value);
    }
    for (const row of rows ?? []) {
      if (row.locale === locale) merged.set(row.key, row.value);
    }
    data = Object.fromEntries(merged);
  } catch { /* fail open to {} */ }

  cache.set(locale, { data, expires: Date.now() + TTL_MS });
  return NextResponse.json(data);
}
