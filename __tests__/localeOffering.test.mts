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
