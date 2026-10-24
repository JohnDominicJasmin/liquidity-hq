import type { MetadataRoute } from 'next';

// Public, unauthenticated, SEO-relevant routes only - not the ~30 authenticated
// app pages (dashboard, arena, journal, etc.), which Google shouldn't index
// (they're behind sign-in and show live per-user data, not stable content).
const BASE = 'https://liquidity-hq.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE}/learn`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE}/about`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/contact`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/faq`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/upgrade`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/terms`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE}/disclaimer`, changeFrequency: 'yearly', priority: 0.2 },

    /* #1740 item 1: the content-bearing tool pages. All public, all 200, none carrying noindex, and all of them
       were missing - the sitemap listed 9 of the 33 public routes and none of the pages people would actually
       search for. Ordered by the word count measured on production 2026-10-24, which is also roughly the order
       of how much there is for a crawler to index.

       NOT ADDED, AND THE OMISSIONS ARE THE DELIBERATE PART: /settings, /journal, /dashboard, /arena, /login,
       /forgot-password, /reset-password and /offline. Personal or transient - a sitemap entry for a page that
       shows per-user data or redirects to sign-in is worse than no entry, because it invites a crawl that can
       only end in a bounce. The rule is "stable content a stranger can read", not "returns 200". */
    { url: `${BASE}/playbook`,      changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${BASE}/scanner`,       changeFrequency: 'daily',   priority: 0.7 },
    { url: `${BASE}/markets`,       changeFrequency: 'daily',   priority: 0.7 },
    { url: `${BASE}/liq`,           changeFrequency: 'daily',   priority: 0.6 },
    { url: `${BASE}/funding`,       changeFrequency: 'daily',   priority: 0.6 },
    { url: `${BASE}/news`,          changeFrequency: 'daily',   priority: 0.6 },
    { url: `${BASE}/econ-calendar`, changeFrequency: 'daily',   priority: 0.6 },
    { url: `${BASE}/correlation`,   changeFrequency: 'weekly',  priority: 0.5 },
    { url: `${BASE}/hours`,         changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/calc`,          changeFrequency: 'monthly', priority: 0.5 },
  ];
}
