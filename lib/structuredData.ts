import labelDefaults from './labelDefaults.en.json';

/* #1740 item 4: the JSON-LD graphs. Builders only - nothing here renders; components/StructuredData.tsx does that.
 *
 * Pure and dependency-free on purpose, so each graph can be asserted in a unit test without a request, a DOM or
 * credentials - the same split as lib/labelOverrides.ts and lib/fng.ts.
 *
 * ── WHERE THE PRICES COME FROM, AND THE DRIFT THIS INHERITS ──────────────────────────────────────────────
 *
 * From the label values, not from a constant and not from a document: a tracker body carried $35/$350 for two
 * weeks against a real price of $49/$490, so a number typed into a doc is not a source.
 *
 * BUT BE PRECISE ABOUT WHAT THAT BUYS. The authority is the `lhq_labels` ROW, and this reads the shipped
 * DEFAULTS file. They agree today (checked 2026-10-24). If someone changes the database price without the
 * file, the page will render the new price while this emits the old one - and structured data that contradicts
 * the visible price is worse than none, because a search result would quote the stale figure.
 *
 * So the file and the row must be changed together, which is the same coupling #675 describes for every other
 * label. If that becomes hard to hold, the honest fallback is to drop `price` from the Offer and keep `url` and
 * `availability` - an Offer without a price is incomplete, not wrong.
 */

export const BASE_URL = 'https://liquidity-hq.com';

const L = labelDefaults as Record<string, string>;

export type JsonLdGraph = Record<string, unknown>;

/** "$49" -> "49". null when the label is missing or is not a plain currency figure, so a malformed value
 *  omits the price rather than emitting a broken one. */
export function priceFromLabel(key: string): string | null {
  const raw = L[key];
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^\$(\d+(?:\.\d{1,2})?)$/);
  return m ? m[1] : null;
}

/** The publisher. Used on every page, so a crawler can associate the site with one entity. */
export function organizationGraph(): JsonLdGraph {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'LiquidityHQ',
    url: BASE_URL,
    logo: `${BASE_URL}/icons/icon-512.png`,
    description: L.ABOUT_PAGE_SUBTITLE ?? 'Crypto market analytics.',
  };
}

/** The three paid plans as one Product with three Offers. Prices come from the labels; a plan whose price
 *  cannot be read is OMITTED rather than guessed - two offers are better than three with one invented. */
export function proProductGraph(): JsonLdGraph {
  const plans: Array<[string, string, string]> = [
    ['UPGRADE_PRICE_FORTNIGHTLY', 'P2W', 'Fortnightly'],
    ['UPGRADE_PRICE_MONTHLY', 'P1M', 'Monthly'],
    ['UPGRADE_PRICE_ANNUAL', 'P1Y', 'Annual'],
  ];
  const offers = plans
    .map(([key, duration, name]) => {
      const price = priceFromLabel(key);
      return price === null ? null : {
        '@type': 'Offer',
        name: `LiquidityHQ Pro - ${name}`,
        price,
        priceCurrency: 'USD',
        url: `${BASE_URL}/upgrade`,
        availability: 'https://schema.org/InStock',
        /* The billing period, so a search engine does not read $490 as a one-off against $49. */
        eligibleDuration: { '@type': 'QuantitativeValue', value: duration },
      };
    })
    .filter(Boolean);

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'LiquidityHQ Pro',
    url: `${BASE_URL}/upgrade`,
    brand: { '@type': 'Brand', name: 'LiquidityHQ' },
    description: L.UPGRADE_HERO_SUBTITLE ?? 'Full access to the LiquidityHQ market tools.',
    offers,
  };
}

/** Every paired FAQ_Q_*_Q / _A label, in label order. Built from the pairs rather than a hand-kept list, so a
 *  question added to /faq appears here without anyone remembering to copy it. */
export function faqGraph(): JsonLdGraph {
  const entries = Object.keys(L)
    .filter((k) => /^FAQ_Q_.*_Q$/.test(k))
    .map((qKey) => [L[qKey], L[`${qKey.slice(0, -2)}_A`]] as const)
    .filter(([q, a]) => typeof q === 'string' && typeof a === 'string' && q.length > 0 && a.length > 0);

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

/** Home > <page>. Two levels is all this site's flat routing supports; a deeper trail would be invented. */
export function breadcrumbGraph(name: string, path: string): JsonLdGraph {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
      { '@type': 'ListItem', position: 2, name, item: `${BASE_URL}${path}` },
    ],
  };
}
