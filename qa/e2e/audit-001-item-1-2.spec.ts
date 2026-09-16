import { test, expect, type Page, type Locator } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, FIXTURES, SUPABASE_URL, SUPABASE_ANON } from './_auth';
import { gotoGuarded } from './_shared';

/* Antislop audit 001 (#1309), items 1/2 (AS-A) - keyboard focus indicators.
 * Written and confirmed RED against `dev` BEFORE Dev's fix lands, per
 * PM/DevOps's request. Five representative elements from the audit's own
 * "Where" lists, both terminal themes:
 *   - login email input           (.login-email-input, item 1, [verified])
 *   - login password input        (PasswordField.tsx - reuses the SAME
 *                                   .login-email-input class, item 1)
 *   - a settings input             (.st-input, item 1)
 *   - a journal input              ([data-testid="journal-input"], item 2)
 *   - the mobile drawer search     (.nav-search, item 2)
 *
 * WHY A FULL ELEMENT SWEEP ISN'T HERE. The audit names ~25 elements across
 * two items; this picks one from each of the audit's own groupings (a
 * dedicated CSS class with an override, an inline outline:'none', and a
 * class with literally no focus rule) rather than asserting all 25
 * individually - AS-A's fix is described as a shared pattern, not 25
 * one-off ones, so five representative checks catch a partial fix (some
 * elements patched, some missed) as reliably as an exhaustive list would,
 * for a fifth of the maintenance cost.
 */

async function seedAuth(page: Page) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: FIXTURES.aEmail, password: FIXTURES.aPassword }),
  });
  const session = await res.json();
  expect(session?.access_token, `sign-in failed: HTTP ${res.status}`).toBeTruthy();
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, v]) => localStorage.setItem(k as string, v as string), [
    `sb-${ref}-auth-token`,
    JSON.stringify({
      access_token: session.access_token, refresh_token: session.refresh_token,
      expires_in: session.expires_in, expires_at: Math.floor(Date.now() / 1000) + session.expires_in,
      token_type: 'bearer', user: session.user,
    }),
  ] as [string, string]);
}

/** WCAG relative-luminance contrast ratio between two CSS colors, evaluated
 *  in-page (has DOM access to resolve any color format via a throwaway
 *  element) so this doesn't need its own color-parsing library. */
async function contrastRatio(page: Page, colorA: string, colorB: string): Promise<number | null> {
  return page.evaluate(([a, b]) => {
    function rgb(c: string): [number, number, number] | null {
      const el = document.createElement('div');
      el.style.color = c;
      document.body.appendChild(el);
      const computed = getComputedStyle(el).color;
      document.body.removeChild(el);
      const m = computed.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    }
    function luminance([r, g, b]: [number, number, number]): number {
      const [rs, gs, bs] = [r, g, b].map(v => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }
    const ca = rgb(a); const cb = rgb(b);
    if (!ca || !cb) return null;
    const [l1, l2] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  }, [colorA, colorB]);
}

interface FocusCheckResult {
  hasIndicator: boolean;
  detail: string;
  contrast: number | null;
}

/** Focuses `target`, compares its computed style against its own resting
 *  state, and reports whether SOMETHING changed (outline, box-shadow or
 *  border-color) - not which specific mechanism, since the fix is free to
 *  use any of them. Best-effort contrast: only computed when outline is the
 *  changed mechanism and a color is extractable, per "where you can". */
async function checkFocusRing(page: Page, target: Locator): Promise<FocusCheckResult> {
  await target.scrollIntoViewIfNeeded();
  const before = await target.evaluate(el => {
    const s = getComputedStyle(el);
    return { outline: s.outlineStyle + ' ' + s.outlineWidth, outlineColor: s.outlineColor, boxShadow: s.boxShadow, borderColor: s.borderColor };
  });
  await target.click({ force: true });
  const after = await target.evaluate(el => {
    const s = getComputedStyle(el);
    return { outline: s.outlineStyle + ' ' + s.outlineWidth, outlineColor: s.outlineColor, boxShadow: s.boxShadow, borderColor: s.borderColor };
  });

  const outlineChanged    = after.outline !== before.outline && !after.outline.startsWith('none');
  const boxShadowChanged  = after.boxShadow !== before.boxShadow && after.boxShadow !== 'none';
  const borderColorChanged = after.borderColor !== before.borderColor;
  const hasIndicator = outlineChanged || boxShadowChanged || borderColorChanged;

  let contrast: number | null = null;
  if (outlineChanged) {
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    contrast = await contrastRatio(page, after.outlineColor, bg);
  }

  const mechanism = outlineChanged ? `outline (${after.outline}, ${after.outlineColor})`
    : boxShadowChanged ? `box-shadow (${after.boxShadow})`
    : borderColorChanged ? `border-color (${before.borderColor} -> ${after.borderColor})`
    : 'none';
  return { hasIndicator, detail: mechanism, contrast };
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`Antislop audit 001 - AS-A (#1309 items 1, 2) - ${theme} theme`, () => {
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);

    test(`focus is visible on the login email and password inputs (${theme})`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      try {
        await gotoGuarded(page, '/login');
        await setTheme(page, theme);

        const email = page.locator('input.login-email-input[type="email"]').first();
        await expect(email, 'login email input never rendered').toBeVisible({ timeout: 10_000 });
        const emailResult = await checkFocusRing(page, email);
        expect.soft(emailResult.hasIndicator,
          `login email input (${theme}): no focus indicator - outline/box-shadow/border-color all ` +
          `unchanged on focus (item 1)`).toBeTruthy();
        if (emailResult.contrast != null) {
          expect.soft(emailResult.contrast, `login email input (${theme}) focus outline contrast ` +
            `${emailResult.contrast.toFixed(2)}:1 against body background, below the 3:1 floor`).toBeGreaterThanOrEqual(3);
        }

        // /login defaults to the magic-link form - PasswordField only mounts
        // after switching to password auth (app/login/page.tsx's authMethod
        // state).
        await page.getByText('Use password instead', { exact: true }).click();
        const password = page.locator('input.login-email-input[type="password"]').first();
        await expect(password, 'login password input never rendered').toBeVisible({ timeout: 10_000 });
        const pwResult = await checkFocusRing(page, password);
        expect.soft(pwResult.hasIndicator,
          `login password input (${theme}): no focus indicator (item 1)`).toBeTruthy();
        if (pwResult.contrast != null) {
          expect.soft(pwResult.contrast, `login password input (${theme}) focus outline contrast ` +
            `${pwResult.contrast.toFixed(2)}:1, below the 3:1 floor`).toBeGreaterThanOrEqual(3);
        }
      } finally {
        await ctx.close();
      }
    });

    test(`focus is visible on a settings input and a journal input (${theme})`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      try {
        await seedAuth(page);
        await setTheme(page, theme);

        await gotoGuarded(page, '/settings');
        const settingsInput = page.locator('.st-input').first();
        await expect(settingsInput, 'no .st-input rendered on /settings').toBeVisible({ timeout: 15_000 });
        const settingsResult = await checkFocusRing(page, settingsInput);
        expect.soft(settingsResult.hasIndicator,
          `settings input (${theme}): no focus indicator (item 1, .st-input)`).toBeTruthy();
        if (settingsResult.contrast != null) {
          expect.soft(settingsResult.contrast, `settings input (${theme}) focus outline contrast ` +
            `${settingsResult.contrast.toFixed(2)}:1, below the 3:1 floor`).toBeGreaterThanOrEqual(3);
        }

        await gotoGuarded(page, '/journal');
        await setTheme(page, theme); // reapply - full navigation resets any runtime attribute
        const journalInput = page.locator('[data-testid="journal-input"]').first();
        await expect(journalInput, 'no [data-testid="journal-input"] rendered on /journal').toBeVisible({ timeout: 15_000 });
        const journalResult = await checkFocusRing(page, journalInput);
        expect.soft(journalResult.hasIndicator,
          `journal input (${theme}): no focus indicator (item 2, .tj-inp)`).toBeTruthy();
        if (journalResult.contrast != null) {
          expect.soft(journalResult.contrast, `journal input (${theme}) focus outline contrast ` +
            `${journalResult.contrast.toFixed(2)}:1, below the 3:1 floor`).toBeGreaterThanOrEqual(3);
        }
      } finally {
        await ctx.close();
      }
    });

    test(`focus is visible on the mobile drawer search (${theme})`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // iPhone 13 width, matches the suite's mobile project
      const page = await ctx.newPage();
      try {
        await seedAuth(page);
        await setTheme(page, theme);
        await gotoGuarded(page, '/dashboard');

        const opener = page.locator('.tnav-mmore');
        await expect(opener, '.tnav-mmore (drawer opener) never rendered at mobile width').toBeVisible({ timeout: 15_000 });
        await opener.click();

        const search = page.locator('.nav-search').first();
        await expect(search, '.nav-search never rendered after opening the drawer').toBeVisible({ timeout: 10_000 });
        const result = await checkFocusRing(page, search);
        expect.soft(result.hasIndicator,
          `mobile drawer search (${theme}): no focus indicator (item 2, .nav-search)`).toBeTruthy();
        if (result.contrast != null) {
          expect.soft(result.contrast, `mobile drawer search (${theme}) focus outline contrast ` +
            `${result.contrast.toFixed(2)}:1, below the 3:1 floor`).toBeGreaterThanOrEqual(3);
        }
      } finally {
        await ctx.close();
      }
    });
  });
}
