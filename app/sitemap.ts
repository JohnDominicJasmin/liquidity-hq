import type { MetadataRoute } from 'next';

// Public, unauthenticated, SEO-relevant routes only - not the ~30 authenticated
// app pages (dashboard, arena, journal, etc.), which Google shouldn't index
// (they're behind sign-in and show live per-user data, not stable content).
const BASE = 'https://liquidity-hq.onrender.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE}/learn`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE}/about`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/faq`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/upgrade`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/terms`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE}/disclaimer`, changeFrequency: 'yearly', priority: 0.2 },
  ];
}
