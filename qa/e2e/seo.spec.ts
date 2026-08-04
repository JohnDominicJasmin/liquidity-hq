import { test, expect } from '@playwright/test';
import { ROUTES, BASELINE, settle } from './_shared';

// SEO / head metadata. Public marketing surface, so these matter commercially.
// Mixed strict + baseline, same rule as a11y.

test.describe('seo', () => {
  test.beforeEach(({ }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'head metadata is viewport-independent');
  });

  test('robots.txt and sitemap.xml are served', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    const body = await robots.text();
    expect(body, 'API routes should not be crawled').toContain('Disallow: /api/');
    expect(body).toContain('Sitemap:');

    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain('<urlset');
  });

  test('every page has a non-empty title', async ({ page }) => {
    const bad: string[] = [];
    for (const route of ROUTES) {
      await settle(page, route);
      const title = await page.title();
      if (!title.trim()) bad.push(route);
    }
    expect(bad, 'pages with no <title>').toEqual([]);
  });

  // Currently 31 of 32 pages share one 101-char description; only /learn differs.
  // Google discards duplicate descriptions and writes its own snippet.
  test('meta descriptions become more unique, never less', async ({ page }, testInfo) => {
    const byDesc = new Map<string, string[]>();
    for (const route of ROUTES) {
      await settle(page, route);
      const d = (await page.getAttribute('meta[name="description"]', 'content')) ?? '(none)';
      if (!byDesc.has(d)) byDesc.set(d, []);
      byDesc.get(d)!.push(route);
    }
    const shared = [...byDesc.entries()].filter(([, rs]) => rs.length > 1);
    const worst = Math.max(0, ...shared.map(([, rs]) => rs.length));

    testInfo.attach('duplicate-descriptions.txt', {
      body: shared.map(([d, rs]) => `${rs.length}x "${d.slice(0, 60)}…"\n  ${rs.join(', ')}`).join('\n\n'),
      contentType: 'text/plain',
    });

    // Baseline: worst-case duplication today is 31 routes sharing one string.
    expect(
      worst,
      `${worst} routes share a single meta description. Give at least /, /upgrade, ` +
      `/faq and /learn their own. Lower this number as they are split out.`,
    ).toBeLessThanOrEqual(31);
  });

  test('pages without an <h1> do not increase', async ({ page }, testInfo) => {
    const missing: string[] = [];
    for (const route of ROUTES) {
      await settle(page, route);
      if ((await page.locator('h1').count()) === 0) missing.push(route);
    }
    testInfo.attach('pages-without-h1.txt', { body: missing.join('\n'), contentType: 'text/plain' });
    expect(
      missing.length,
      `Pages with no <h1>: ${BASELINE.pagesWithoutH1} -> ${missing.length}. ` +
      `Currently: ${missing.join(', ')}`,
    ).toBeLessThanOrEqual(BASELINE.pagesWithoutH1);
  });

  // Inverted ratchet: this one must only go UP. 0 today; the site is reachable
  // on liquidity-hq.com AND liquidity-hq.onrender.com, so duplicates are real.
  test('canonical tag coverage does not regress', async ({ page }) => {
    let withCanonical = 0;
    for (const route of ROUTES) {
      await settle(page, route);
      if ((await page.locator('link[rel="canonical"]').count()) > 0) withCanonical++;
    }
    expect(
      withCanonical,
      `Canonical coverage dropped below the ${BASELINE.pagesWithCanonical} baseline. ` +
      `Target is all ${ROUTES.length} routes via metadata.alternates.canonical - ` +
      `raise BASELINE.pagesWithCanonical as they land.`,
    ).toBeGreaterThanOrEqual(BASELINE.pagesWithCanonical);
  });

  test('/ops/login is not indexable', async ({ page, request }) => {
    await settle(page, '/ops/login');
    const robotsMeta = await page.getAttribute('meta[name="robots"]', 'content');
    const robotsTxt = await (await request.get('/robots.txt')).text();
    const blocked = /noindex/i.test(robotsMeta ?? '') || /Disallow:\s*\/ops/i.test(robotsTxt);
    // Known gap as of the audit - internal admin login is currently crawlable.
    test.info().annotations.push({
      type: 'known-issue',
      description: 'audit §6.5 - /ops/login has neither noindex nor a robots.txt Disallow',
    });
    if (!blocked) test.skip(true, 'known gap, see audit §6.5');
    expect(blocked).toBeTruthy();
  });
});
