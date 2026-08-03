// Dedup key for ingested news rows (app/api/news/ingest/route.ts).
//
// Extracted from the route so it can be tested directly - same reason
// lib/grokTokenClamp.ts and lib/telegramLinkCode.ts live outside their routes.

// Strip everything that varies between two links to the same article: scheme,
// www., trailing slash, case, fragment, and the whole query string (utm_* and
// friends). What's left - host + path - is stable across those rewrites.
export function normalizeLink(link?: string | null): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    const key = host + path;
    return key ? key.slice(0, 300) : null;
  } catch {
    // Not a parseable URL - fall back to the raw string rather than dropping
    // the item's only stable identifier.
    const raw = link.trim().toLowerCase();
    return raw ? raw.slice(0, 300) : null;
  }
}

// Prefer the article URL over the headline.
//
// News desks revise headlines after publishing, and the RSS feed then serves
// the revision as a fresh item. NBC ran exactly this on 2026-08-03: "Todd
// Blanche reaches deal with holdout senators to scrap 'anti-weaponization'
// fund" and "Acting AG Todd Blanche reaches deal with holdout senators to end
// $1.8B 'anti-weaponization' fund" - same source, same published_at, same URL,
// one story. A first-60-characters key sees two different prefixes and stores
// both, which is why the same item rendered twice on /news.
//
// Finnhub items carry no link at all (both Finnhub branches in the ingest
// route pass link: null), so they keep the headline-prefix key - unchanged
// behaviour for the only feed that cannot do better.
export function dedupKey(headline: string, link?: string | null): string {
  return normalizeLink(link) ?? headline.slice(0, 60).toLowerCase();
}
