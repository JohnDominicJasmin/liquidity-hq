// Dedup identity for ingested news rows (app/api/news/ingest/route.ts).
//
// Extracted from the route so it can be tested directly - same reason
// lib/grokTokenClamp.ts and lib/telegramLinkCode.ts live outside their routes.
//
// The same story reaches us in two ways that do NOT share an identifier:
//
//   1. Headline revisions on one URL. News desks rewrite headlines after
//      publishing and the RSS feed re-serves the result. NBC ran this on
//      2026-08-03: "Todd Blanche reaches deal..." then "Acting AG Todd Blanche
//      reaches deal... $1.8B" - same URL, same timestamp, one story. A
//      headline key sees two stories.
//
//   2. One story from two feeds. CoinDesk arrives via RSS with a link, and the
//      same article arrives via Finnhub with link: null. A URL key sees two
//      stories, because only one of them has a URL at all.
//
// Neither single key survives both, so callers must check BOTH identities:
// urlKey when a link exists, and headlineKey always.

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

// Identity #2. Deliberately the same 60-char prefix the table's keys have
// always used, so it still matches rows written before URL keys existed.
export function headlineKey(headline: string): string {
  return headline.slice(0, 60).toLowerCase();
}

// The value stored in dedup_key (the table's primary key). Prefers the URL so
// a revised headline cannot create a second row. Finnhub items carry no link
// and keep the headline key.
export function dedupKey(headline: string, link?: string | null): string {
  return normalizeLink(link) ?? headlineKey(headline);
}

// Every identity a row can be recognised by. Used to reject a story we already
// hold under the OTHER identity - which the primary key alone cannot do, since
// the two forms produce different keys for the same article.
export function identitiesOf(headline: string, link?: string | null): string[] {
  const ids = [headlineKey(headline)];
  const url = normalizeLink(link);
  if (url) ids.push(url);
  return ids;
}
