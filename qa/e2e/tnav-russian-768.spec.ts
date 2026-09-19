import { test, expect, type Browser } from '@playwright/test';
import { SUPABASE_URL, AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

/* #1255 (tracker #1114): `.tnav` overflowed at exactly 768px, signed in, with the UI
 * in Russian - the account-menu button clipped by ~3.6px and two nav items wider
 * than the viewport allows (Dev's measurement: avatarMargin -3.64, 2 overflowing
 * items). English and pt-BR fit. #1222 fixed the 768-945px range for English; this
 * is the language it did not cover.
 *
 * THE MEASUREMENT, as the tracker specifies it: at 768px, signed in, compare `.tnav`'s
 * scrollWidth with its clientWidth. Equal means nothing is pushed past the bar. The
 * overflowing items are recorded either way, so a red run says how far and which.
 *
 * THE CONTROL is the same measurement in ENGLISH, which must fit. Without it a
 * measurement that reads "overflow" everywhere (a broken instrument) would look like
 * a Russian-specific finding.
 *
 * PROVED TO BE THE LANGUAGE ASKED FOR, not assumed: the nav's own text is polled for
 * Cyrillic (Russian) or its absence (English). Two traps found running this:
 * a signed-in account's SAVED language beats the local one (LanguageSync), so the
 * settings READ is rewritten to say the wanted language on the way to the page (no
 * write to the account); and the page paints the shipped English defaults first, so
 * a single read right after load measures the wrong language.
 *
 * Read-only. No AI credits. */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

async function measureTnav(browser: Browser, lang: 'ru' | 'en') {
  const ctx = await signedInContext(browser, 'a', { viewport: { width: 768, height: 900 } });
  await ctx.addInitScript((l) => { localStorage.setItem('lhq_lang_v1', l); }, lang);
  const page = await ctx.newPage();
  await page.route(`${SUPABASE_URL}/rest/v1/**`, async route => {
    if (!/user_settings/.test(route.request().url()) || route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    const json = await res.json().catch(() => null);
    const patch = (row: unknown) => (row && typeof row === 'object' ? { ...(row as Record<string, unknown>), language: lang } : row);
    await route.fulfill({ response: res, json: Array.isArray(json) ? json.map(patch) : patch(json) });
  });
  try {
    await gotoSignedIn(page, '/dashboard');
    const nav = page.locator('.tnav:visible').first();
    await expect(nav, 'no visible .tnav at 768px - the desktop nav is not showing, so this measures nothing').toBeVisible({ timeout: 20_000 });

    await expect.poll(async () => /[Ѐ-ӿ]/.test(await nav.innerText()), {
      message: lang === 'ru'
        ? 'the nav never switched to Russian (no Cyrillic after 30s) - measuring the wrong language'
        : 'the nav has Cyrillic in an English run - measuring the wrong language',
      timeout: 30_000,
    }).toBe(lang === 'ru');
    await page.waitForTimeout(500);

    return await page.evaluate(() => {
      const el = document.querySelector('.tnav') as HTMLElement;
      const rect = el.getBoundingClientRect();
      const items = Array.from(el.querySelectorAll<HTMLElement>('.tnav-item'));
      return {
        innerWidth: window.innerWidth,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        overflowingItems: items.filter(i => i.getBoundingClientRect().right > rect.right + 0.5).map(i => i.textContent?.trim()),
      };
    });
  } finally {
    await ctx.close();
  }
}

test.describe('.tnav at 768px, signed in (#1255)', () => {
  test('in Russian, .tnav does not overflow: scrollWidth equals clientWidth', async ({ browser }) => {
    const m = await measureTnav(browser, 'ru');
    test.info().annotations.push({ type: 'measurement-ru', description: JSON.stringify(m) });
    expect(m.scrollWidth, `.tnav overflows at 768px in Russian: scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}. ${JSON.stringify(m)}`)
      .toBeLessThanOrEqual(m.clientWidth);
  });

  test('CONTROL: in English the same measurement fits, so the instrument can read "equal"', async ({ browser }) => {
    const m = await measureTnav(browser, 'en');
    test.info().annotations.push({ type: 'measurement-en', description: JSON.stringify(m) });
    expect(m.scrollWidth, `.tnav overflows at 768px in ENGLISH too: scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}. ${JSON.stringify(m)} - the Russian result is not specific to Russian`)
      .toBeLessThanOrEqual(m.clientWidth);
  });
});
