import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SUPPORTED_LOCALES, isSupportedLocale, dirForLocale, getDictionary } from '../lib/i18n/dictionaries.ts';

/* #138. Arabic shipped in the picker with RTL unimplemented: /ar served
 * `<html lang="en">` with no `dir`, and `dirForLocale` reached one div inside
 * LandingContent. An Arabic reader got Arabic text in a left-to-right layout.
 *
 * The decision was to withdraw the OFFER and keep the WORK. So these assert
 * both halves - that `ar` is not offered anywhere, and that everything needed
 * to offer it again is still here.
 *
 * Comments are stripped before scanning source. Written without that, the
 * picker test passes on the comment that says العربية was removed - which has
 * happened to four of these suites in one session, so it is now a habit.
 */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const read = (p: string) =>
  strip(readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));

test('Arabic is not offered', async (t) => {
  await t.test('it is not a supported locale', () => {
    assert.equal(isSupportedLocale('ar'), false);
    assert.deepEqual([...SUPPORTED_LOCALES], ['ko', 'zh']);
  });

  /* The picker is the only place a user can choose one, so this is the
     assertion that maps to "can somebody still pick Arabic". */
  await t.test('it is not in the language picker', () => {
    const src = read('components/LanguageSwitcher.tsx');
    assert.doesNotMatch(src, /code:\s*'ar'/, 'Arabic is still selectable in the picker');
    assert.doesNotMatch(src, /'\/ar'/, 'the picker still links to /ar');
  });

  /* generateStaticParams now derives from SUPPORTED_LOCALES. A literal list is
     what let the two disagree in the first place. */
  await t.test('no Arabic route is prerendered', () => {
    const src = read('app/[locale]/page.tsx');
    assert.doesNotMatch(src, /locale:\s*'ar'/, 'a literal ar entry is back in generateStaticParams');
    assert.match(src, /SUPPORTED_LOCALES/, 'generateStaticParams no longer derives from SUPPORTED_LOCALES');
  });

  /* An unsupported locale must 404, not render English at /ar - a page that
     silently serves the wrong language is the failure one layer down. */
  await t.test('/ar is no longer a supported locale value', () => {
    assert.equal(isSupportedLocale('ar'), false);
    assert.equal(isSupportedLocale('ko'), true);
    assert.equal(isSupportedLocale('zh'), true);
  });
});

test('the Arabic work is preserved, not deleted', async (t) => {
  /* The decision was "withdraw the offer", not "throw away the translation".
     Deleting the dictionary is the tempting tidy-up and it destroys the only
     part of this that was actually finished. */
  await t.test('the translated dictionary still exists', () => {
    const src = read('lib/i18n/dictionaries.ts');
    assert.match(src, /export const ar: LandingDict/, 'the Arabic dictionary was deleted');
  });

  /* dirForLocale takes a string precisely so removing `ar` from the Locale type
     could not turn `locale === 'ar'` into a compile error that someone "fixes"
     by deleting the RTL branch. */
  await t.test('dirForLocale still knows Arabic is right-to-left', () => {
    assert.equal(dirForLocale('ar'), 'rtl');
    assert.equal(dirForLocale('en'), 'ltr');
    assert.equal(dirForLocale('ko'), 'ltr');
  });

  await t.test('an unknown locale falls back to English rather than throwing', () => {
    assert.equal(getDictionary('ar').hero.sub, getDictionary('en').hero.sub,
      'ar now resolves to the English dictionary, which is the intended fallback');
    assert.ok(getDictionary('klingon'));
  });
});

/* #157 — a bad URL answered HTTP 200.
 *
 * The site was not missing a 404 page. It had a CATCH-ALL in front of one:
 * `app/[locale]/page.tsx` is a single-segment dynamic route, so /nope, /pricing
 * and /admin-typo all matched it, reached `notFound()`, and answered 200 —
 * because by then the response had started streaming and, per Next's own docs,
 * "the status code of the response cannot be updated".
 *
 * Measured on a production build before and after:
 *
 *            before   after
 *   /nope      200      404
 *   /ar        200      404
 *   /ko        200      200
 *
 * Multi-segment paths like /nope/deeper were genuinely unmatched and returned
 * 404 all along, which is why the issue looked like "no 404 anywhere" from the
 * outside while `app/not-found.tsx` was working correctly.
 *
 * `dynamicParams = false` moves the decision to routing, before anything
 * renders. It only works BECAUSE generateStaticParams enumerates the locales -
 * the two are one mechanism, so both are asserted together. Deriving that list
 * from SUPPORTED_LOCALES is what stops a locale being removed from the picker
 * and left reachable here.
 */
test('an unknown locale is refused at routing, not while rendering', async (t) => {
  const src = read('app/[locale]/page.tsx');

  await t.test('dynamicParams is disabled', () => {
    assert.match(src, /export\s+const\s+dynamicParams\s*=\s*false/,
      'without this a bad URL renders, streams, and answers 200 - see #157');
  });

  /* dynamicParams=false 404s anything generateStaticParams did not list, so an
     empty or hardcoded list silently changes which URLs exist. */
  await t.test('the generated list still derives from SUPPORTED_LOCALES', () => {
    assert.match(src, /generateStaticParams[\s\S]{0,200}SUPPORTED_LOCALES/,
      'generateStaticParams no longer derives from SUPPORTED_LOCALES - with ' +
      'dynamicParams=false that decides which URLs return 404');
  });

  /* Kept as defence and now unreachable in production. Removing it is safe
     today and unsafe the moment dynamicParams changes, which is exactly the
     kind of coupling worth pinning. */
  await t.test('the runtime guard is still there as a second line', () => {
    assert.match(src, /isSupportedLocale\(locale\)/);
    assert.match(src, /notFound\(\)/);
  });
});

/* #138 REOPENED, then fixed properly.
 *
 * The first fix removed `ar` from lib/i18n/dictionaries.ts and the landing
 * picker. It missed that this app has TWO independent locale systems, and the
 * other one - lib/locales.ts, driving LanguageNavSwitcher and LanguageSelect -
 * still offered العربية app-wide. A user could pick it from the nav or from
 * /settings and get Arabic labels in a left-to-right layout: the exact state
 * #138 was filed about, still reachable after #138 "closed".
 *
 * My original test asserted the file I had edited. It could not fail on the
 * list I did not know existed. So this one enumerates the pickers from BOTH
 * sources rather than naming either.
 */
test('Arabic is not offered by ANY picker', async (t) => {
  const { AVAILABLE_LOCALES, SUPPORTED_LOCALES: APP_LOCALES } =
    await import('../lib/locales.ts');

  await t.test('not in the app-wide offer list', () => {
    assert.equal(AVAILABLE_LOCALES.includes('ar' as never), false,
      'ar is offered app-wide again - LanguageNavSwitcher and LanguageSelect ' +
      'both render AVAILABLE_LOCALES, so this is selectable from the nav');
  });

  /* Deliberately still in the VALIDATION list. Someone who chose Arabic before
     it was withdrawn has 'ar' in localStorage; it must resolve and fall back to
     English labels, not fail. Asserting this stops a tidy-up removing it. */
  await t.test('still in the validation list, so a stored preference resolves', () => {
    assert.ok(APP_LOCALES.includes('ar' as never),
      'ar was removed from SUPPORTED_LOCALES too - a preference already stored ' +
      'as ar now fails validation instead of falling back');
  });

  /* Both pickers read AVAILABLE_LOCALES rather than hardcoding, which is what
     makes the one-line removal sufficient. If either grows its own list, the
     assertion above stops covering it. */
  for (const f of ['components/LanguageNavSwitcher.tsx', 'components/LanguageSelect.tsx']) {
    await t.test(`${f} still derives from AVAILABLE_LOCALES`, () => {
      assert.match(read(f), /AVAILABLE_LOCALES/,
        `${f} no longer derives its options from AVAILABLE_LOCALES - removing a ` +
        `locale centrally would no longer remove it from this picker`);
    });
  }
});

/* #164, second attempt. The first one called useLabels() from a component
 * mounted OUTSIDE LabelsProvider, so the hook returned the context default and
 * `lang` stayed 'en' on every route while the page rendered Korean. My test
 * asserted the hook was CALLED - it was. QA caught it in a browser.
 *
 * So the decision is now a pure function, testable without a provider, and the
 * effect lives in the component that owns the locale. What a source test still
 * cannot prove is that the caller is mounted correctly; that assertion belongs
 * in qa/e2e and QA is adding it. */
test('html lang and dir follow path first, then the labels locale', async (t) => {
  const { htmlLangFor } = await import('../lib/htmlLang.ts');

  await t.test('a locale path wins over a stored preference', () => {
    assert.deepEqual(htmlLangFor('/ko', 'zh'), { lang: 'ko', dir: 'ltr' });
  });

  /* The case #164 is about: no locale in the URL, so the labels layer is the
     only thing that knows what the user is reading. */
  await t.test('a route with no locale segment follows the labels locale', () => {
    assert.deepEqual(htmlLangFor('/upgrade', 'ko'), { lang: 'ko', dir: 'ltr' });
    assert.deepEqual(htmlLangFor('/dashboard', 'zh'), { lang: 'zh', dir: 'ltr' });
  });

  /* A stored preference for a locale that is not a landing ROUTE must not be
     read out of the path - /russia-page is not Russian. */
  await t.test('only real locale routes count as a path locale', () => {
    assert.equal(htmlLangFor('/russia-page', 'ru').lang, 'ru');
    assert.equal(htmlLangFor('/nope', 'en').lang, 'en');
  });

  /* Arabic is no longer offered, but a preference stored before that shipped
     still resolves - and if it does, dir must follow it. */
  await t.test('a stored Arabic preference still sets rtl', () => {
    assert.deepEqual(htmlLangFor('/upgrade', 'ar'), { lang: 'ar', dir: 'rtl' });
  });

  await t.test('an unknown path before hydration falls back to English', () => {
    assert.deepEqual(htmlLangFor(null, 'en'), { lang: 'en', dir: 'ltr' });
  });
});

/* The mount is the part that broke, so it is asserted explicitly: the effect
   must live in LabelsProvider, which is the only component wrapped around every
   route by all four AppShell branches. */
test('the lang effect lives inside the provider that owns the locale', () => {
  const src = read('components/LabelsProvider.tsx');
  assert.match(src, /htmlLangFor\(pathname, locale\)/,
    'LabelsProvider no longer sets lang. Moved back outside the provider, ' +
    'useLabels() returns the context default and lang is en everywhere (#164)');
  assert.match(src, /documentElement\.lang/);
  assert.match(src, /documentElement\.dir/);
});

/* #165, found by QA exercising the case I asked them to.
 *
 * `ar` out of every picker left anyone who had already chosen it stuck: labels
 * still Arabic, nav chip still AR, and no picker entry to change back. Measured
 * end state was Arabic pronunciation announced over partly-English copy - the
 * same mismatch as #164 with the operands swapped.
 *
 * Clamping `lang` alone would only move the mismatch, so the clamp belongs to
 * the LOCALE: a preference that is no longer offered resolves to English, and
 * labels, lang, dir and the nav chip then agree.
 */
test('a preference for a withdrawn language resolves to English', async (t) => {
  const { resolveOfferedLocale } = await import('../lib/locales.ts');

  await t.test('Arabic - recognised, translated, no longer offered', () => {
    assert.equal(resolveOfferedLocale('ar'), 'en');
  });

  await t.test('offered languages are untouched', () => {
    for (const l of ['en', 'ko', 'zh', 'ru']) assert.equal(resolveOfferedLocale(l), l);
  });

  /* Unrecognised codes resolved to English before this existed, and must keep
     doing so - that is what SUPPORTED_LOCALES was already for. */
  await t.test('unknown and empty values still resolve to English', () => {
    for (const v of ['tr', 'klingon', '', null, undefined]) {
      assert.equal(resolveOfferedLocale(v as string), 'en');
    }
  });

  /* Both entry points must clamp. localStorage is the one QA measured; the
     synced user_settings.language would otherwise reinstate Arabic on the next
     sign-in for the same user, on a different device. */
  await t.test('both stored and synced preferences are clamped', () => {
    assert.match(read('lib/labels.ts'), /resolveOfferedLocale\(raw\)/,
      'loadLocalLocale no longer clamps - a stored withdrawn locale comes back');
    assert.match(read('components/LanguageSync.tsx'), /resolveOfferedLocale\(settings\.language\)/,
      'LanguageSync no longer clamps - the server-side preference reinstates it');
  });
});
