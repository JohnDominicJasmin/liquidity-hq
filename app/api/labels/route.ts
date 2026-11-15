import { NextRequest, NextResponse } from 'next/server';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/locales';
import { getLabels } from '@/lib/labelsServer';

export const dynamic = 'force-dynamic';

// Public, unauthenticated read of translated UI copy. The table is read, cached and refreshed by lib/labelsServer.ts (per locale, in memory; this app runs as a persistent Render service, not
// serverless, so the cache survives across requests): parallel pages, stale-while-revalidate, warmed at server start, never an empty or partial table, and a failed first read answers an empty
// object on any error rather than 500ing the page; the client's t() falls back to the raw key when a lookup misses, so an empty response degrades to the English defaults instead of a crash.
// #1025's failure backoff (10 s) lives there too.

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
  // Pin to the known locales BEFORE the cache lookup. Keying the cache on an arbitrary caller-supplied string made this route a memory bomb: every unknown locale missed, ran the
  // service-role query, and added a permanent entry to a Map with no eviction. A few thousand requests to ?locale=<random> would exhaust the Render instance - and on the way down, the
  // Supabase pressure makes lib/featureFlags.ts fail open, quietly disabling the grok/telegram/signups kill switches at the worst moment.
  const locale: Locale = (SUPPORTED_LOCALES as string[]).includes(raw) ? raw as Locale : 'en';

  const { data, state } = await getLabels(locale);
  /* A FAILED first read (no good table ever loaded) is the one case that answers {}: never memoised, never cached at the edge (a transient Supabase blip must not become a site-wide flash of
     untranslated copy for 60 s). A STALE answer is served at once while the table refreshes behind it; the edge may hold it for only 5 s, so a refreshed table reaches visitors within the TTL
     plus a few seconds instead of a whole extra edge window. Fresh and just-read answers use the normal header. */
  if (state === 'failed') return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json(data, { headers: { 'Cache-Control': state === 'stale' ? 'public, max-age=0, s-maxage=5, stale-while-revalidate=300' : CACHE_CONTROL } });
}
