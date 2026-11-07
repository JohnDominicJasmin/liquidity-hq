import labelDefaults from './labelDefaults.en.json';
import { GLOSSARY_FLAT } from './glossary.ts';

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

/** /playbook as an Article - the richest public page (~2,100 words) carried only the site-wide Organization.
 *
 *  ONLY WHAT THE PAGE ITSELF ESTABLISHES. `headline` is the page's <h1> label, `description` is the meta
 *  description passed in by the layout (so the two cannot disagree), `publisher` is the Organization above.
 *
 *  NO author, datePublished, dateModified, image or rating, and each omission is deliberate: we have no true
 *  value for any of them. The page has no byline and no publish date, and the only image on hand is the logo,
 *  which does not depict the article. Google lists no required Article properties, so an Article without them
 *  is incomplete; one with an invented date or author is wrong. Add a field when the page shows it. */
export function playbookArticleGraph(description: string): JsonLdGraph {
  const url = `${BASE_URL}/playbook`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: L.PLAYBOOK_PAGE_TITLE ?? 'Liquidity Playbook',
    description,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    /* The server-rendered page is English: labels are seeded from the English defaults and the plays are
       English text. A visitor's saved language swaps the labels only after load, never for a crawler. */
    inLanguage: 'en',
    publisher: {
      '@type': 'Organization',
      name: 'LiquidityHQ',
      url: BASE_URL,
      logo: { '@type': 'ImageObject', url: `${BASE_URL}/icons/icon-512.png` },
    },
  };
}

/** The /learn glossary as a `DefinedTermSet` (#1740). One set, one `DefinedTerm` per entry, each anchored
 *  at the `#slug` the page already renders on its `<dt>` - so a result can deep-link to the term itself.
 *
 *  BUILT FROM `GLOSSARY_FLAT`, NOT `ALL_GLOSSARY`, AND THAT IS THE WHOLE CORRECTNESS ARGUMENT.
 *  `lib/glossary.ts` filters entries out when `SHOW_PERFORMANCE_STATS` is off - the default, and
 *  production's state - so `ALL_GLOSSARY` currently holds a term the page does NOT render. Measured:
 *  `GLOSSARY_FLAT` is 29 terms across 5 categories, out of 30 entries, and `STATS_ENTRY_SLUGS` holds the one
 *  that is filtered out (`alert-outcome-tracking`). Emitting the unfiltered list would describe a term a
 *  visitor cannot find, which is the mismatch this file's header calls worse than no structured data at all,
 *  and it would be invisible in review because it depends on a build-time flag rather than on the code.
 *
 *  AN EARLIER VERSION OF THIS COMMENT SAID "TWO TERMS", off a `grep -c 'slug:'` of 31 that had counted the
 *  interface's own `slug: string` declaration as an entry. QA caught it. The count above comes from the
 *  module at runtime instead, which is the only reading that cannot include a type declaration.
 *
 *  Reading the export rather than the raw constant also means the flag moves both together: turning
 *  `SHOW_PERFORMANCE_STATS` on restores the terms to the page and to this graph in the same build.
 *
 *  NAME AND DESCRIPTION COME FROM THE LABELS THE PAGE ACTUALLY SHOWS - `LEARN_CONTENT_HEADING_MAIN` plus
 *  `_ACCENT` are the two halves of the rendered `<h1>` (components/LearnContent.tsx), and `_HERO_SUB` is the
 *  subtitle under it. Same source and same drift coupling as `playbookArticleGraph`: the authority is the
 *  `lhq_labels` row and this reads the shipped defaults, so the two must change together.
 *
 *  `inLanguage: 'en'` for the reason the Article graph gives - the server-rendered page is English, and a
 *  visitor's saved language swaps labels only after load, never for a crawler. The TERMS are not translated at
 *  all: `LearnContent` renders `entry.term` and `entry.definition` straight from the module.
 *
 *  NO `termCode`, `author` or `dateModified`, each omitted because we have no true value - the glossary has no
 *  per-term identifiers and no visible dates. An incomplete set is incomplete; an invented one is wrong. */
export function glossaryGraph(): JsonLdGraph {
  const url = `${BASE_URL}/learn`;
  const heading = [L.LEARN_CONTENT_HEADING_MAIN, L.LEARN_CONTENT_HEADING_ACCENT]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();
  const description = L.LEARN_CONTENT_HERO_SUB;
  return {
    '@context': 'https://schema.org',
    '@type': 'DefinedTermSet',
    '@id': url,
    name: heading || 'Crypto Trading Glossary',
    ...(description ? { description } : {}),
    url,
    inLanguage: 'en',
    hasDefinedTerm: GLOSSARY_FLAT.map((entry) => ({
      '@type': 'DefinedTerm',
      '@id': `${url}#${entry.slug}`,
      name: entry.term,
      description: entry.definition,
      url: `${url}#${entry.slug}`,
      inDefinedTermSet: url,
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
