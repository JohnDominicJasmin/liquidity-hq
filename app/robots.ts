import type { MetadataRoute } from 'next';

const BASE = 'https://liquidity-hq.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Only blocking what's unambiguously not real content: API routes and
      // the auth callback. The rest of the app's ~19 other pages aren't
      // individually confirmed auth-gated here, so they're left crawlable
      // by default rather than guessed at - a signed-out crawler hitting a
      // sign-in wall naturally won't rank there anyway.
      /* #1740 item 1: `/ops` added. Not a security hole - every /api/ops/* route is behind requireAdmin -
         but an admin URL in a public index is an invitation to go and rattle the handle, and it costs one
         line not to publish it.

         `/admin` is DELIBERATELY NOT LISTED, and the reason corrects two earlier readings of it. Production
         does serve `<meta name="robots" content="noindex">` for that path, but not because the page sets it:
         app/admin/page.tsx is a HONEYPOT that calls notFound(), so what is served is Next's 404, and Next
         noindexes a 404 by itself. Nothing under app/ sets `robots` metadata anywhere.

         So listing it here would buy nothing it does not already have - and would cost something. robots.txt
         is public, a honeypot's whole value is that it is found by someone guessing rather than announced,
         and well-behaved crawlers are not the visitors it is built for. Publishing the path to everyone who
         reads robots.txt is the one thing a honeypot should not do. */
      disallow: ['/api/', '/auth/', '/ops'],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
