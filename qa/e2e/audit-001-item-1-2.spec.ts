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
  /** Computed style changed on focus - outline, box-shadow or border-color. */
  hasIndicator: boolean;
  /** hasIndicator AND not clipped away by an ancestor's overflow - this is
   *  the one that answers "does a keyboard user actually SEE anything". */
  visible: boolean;
  detail: string;
  contrast: number | null;
}

/** Focuses `target`, compares its computed style against its own resting
 *  state, and reports whether SOMETHING changed (outline, box-shadow or
 *  border-color) - not which specific mechanism, since the fix is free to
 *  use any of them. Best-effort contrast: only computed when outline is the
 *  changed mechanism and a color is extractable, per "where you can".
 *
 *  WHY hasIndicator ALONE ISN'T ENOUGH (found reviewing #1321): a matching
 *  computed style can still draw zero visible pixels - `.ps-inp` in a
 *  suffix row gets `outline: solid 2px` on focus, but its parent `.ps-irow`
 *  sets `overflow: hidden` and the ring sits 2-4px outside the input's own
 *  box, so it's clipped away entirely. `visible` walks every ancestor up to
 *  (not including) <body> for a clipping `overflow`/`overflow-x`/
 *  `overflow-y`, and checks whether the ring's own box (the element's rect
 *  expanded by the outline width, or a box-shadow's parsed spread) would
 *  extend past that ancestor's rect. This is the "at minimum walk the
 *  ancestors" bar, not full sub-pixel screenshot verification - it catches
 *  exactly the clipping shape found on #1321, without needing a PNG-diffing
 *  dependency this repo doesn't otherwise have. */
async function checkFocusRing(page: Page, target: Locator): Promise<FocusCheckResult> {
  await target.scrollIntoViewIfNeeded();
  const before = await target.evaluate(el => {
    const s = getComputedStyle(el);
    return { outline: s.outlineStyle + ' ' + s.outlineWidth, outlineColor: s.outlineColor, boxShadow: s.boxShadow, borderColor: s.borderColor };
  });
  // .focus() (the DOM method, via Playwright's Locator.focus()), not
  // .click({force:true}) - found by diagnosing a false-negative on
  // .st-input: a forced click did NOT put it into :focus-visible at all
  // (Chromium's own heuristic, not this element being unfocusable - a
  // literal `el.focus()` immediately after, in the same page, DID match
  // :focus-visible and showed the real ring). Every other element in this
  // file happened to still register :focus-visible on a forced click, which
  // is what let this go unnoticed until .st-input's result looked like a
  // real gap instead of a test artifact.
  await target.evaluate(el => (el as HTMLElement).focus());
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

  let visible = hasIndicator;
  let clipNote = '';
  if (hasIndicator && (outlineChanged || boxShadowChanged)) {
    const ringPx = outlineChanged
      ? parseFloat(after.outline) || 2
      // Parse a simple "<offset-x> <offset-y> <blur> <spread> <color>" box-shadow
      // for its spread value; falls back to 4px (this app's typical ring
      // width) if the shadow shape doesn't match that pattern.
      : (() => {
          const nums = after.boxShadow.match(/-?\d+(\.\d+)?px/g)?.map(parseFloat) ?? [];
          return nums.length >= 4 ? Math.abs(nums[3]) : 4;
        })();
    const clip = await target.evaluate((el, ring) => {
      const r = el.getBoundingClientRect();
      const ringBox = { left: r.left - ring, top: r.top - ring, right: r.right + ring, bottom: r.bottom + ring };
      let node = el.parentElement;
      while (node && node !== document.body) {
        const cs = getComputedStyle(node);
        const clips = ['hidden', 'clip', 'scroll'].includes(cs.overflow)
          || ['hidden', 'clip', 'scroll'].includes(cs.overflowX)
          || ['hidden', 'clip', 'scroll'].includes(cs.overflowY);
        if (clips) {
          const ar = node.getBoundingClientRect();
          if (ringBox.left < ar.left - 0.5 || ringBox.top < ar.top - 0.5
            || ringBox.right > ar.right + 0.5 || ringBox.bottom > ar.bottom + 0.5) {
            return { clipped: true, by: node.className || node.tagName };
          }
        }
        node = node.parentElement;
      }
      return { clipped: false, by: null };
    }, ringPx);
    if (clip.clipped) {
      visible = false;
      clipNote = ` - CLIPPED by ancestor "${clip.by}" (overflow hidden/clip/scroll cuts off the ring)`;
    }
  }

  const mechanism = outlineChanged ? `outline (${after.outline}, ${after.outlineColor})`
    : boxShadowChanged ? `box-shadow (${after.boxShadow})`
    : borderColorChanged ? `border-color (${before.borderColor} -> ${after.borderColor})`
    : 'none';
  return { hasIndicator, visible, detail: mechanism + clipNote, contrast };
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
        expect.soft(emailResult.visible,
          `login email input (${theme}): no VISIBLE focus indicator (item 1) - ${emailResult.detail}`).toBeTruthy();
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
        expect.soft(pwResult.visible,
          `login password input (${theme}): no VISIBLE focus indicator (item 1) - ${pwResult.detail}`).toBeTruthy();
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
        expect.soft(settingsResult.visible,
          `settings input (${theme}): no VISIBLE focus indicator (item 1, .st-input) - ${settingsResult.detail}`).toBeTruthy();
        if (settingsResult.contrast != null) {
          expect.soft(settingsResult.contrast, `settings input (${theme}) focus outline contrast ` +
            `${settingsResult.contrast.toFixed(2)}:1, below the 3:1 floor`).toBeGreaterThanOrEqual(3);
        }

        await gotoGuarded(page, '/journal');
        await setTheme(page, theme); // reapply - full navigation resets any runtime attribute
        const journalInput = page.locator('[data-testid="journal-input"]').first();
        await expect(journalInput, 'no [data-testid="journal-input"] rendered on /journal').toBeVisible({ timeout: 15_000 });
        const journalResult = await checkFocusRing(page, journalInput);
        expect.soft(journalResult.visible,
          `journal input (${theme}): no VISIBLE focus indicator (item 2, .tj-inp) - ${journalResult.detail}`).toBeTruthy();
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
        expect.soft(result.visible,
          `mobile drawer search (${theme}): no VISIBLE focus indicator (item 2, .nav-search) - ${result.detail}`).toBeTruthy();
        if (result.contrast != null) {
          expect.soft(result.contrast, `mobile drawer search (${theme}) focus outline contrast ` +
            `${result.contrast.toFixed(2)}:1, below the 3:1 floor`).toBeGreaterThanOrEqual(3);
        }
      } finally {
        await ctx.close();
      }
    });

    /* Added after reviewing PR #1321: a suffix-affix `.ps-inp` row (percent/
     * unit suffix rendered AFTER the input, e.g. "Funding Rate (8h) %") and
     * a prefix-affix row ("Account Size $") - two calculator inputs that,
     * per that review, get a matching `outline` on focus but sit inside a
     * `.ps-irow` with `overflow: hidden`, clipping the ring 2-4px outside
     * the input's own box. Both should currently FAIL the `visible` check
     * even though `hasIndicator` alone would pass. */
    test(`focus is visible on the calculators' suffix and prefix inputs (${theme})`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      try {
        await seedAuth(page);
        await setTheme(page, theme);
        await gotoGuarded(page, '/calc');

        // Default tab is Position Sizer - "Account Size $" is a PREFIX row.
        const accountSize = page.getByLabel('Account Size', { exact: true });
        await expect(accountSize, 'Account Size input never rendered on /calc (Position Sizer tab)').toBeVisible({ timeout: 15_000 });
        const acctResult = await checkFocusRing(page, accountSize);
        expect.soft(acctResult.visible,
          `calculator prefix input "Account Size" (${theme}): no VISIBLE focus indicator - ${acctResult.detail}`).toBeTruthy();
        if (acctResult.contrast != null) {
          expect.soft(acctResult.contrast, `"Account Size" (${theme}) focus outline contrast ` +
            `${acctResult.contrast.toFixed(2)}:1, below the 3:1 floor`).toBeGreaterThanOrEqual(3);
        }

        // Funding Cost tab - "Funding Rate (8h)" is a SUFFIX row (% after the input).
        await page.getByText('Funding Cost', { exact: true }).click();
        const fundingRate = page.getByLabel('Funding Rate (8h)', { exact: true });
        await expect(fundingRate, 'Funding Rate input never rendered on /calc (Funding Cost tab)').toBeVisible({ timeout: 10_000 });
        const rateResult = await checkFocusRing(page, fundingRate);
        expect.soft(rateResult.visible,
          `calculator suffix input "Funding Rate" (${theme}): no VISIBLE focus indicator - ${rateResult.detail}`).toBeTruthy();
        if (rateResult.contrast != null) {
          expect.soft(rateResult.contrast, `"Funding Rate" (${theme}) focus outline contrast ` +
            `${rateResult.contrast.toFixed(2)}:1, below the 3:1 floor`).toBeGreaterThanOrEqual(3);
        }
      } finally {
        await ctx.close();
      }
    });
  });
}
