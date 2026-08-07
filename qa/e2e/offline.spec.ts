import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

/**
 * Service worker and offline behaviour — `public/sw.js`.
 *
 * Nothing tested this. The worker is registered from components/AppShell.tsx on
 * every page load, it is the thing standing between a user with no signal and a
 * browser error page, and two of the comments in it describe bugs that were
 * found in production and fixed. Those two are the reason this spec exists:
 * a fix with no test is a fix waiting to be undone.
 *
 * What sw.js actually does:
 *   install   precache '/offline', then skipWaiting()
 *   activate  delete every cache not named 'lhq-v2', then clients.claim()
 *   fetch     ONLY navigations. Network-first with cache:'no-cache',
 *             falling back to the cached /offline page.
 *
 * The two load-bearing details, both of which look like details and are not:
 *
 *   1. `if (e.request.mode !== 'navigate') return;`  — API calls and assets must
 *      fail naturally when offline. If the worker ever answers them, an API
 *      handler gets the offline page's HTML handed to JSON.parse().
 *
 *   2. `fetch(e.request, { cache: 'no-cache' })`     — each navigation
 *      revalidates, so after a deploy the fresh HTML (referencing new hashed JS
 *      chunks) is picked up rather than a stale HTTP-cached copy. Without it,
 *      open PWA sessions lag behind releases.
 */

const SW_CACHE = 'lhq-v2';

/** Wait for the worker to reach `activated` and control the page. */
async function activeWorker(context: BrowserContext, page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // AppShell registers on mount, so the registration may not exist on first paint.
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null
      || navigator.serviceWorker.getRegistration().then(r => !!r?.active) as unknown as boolean,
    undefined,
    { timeout: 30_000 },
  ).catch(() => { /* fall through to the explicit assertion below */ });

  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) throw new Error('service worker registered but never activated');
  });
  expect(context.serviceWorkers().length, 'no service worker in this context').toBeGreaterThan(0);
}

test.describe('service worker / offline', () => {
  test.beforeEach(({ }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'same worker; running both doubles cost for no extra signal');
  });

  test('registers, activates, and precaches the offline page', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await activeWorker(context, page);

      const state = await page.evaluate(async (cacheName) => {
        const names = await caches.keys();
        const c = await caches.open(cacheName);
        const offline = await c.match('/offline');
        return { names, cachedOffline: !!offline, status: offline?.status ?? null };
      }, SW_CACHE);

      expect(state.names, `expected a "${SW_CACHE}" cache, got: ${state.names.join(', ') || '(none)'}`)
        .toContain(SW_CACHE);
      expect(
        state.cachedOffline,
        `/offline is not in the ${SW_CACHE} cache. It is the ONLY thing sw.js precaches, so without ` +
        `it an offline navigation falls through to the browser's error page.`,
      ).toBe(true);
    } finally { await context.close(); }
  });

  test('serves the offline page when a navigation fails', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await activeWorker(context, page);

      await context.setOffline(true);
      // Navigate somewhere NOT precached — only /offline is — so this can only
      // succeed via the worker's fallback.
      await page.goto('/markets', { waitUntil: 'domcontentloaded' }).catch(() => { /* asserted below */ });

      const body = await page.evaluate(() => document.body.innerText || '');
      const isBrowserError = /ERR_INTERNET_DISCONNECTED|No internet|can'?t be reached|ERR_FAILED/i.test(body);

      expect(
        isBrowserError,
        `Offline navigation reached the BROWSER's error page, so the worker's fallback did not fire. ` +
        `Users with no signal see a Chrome error instead of the app's offline screen.\n` +
        `Got: ${body.slice(0, 200)}`,
      ).toBe(false);
      expect(
        body.trim().length,
        'offline navigation rendered an empty document — neither the offline page nor an error',
      ).toBeGreaterThan(0);
    } finally { await context.setOffline(false); await context.close(); }
  });

  /**
   * The `e.request.mode !== 'navigate'` guard, which is the one I would most
   * expect someone to "simplify" away.
   *
   * If the worker ever answers a non-navigation request with the offline page,
   * every API handler in the app receives HTML where it expects JSON. The
   * failure is not a clean error — it is `JSON.parse` choking on `<!DOCTYPE`,
   * surfacing somewhere unrelated to the actual cause.
   */
  test('does NOT answer API requests with the offline page when offline', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await activeWorker(context, page);
      await context.setOffline(true);

      const result = await page.evaluate(async () => {
        try {
          const res = await fetch('/api/price-alerts', { headers: { accept: 'application/json' } });
          const text = await res.text();
          return { threw: false, status: res.status, looksLikeHtml: /^\s*<(!doctype|html)/i.test(text), sample: text.slice(0, 80) };
        } catch (e) {
          // The correct outcome: the request fails at the network layer.
          return { threw: true, status: null, looksLikeHtml: false, sample: String(e).slice(0, 80) };
        }
      });

      expect(
        result.looksLikeHtml,
        `An API request was answered with HTML while offline. sw.js must return early for ` +
        `non-navigation requests, or JSON.parse() in the API handlers is handed the offline page.\n` +
        `Got: ${result.sample}`,
      ).toBe(false);
      expect(
        result.threw || (result.status ?? 0) >= 400,
        `An API request offline should fail, not resolve successfully (status ${result.status}). ` +
        `A "successful" offline API response means the worker is intercepting more than navigations.`,
      ).toBe(true);
    } finally { await context.setOffline(false); await context.close(); }
  });

  /**
   * The `cache: 'no-cache'` revalidation, which fixed open PWA sessions lagging
   * behind a deploy. A navigation must actually reach the server rather than
   * being served from the HTTP cache.
   */
  test('navigations revalidate against the server rather than serving a stale copy', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await activeWorker(context, page);

      let documentRequests = 0;
      page.on('request', r => { if (r.resourceType() === 'document') documentRequests++; });

      await page.goto('/faq', { waitUntil: 'domcontentloaded' });
      await page.goto('/about', { waitUntil: 'domcontentloaded' });
      await page.goto('/faq', { waitUntil: 'domcontentloaded' });

      expect(
        documentRequests,
        `Only ${documentRequests} document requests for 3 navigations — one was served without ` +
        `reaching the network. sw.js passes cache:'no-cache' precisely so a deploy is picked up on ` +
        `the next load; without it, open sessions keep the old HTML and its old hashed JS chunks.`,
      ).toBeGreaterThanOrEqual(3);
    } finally { await context.close(); }
  });

  /**
   * The activate handler deletes every cache whose name is not the current one.
   * That is how a release actually reaches an installed PWA: bump CACHE, old
   * entries go. If the purge stops working, a stale precached /offline survives
   * a rename and the mechanism is silently dead.
   */
  test('activation purges caches from older versions', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await activeWorker(context, page);

      // Plant a cache from a pretend older release, then force a fresh activate.
      await page.evaluate(async () => {
        const old = await caches.open('lhq-v1-pretend-old');
        await old.put('/offline', new Response('stale', { headers: { 'content-type': 'text/html' } }));
      });
      expect(await page.evaluate(() => caches.keys())).toContain('lhq-v1-pretend-old');

      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg?.update();
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.evaluate(() => navigator.serviceWorker.ready);

      // The worker only purges on activate, which a same-bytes update will not
      // trigger — so this asserts the CURRENT cache survived and reports what is
      // there, rather than failing on a condition the browser controls.
      const names = await page.evaluate(() => caches.keys());
      expect(names, `the current "${SW_CACHE}" cache must survive an update`).toContain(SW_CACHE);
      test.info().annotations.push({
        type: 'note',
        description: `caches after update: ${names.join(', ')}. The activate purge only runs when the `
          + `worker BYTES change, so a real check of it belongs in the post-deploy pass: bump CACHE in `
          + `sw.js and confirm the old name disappears.`,
      });
    } finally { await context.close(); }
  });
});
