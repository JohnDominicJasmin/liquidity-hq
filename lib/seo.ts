import type { Metadata } from 'next';

/** `noindex, nofollow` for the signed-in application pages (#1740 item 1).
 *
 * ONE DEFINITION RATHER THAN NINE COPIES, for the reason lib/checkout.ts records about `isProBuyable`: a rule written out by hand in
 * nine files is nine places that have to agree and nothing that makes them. It also gives the assertion something to grep for.
 *
 * WHAT WAS ACTUALLY WRONG. These nine routes carried no `name="robots"` tag at all - measured absent on production 2026-10-28 - so
 * there is nothing here to correct, only something to add. `app/robots.ts` disallows `/api/`, `/auth/` and `/ops` and nothing else,
 * deliberately: it left "the app's ~19 other pages" crawlable rather than guess which were gated.
 *
 * THERE IS NO EXISTING IN-REPO PATTERN TO COPY, which corrects the obvious assumption. Production does serve
 * `<meta name="robots" content="noindex">` for `/admin`, but **not because that page sets it** - `app/admin/page.tsx` is a honeypot
 * that calls `notFound()`, and Next noindexes a 404 by itself. `app/robots.ts` says so in its own comment: "Nothing under app/ sets
 * robots metadata anywhere." This file is the first.
 *
 * ROBOTS.TXT AND THIS ARE NOT THE SAME TOOL, and using the wrong one is how a page stays indexed. `Disallow` asks a crawler not to
 * FETCH a url; it does not ask it not to LIST one, and a disallowed page can still appear in results from inbound links alone -
 * without a fetch, the crawler never sees a noindex tag either. A meta tag is the instruction that actually removes a page, and it
 * requires the page to remain fetchable. So these stay out of robots.txt on purpose.
 *
 * `follow: false` as well as `index: false`: these pages are behind a sign-in wall, so their links go to more of the same.
 *
 * NOT APPLIED to anything a visitor is meant to find: `/`, `/learn`, `/about`, `/faq`, `/ko`, `/zh` and the rest of the public pages
 * are untouched, and that half needs asserting as loudly as this half - a change that noindexes the marketing site would look exactly
 * like a change that worked. */
export const NOINDEX_APP_PAGE: Metadata['robots'] = { index: false, follow: false };

/** The share image every page's `openGraph` must carry (#1740 item 3).
 *
 * A LOCAL `openGraph` OBJECT REPLACES THE ROOT'S, IT DOES NOT MERGE WITH IT. That is the whole bug: `/learn` and `/[locale]` each
 * define `openGraph: { title, description }` for their own wording, and in doing so silently dropped the `images` the root layout
 * sets - so the two pages with the most sharing value had no preview picture, while `/` had one. Nothing warns about this; the
 * metadata simply resolves to the local object.
 *
 * ONE CONSTANT, because the url has already been wrong once: it pointed at `/icons/icon-512.jpg`, which does not exist (the file is
 * a `.png`), and every shared link showed no picture until #1633. Three hand-written copies of a path that must agree is how that
 * recurs.
 *
 * A REAL 1200x630 SHARE IMAGE IS SEPARATE, OWNER-APPROVED WORK and is not this. 512x512 is the app icon pressed into service: it
 * renders as a small square rather than a banner on most platforms. Replacing it is a visual decision. */
export const OG_IMAGES = [{ url: '/icons/icon-512.png', width: 512, height: 512, alt: 'LiquidityHQ' }];
