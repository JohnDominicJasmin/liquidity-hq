import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/locales';
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

// Let Cloudflare serve this instead of every visitor reaching the origin.
//
// The payload is public and byte-identical for everybody on a given locale -
// it is UI copy, keyed entirely by the ?locale= query string, with no auth and
// nothing user-specific in it. It is also the single largest thing the client
// fetches on a page load (~55 KB brotli), and LabelsProvider requests it on
// EVERY page load. Prod measured `cf-cache-status: DYNAMIC`, meaning Cloudflare
// sits in front of this and was not permitted to help.
//
//   max-age=0   browsers always revalidate, so a locale switch or a label edit
//               is never served from a stale browser copy
//   s-maxage=60 shared caches (Cloudflare) may serve for 60s. Deliberately the
//               same 60s as TTL_MS above, so this introduces NO staleness that
//               the in-memory cache did not already have
//   stale-while-revalidate=300
//               under a burst, the edge may serve slightly-stale copy while it
//               refreshes in the background, rather than stampeding the origin
//
// Consequence to know when seeding labels: an edit can take up to ~60s to reach
// users. That was already true because of TTL_MS. If a change needs to be
// instant, purge the Cloudflare cache for /api/labels - the ?locale= key makes
// that a scoped purge rather than a whole-site one.
const CACHE_CONTROL = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';

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
  if (hit && hit.expires > Date.now()) {
    return NextResponse.json(hit.data, { headers: { 'Cache-Control': CACHE_CONTROL } });
  }

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

  // An empty map means the query failed and we fell open - never a real answer,
  // since every locale has thousands of rows. Do not memoise it and do not let
  // Cloudflare cache it.
  //
  // This matters more now than it did before. Previously a fail-open {} was
  // cached in memory for 60s, which degraded one instance's callers to the
  // client-side DEFAULT_EN_LABELS fallback. If the same response were also
  // stored at the edge it would be served to EVERY visitor for 60s, turning a
  // transient Supabase blip into a site-wide flash of untranslated copy. So the
  // failure path is explicitly no-store, and the in-memory cache skips it too -
  // the next request retries instead of being told the outage is the truth.
  if (Object.keys(data).length === 0) {
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  }

  cache.set(locale, { data, expires: Date.now() + TTL_MS });
  return NextResponse.json(data, { headers: { 'Cache-Control': CACHE_CONTROL } });
}
