import type { Metadata } from 'next';

/** `noindex, nofollow` for the nine application pages that serve a stranger nothing worth indexing (#1740 item 1).
 *
 * `/dashboard`, `/settings`, `/alerts`, `/arena`, `/briefing`, `/journal`, `/research`, `/live-tracking`, `/backtest`.
 *
 * NOT "BEHIND A SIGN-IN WALL", WHICH IS WHAT THIS COMMENT SAID FIRST AND IS FALSE. **This repo has no `middleware.ts` at all**, and
 * `/arena` renders a deliberate signed-out state. The true reason is thinner and is what the rule actually rests on: **these pages
 * serve a thin signed-out shell, so their links lead to more of the same.** Measured against production as Googlebot, body words
 * only: `/learn` 1605, `/dashboard` 336, `/settings` 68, **`/arena` 67** - the thinnest of the nine, because the Arena's value is
 * client-rendered. `/live-tracking` and `/backtest` answer 307 to `/dashboard`, so those two lines are a no-op. None of the nine is
 * in `sitemap.xml` (19 entries), so nothing reaches them except an external link.
 *
 * **THAT IS TRUE OF TODAY'S RENDERING, AND THIS LINE WILL SILENTLY DEFEAT THE DAY IT STOPS BEING TRUE.** Server-rendering the
 * Arena's content for search is a reasonable thing to want, and whoever does it will not remember this file exists. **If you are
 * here because you just made one of these pages worth indexing: take it off the list in the same change.** Reversing it is deleting
 * one line; noticing that it needs reversing is the hard part, which is why it is written here rather than in a commit message.
 *
 * Two measurements got walked back on the way to this list, both recorded because the method is the reusable part: a greedy
 * script-strip that reported `/arena` at 0 words, and a signed-out-marker count that undercounted the other eight to zero. **The
 * markers were measuring signed-out HANDLING, not signed-out VALUE** - `/settings` has ten of them and 68 words, which is a sign-in
 * prompt, not a usable page.
 *
 * ONE DEFINITION RATHER THAN NINE COPIES, for the reason lib/checkout.ts records about `isProBuyable`: a rule written out by hand
 * in nine files is nine places that have to agree and nothing that makes them. It also gives the assertion something to grep for,
 * and gives the warning above one place to be read by the next person adding a route.
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
