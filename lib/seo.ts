import type { Metadata } from 'next';

/** `noindex, nofollow` for the EIGHT application pages that have nothing to offer a stranger (#1740 item 1).
 *
 * `/dashboard`, `/settings`, `/alerts`, `/briefing`, `/journal`, `/research`, `/live-tracking`, `/backtest`.
 *
 * **`/arena` IS NOT ON THAT LIST AND MUST NOT BE ADDED WITHOUT THE OWNER.** It was, in the first version of this file, on the
 * reasoning that these pages sit behind a sign-in wall. **There is no sign-in wall - this repo has no `middleware.ts` at all** - and
 * `/arena` serves anonymous visitors deliberately: `signalPlanFor({ signedIn: !!user, ... })`, a confirmed-signed-out state, and
 * sign-in prompts offered to people who are not signed in. QA counted nine signed-out UI markers there against zero on the other
 * eight. Whether the Arena should be removed from search is an **acquisition decision** - the per-coin AI output is thin and
 * near-duplicate, which is a real argument for it - and that is the owner's call, not a side effect of a metadata PR. `index: false`
 * is not something anyone notices later.
 *
 * ONE DEFINITION RATHER THAN EIGHT COPIES, for the reason lib/checkout.ts records about `isProBuyable`: a rule written out by hand
 * in eight files is eight places that have to agree and nothing that makes them. It also gives the assertion something to grep for,
 * and gives the Arena exclusion above one place to be stated where the next person adding a route will read it.
 *
 * WHAT WAS ACTUALLY WRONG. These routes carried no `name="robots"` tag at all - measured absent on production 2026-10-28 - so
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
 * `follow: false` as well as `index: false`: every link on these eight goes to another page on this list, or to one that is already
 * indexed from somewhere a crawler can actually reach.
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
