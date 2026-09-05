import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendersOwnNav, LANDING_LOCALES } from '../lib/navRoutes.ts';
import { SUPPORTED_LOCALES as LANDING_PAGE_LOCALES } from '../lib/i18n/dictionaries.ts';
import { SUPPORTED_LOCALES as APP_LOCALES } from '../lib/locales.ts';

/* #845. The app nav must not render on a route that draws its own.
 *
 * The bug this pins is not "the wrong boolean" - it is that the test was
 * written as `pathname === '/'`, so it was correct for the one route someone
 * was looking at and silently wrong for every sibling. #714 fixed `/`, #845
 * found `/learn` eight weeks later, and the locale landings were never covered
 * by either. A membership function can be tested; a comparison at a call site
 * cannot, which is most of why it moved.
 *
 * BOTH DIRECTIONS ARE ASSERTED. A predicate that returns true for everything
 * would pass a suite that only checks the marketing routes, and it would take
 * the nav off the entire app.
 */

test('the marketing surfaces render their own nav', () => {
  assert.equal(rendersOwnNav('/'), true, 'the landing page - the #714 case');
  assert.equal(rendersOwnNav('/learn'), true, 'the glossary - the #845 case');
});

test('every locale that HAS a landing page counts, because /ko is / in Korean', () => {
  for (const l of LANDING_PAGE_LOCALES) {
    assert.equal(rendersOwnNav(`/${l}`), true, `/${l} renders LandingContent via app/[locale]/page.tsx`);
  }
});

/* THE BINDING TEST, and the reason this file exists as much as the predicate.
 *
 * LANDING_LOCALES is copied rather than imported - dictionaries.ts is 386 lines
 * of translation payload reached from server code and this predicate runs in a
 * client component. A copy with nothing holding it to the original is how the
 * nav "got down" the first time (see the header of lib/navRoutes.ts). This is
 * the something. */
test('LANDING_LOCALES has not drifted from the landing page own route list', () => {
  assert.deepEqual([...LANDING_LOCALES].sort(), [...LANDING_PAGE_LOCALES].sort(),
    'app/[locale]/page.tsx generates its routes from dictionaries.ts SUPPORTED_LOCALES - ' +
    'add the locale to LANDING_LOCALES too, or its landing page ships with the app nav on it');
});

/* The two lists are DIFFERENT and the difference is the bug I nearly shipped.
 * lib/locales.ts is the app-wide language list (ten); the landing page is
 * generated from dictionaries.ts (two). `dynamicParams = false` 404s the rest -
 * measured on a running build, /ko is 200 and /es is 404 - so gating on the
 * wide list would claim eight routes that do not exist. Asserted so that if the
 * two lists are ever unified, this test says so rather than quietly passing. */
test('the app language list is wider than the landing page one', () => {
  assert.ok(APP_LOCALES.length > LANDING_PAGE_LOCALES.length,
    'if these have converged, rendersOwnNav can import one list and drop the copy');
  assert.equal(rendersOwnNav('/es'), false, '/es is a 404, not a landing page');
  assert.equal(rendersOwnNav('/pt-BR'), false, '/pt-BR is a 404, not a landing page');
});

test('app routes keep the app nav', () => {
  for (const p of ['/dashboard', '/arena', '/liq', '/markets', '/journal', '/settings', '/news']) {
    assert.equal(rendersOwnNav(p), false, `${p} is an app route and must keep the nav`);
  }
});

/* These were checked by hand at 1440x900 and none had a covered control: they
   are public pages reached from INSIDE the app as well as from search, so the
   nav is the right thing to show. Asserted so a future widening of the family
   has to be deliberate. */
test('public info pages are not marketing surfaces - they keep the nav', () => {
  for (const p of ['/faq', '/terms', '/refund', '/disclaimer', '/privacy', '/about']) {
    assert.equal(rendersOwnNav(p), false, `${p} renders inside the app shell`);
  }
});

test('a deeper path under a locale is not a landing page', () => {
  assert.equal(rendersOwnNav('/ko/dashboard'), false);
  assert.equal(rendersOwnNav('/learn/futures'), false);
});

test('an unsupported single segment is not a landing page', () => {
  /* `[locale]` matches every single-segment path, so this predicate must not
     be the thing that decides. `dynamicParams = false` 404s these at routing
     (#157); the gate simply must not claim them. */
  assert.equal(rendersOwnNav('/pricing'), false);
  assert.equal(rendersOwnNav('/nope'), false);
});

test('a trailing slash does not change the answer', () => {
  assert.equal(rendersOwnNav('/learn/'), true);
  assert.equal(rendersOwnNav('/ko/'), true);
  assert.equal(rendersOwnNav('/'), true, 'the root is a trailing slash and must survive the strip');
});
