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
const ID_PARAMS = new Set(['p', 'id', 'article', 'articleid', 'story', 'storyid', 'post', 'postid', 'nid', 'newsid']);

export function normalizeLink(link?: string | null): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    /* A site whose article identity is in the QUERY ("?p=123", "article.php?id=9") must keep it, or every story from that site collapses to one host+path key and all but the first are dropped. Only these id-bearing parameters are
       kept (sorted, so their order does not matter); utm_* and every other tracking parameter is still stripped. */
    const keep = [...u.searchParams.entries()]
      .filter(([k]) => ID_PARAMS.has(k.toLowerCase()))
      .map(([k, v]) => k.toLowerCase() + '=' + v)
      .sort();
    const key = host + path + (keep.length ? '?' + keep.join('&') : '');
    return key ? key.slice(0, 300) : null;
  } catch {
    // Not a parseable URL - fall back to the raw string rather than dropping
    // the item's only stable identifier.
    const raw = link.trim().toLowerCase();
    return raw ? raw.slice(0, 300) : null;
  }
}

// Identity #2. THE FULL NORMALISED HEADLINE, not a 60-character prefix (S/N5, N6). The prefix collapsed templated headlines ("Bitcoin ETF sees $120M in net inflows on Monday ..." and "... on Tuesday ...") into one story, and the
// later one was dropped for the whole 12 h window; and the key only lowercased, so curly vs straight quotes, "-" vs an em dash, a double space or a trailing ellipsis made two rows of one story. Normalised: NFKC, lowercased, every
// punctuation or symbol run becomes one space, spaces collapsed; capped at 160 characters. The held-row check recomputes this from each stored headline, so rows written under the old 60-character key are still recognised.
export function headlineKey(headline: string): string {
  return headline
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 160);
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
