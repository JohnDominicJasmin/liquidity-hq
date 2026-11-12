/* #1173 landing flash — proving the DEPLOYED build runs the pre-paint redirect before first paint.
 *
 * The node harness (qa review of #2154) proves the script's LOGIC. It cannot prove the deployed
 * build injects and runs that script before the hero paints - script placement and the Next
 * `beforeInteractive` payload are exactly what this repo has been burned by before. So this drives
 * the real deployed page.
 *
 * NO REAL CREDENTIALS. The pre-paint script only checks a session's PRESENCE and expiry in
 * localStorage, so a fabricated `sb-<ref>-auth-token` with a refresh token and a past access-token
 * expiry is enough to exercise the returning-visitor path. The ref is read from the build's own
 * `NEXT_PUBLIC_SUPABASE_URL`, never hardcoded, and asserted NOT to be the prod project.
 *
 * Run it dispatched against the deployed qa site:
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/landing-flash.spec.ts \
 *     -f base_url=https://liquidity-hq-qa.onrender.com
 */
import { test, expect, type Page } from '@playwright/test';

const PROD_REF = 'qdpwhnvmhqgzijuwopso';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.E2E_SUPABASE_URL ?? '';
const REF = SUPABASE_URL ? new URL(SUPABASE_URL).hostname.split('.')[0] : '';

const DAY = 86_400_000;
const nowS = () => Math.floor(Date.now() / 1000);

/* Seed a fabricated session and start watching for the landing hero, BEFORE any app script runs.
 * `__heroSeen` flips the instant an element carrying the hero class attaches - so a redirect that
 * fires before paint leaves it false, which is the whole claim. */
async function seedAndWatch(page: Page, token: Record<string, unknown> | null, lastActive: number | null) {
  await page.addInitScript(([ref, tok, la]) => {
    try {
      if (tok) localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(tok));
      if (la !== null) localStorage.setItem('lhq_last_active', String(la));
    } catch { /* private mode */ }
    (window as unknown as { __heroSeen: boolean }).__heroSeen = false;
    const mark = (n: Node) => {
      if (n instanceof Element && (n.classList?.contains('lp-hero-h1') || n.classList?.contains('lp-hero-glow') || n.querySelector?.('.lp-hero-h1'))) {
        (window as unknown as { __heroSeen: boolean }).__heroSeen = true;
      }
    };
    new MutationObserver(muts => { for (const m of muts) m.addedNodes.forEach(mark); })
      .observe(document.documentElement, { childList: true, subtree: true });
  }, [REF, token, lastActive] as [string, Record<string, unknown> | null, number | null]);
}

const heroSeen = (page: Page) => page.evaluate(() => (window as unknown as { __heroSeen?: boolean }).__heroSeen === true);

test.describe('#1173 the landing flash is gone on the deployed build', () => {
  test.skip(!REF, 'NEXT_PUBLIC_SUPABASE_URL is not set, so the fabricated session key has no ref');
  test.beforeAll(() => {
    expect(REF, 'REFUSING: the Supabase ref is the PROD project - this spec seeds a session and must never touch it').not.toBe(PROD_REF);
  });

  for (const path of ['/', '/ru']) {
    test(`a returning visitor (expired access + valid refresh) on ${path} is redirected to /arena before the hero paints`, async ({ page }) => {
      await seedAndWatch(page, { expires_at: nowS() - 3600, refresh_token: 'fake-refresh' }, Date.now());
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.waitForURL('**/arena', { timeout: 20_000 });
      expect(await heroSeen(page), `the landing hero painted on ${path} before the redirect - the flash is back`).toBe(false);
    });
  }

  test('a dead session (expired, NO refresh) stays on the landing page', async ({ page }) => {
    await seedAndWatch(page, { expires_at: nowS() - 3600 }, Date.now());
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    expect(new URL(page.url()).pathname.replace(/\/+$/, '') || '/', 'a revoked/dead session must not redirect').toBe('/');
  });

  test('an 8-day-inactive session stays on the landing page', async ({ page }) => {
    await seedAndWatch(page, { expires_at: nowS() - 3600, refresh_token: 'fake-refresh' }, Date.now() - 8 * DAY);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    expect(new URL(page.url()).pathname.replace(/\/+$/, '') || '/', 'past the inactivity window, the app is about to sign them out - no redirect').toBe('/');
  });

  test('a signed-out visitor (no session) stays on the landing page', async ({ page }) => {
    await seedAndWatch(page, null, null);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    expect(new URL(page.url()).pathname.replace(/\/+$/, '') || '/', 'a signed-out visitor must see the marketing page').toBe('/');
  });
});
