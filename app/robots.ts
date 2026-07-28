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
      disallow: ['/api/', '/auth/'],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
