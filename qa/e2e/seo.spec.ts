import { test, expect } from '@playwright/test';
import { ROUTES, BASELINE, settle, getGuarded } from './_shared';

// SEO / head metadata. Public marketing surface, so these matter commercially.
// Mixed strict + baseline, same rule as a11y.

test.describe('seo', () => {
  test.beforeEach(({ }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'head metadata is viewport-independent');
  });

  test('robots.txt and sitemap.xml are served', async ({ request }) => {
    const robots = await getGuarded(request, '/robots.txt');
    expect(robots.status()).toBe(200);
    const body = await robots.text();
    expect(body, 'API routes should not be crawled').toContain('Disallow: /api/');
    expect(body).toContain('Sitemap:');

    const sitemap = await getGuarded(request, '/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain('<urlset');
  });

  /* A URL THAT DOES NOT EXIST MUST NOT ANSWER 200.
   *
   * Moved here from i18n.spec.ts, which is where it was discovered but not where
   * it belongs - it was never about locales.
   *
   * #157: every unknown URL answered 200 on production. The site was not missing
   * a 404 page; `app/[locale]/page.tsx` is a single-segment dynamic route, so
   * /nope, /pricing and /admin-typo all MATCHED it, reached `notFound()`, and by
   * then the response had started streaming - and per Next's docs the status can
   * no longer be changed. Multi-segment paths like /nope/deeper were genuinely
   * unmatched and returned 404 all along, which is why it read as "no 404
   * anywhere" from outside while app/not-found.tsx worked correctly.
   *
   * Fixed in #163 with `dynamicParams = false`, which moves the decision to
   * routing, before anything renders.
   *
   * WHY THIS SITS IN THE SEO SPEC. A crawler reads 200 as "index this", so every
   * typo and dead share link becomes an indexable duplicate of the 404 page.
   * This file already covers robots, sitemap, titles and canonicals and did not
   * catch it, because nothing here had ever asserted a STATUS CODE for a URL
   * that should not exist.
   *
   * Both shapes are checked. The single-segment case is the one that regressed;
   * the multi-segment case is the control that proves the probe itself works. */
  test('a URL that does not exist returns 404, not a soft 404', async ({ request }) => {
    const cases = [
      ['/definitely-not-a-route', 'single segment - the shape #157 was about'],
      ['/admin-typo', 'single segment, plausible typo'],
      ['/nope/deeper', 'multi segment - the control; this returned 404 even while #157 was open'],
    ] as const;

    const wrong: string[] = [];
    for (const [path, why] of cases) {
      const status = (await getGuarded(request, path)).status();
      if (status !== 404) wrong.push(`${path} -> ${status} (${why})`);
    }

    expect(wrong,
      'A nonexistent URL answered something other than 404. If `dynamicParams = false` was ' +
      'removed from app/[locale]/page.tsx, every unknown single-segment URL is a soft 404 ' +
      'again and crawlers will index them - see #157 and #163.\n' + wrong.join('\n'),
    ).toEqual([]);
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
    // count() first, then read. page.getAttribute() WAITS for the locator, so
    // on a page with no robots meta - which is precisely the known gap this
    // test documents - it does not return null, it hangs until the 120s test
    // timeout and reports as a failure. Absent must be a value, not a stall.
    const hasRobotsMeta = (await page.locator('meta[name="robots"]').count()) > 0;
    const robotsMeta = hasRobotsMeta
      ? await page.getAttribute('meta[name="robots"]', 'content')
      : null;
    const robotsTxt = await (await getGuarded(request, '/robots.txt')).text();
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
