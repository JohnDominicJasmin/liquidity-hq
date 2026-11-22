/* QA: PR #2748 (held, v2026.11.24), #1185: the SEO quick wins, markup only. The share image the link previews show, a description of its own on six pages, titles that no longer print the brand twice, and titles under 60 characters.
 *
 * THE WRITTEN RULE (the PR body, from PM's audit): `og:image` is the real 1200 x 630 capture and `twitter:card` is summary_large_image on the root and on the /ko /zh /ru pages; `/`, `/terms`, `/privacy`, `/contact`, `/disclaimer`, `/refund` each have a description of their own, 140-160 characters; `/help`, `/changelog`, `/security` carry the brand once (the root template adds ` - LiquidityHQ`); the root title and the /, /ko, /zh, /ru titles are under 60 characters once decoded (no `&`).
 *   S1  THE SHARE IMAGE: the file named by OG_IMAGES exists, is a real PNG whose pixel size is the DECLARED width x height (1200 x 630), under 5 MB (the strictest preview limit), has alt text; the root's openGraph and twitter both use it, and so do /learn and the /[locale] page; no icon-512 left in any metadata
 *   S2  THE CARD: twitter.card is summary_large_image on the root and on the /[locale] page (a large-image card with a square icon would crop it)
 *   S3  SIX DESCRIPTIONS: each page's own `description` is 140-160 characters, they are all different from each other and from the root sentence, and the landing's social description is still the root's (a local openGraph would drop the picture)
 *   S4  TITLES: /help, /changelog, /security carry no brand and no `&` (the template adds the brand); the root default is under 60 characters with no `&`; the template is ' - LiquidityHQ'
 *   S5  LOCALE TITLES: for ko, zh and ru the title the page builds (headline + brand, or the headline alone when that runs to 60 or more) is under 60 characters, uses the brand when it fits, and the Russian one drops it
 *   S6  CONTROLS: the 60-character rule fires (the Russian headline + brand is 69 as the PR says; a title under the limit keeps the brand), the old root title had an `&`
 * WHAT THIS CANNOT PROVE: what a social network renders from the image, and the live HTML (curl view-source on a deployed build). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dictionaries } from '../lib/i18n/dictionaries.ts';
import { appPath } from './_appPath.mts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ROOT = strip(read(appPath('app/layout.tsx'))); const SEO = strip(read('lib/seo.ts')); const LOCALE = strip(read(appPath('app/[locale]/page.tsx')));
const OG = /export const OG_IMAGES = \[\{ url: '([^']+)', width: (\d+), height: (\d+), alt: '([^']*)' \}\];/.exec(SEO);

test('S1. the share image is a real 1200 x 630 PNG under 5 MB, used by every page that names an image', () => {
  assert.ok(OG, 'OG_IMAGES not found in lib/seo.ts'); const [, url, w, h, alt] = OG!; const file = new URL(`../public${url}`, import.meta.url);
  assert.ok(existsSync(file), `public${url} does not exist (a 404 preview)`); const buf = readFileSync(file);
  assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG', 'the file is not a PNG'); const pw = buf.readUInt32BE(16), ph = buf.readUInt32BE(20);
  assert.deepEqual([pw, ph], [Number(w), Number(h)], `the file is ${pw} x ${ph} but OG_IMAGES declares ${w} x ${h}`); assert.deepEqual([Number(w), Number(h)], [1200, 630]);
  assert.ok(statSync(file).size < 5 * 1024 * 1024, `the image is ${statSync(file).size} bytes (limit 5 MB)`); assert.ok(alt.length >= 10, 'no alt text');
  assert.ok(/openGraph:\s*\{[\s\S]*?images:\s*OG_IMAGES/.test(ROOT), 'root openGraph does not use OG_IMAGES'); assert.ok(/twitter:\s*\{[\s\S]*?images:\s*OG_IMAGES/.test(ROOT), 'root twitter does not use OG_IMAGES');
  assert.ok(/images:\s*OG_IMAGES/.test(strip(read(appPath('app/learn/page.tsx')))), '/learn does not use OG_IMAGES'); assert.ok((LOCALE.match(/images:\s*OG_IMAGES/g) ?? []).length === 2, '/[locale] openGraph + twitter must both use OG_IMAGES');
  assert.ok(!/icon-512/.test(ROOT + LOCALE + SEO), 'icon-512 is still named in metadata');
});

test('S2. the card is summary_large_image on the root and on the locale pages', () => {
  assert.match(ROOT, /twitter:\s*\{[\s\S]*?card:\s*'summary_large_image'/); assert.match(LOCALE, /twitter:\s*\{\s*card:\s*'summary_large_image'/);
  assert.ok(!/card:\s*'summary'[,\s]/.test(ROOT + LOCALE), "a plain 'summary' card is left");
});

const PAGES: Array<[string, string]> = [['/', 'app/page.tsx'], ['/terms', 'app/terms/layout.tsx'], ['/privacy', 'app/privacy/layout.tsx'], ['/contact', 'app/contact/layout.tsx'], ['/disclaimer', 'app/disclaimer/layout.tsx'], ['/refund', 'app/refund/layout.tsx']];
const descOf = (rel: string): string => { const m = /description:\s*'((?:[^'\\]|\\.)*)'/.exec(strip(read(appPath(rel)))); assert.ok(m, `${rel}: no description`); return m![1].replace(/\\'/g, "'"); };

test('S3. six descriptions of their own, 140-160 characters, all different', () => {
  const rootDesc = /description:\s*'((?:[^'\\]|\\.)*)'/.exec(ROOT)![1]; const seen = new Map<string, string>();
  for (const [route, rel] of PAGES) { const d = descOf(rel); assert.ok(d.length >= 140 && d.length <= 160, `${route}: ${d.length} characters`); assert.notEqual(d, rootDesc, `${route} still shares the root sentence`); assert.ok(!seen.has(d), `${route} repeats ${seen.get(d)}`); seen.set(d, route); }
  const landing = strip(read(appPath('app/page.tsx'))); assert.ok(!/openGraph/.test(landing), "the landing sets its own openGraph: that replaces the root's picture");
});

test('S4. titles carry the brand once and no ampersand; the root title is under 60', () => {
  for (const rel of ['app/help/layout.tsx', 'app/changelog/layout.tsx', 'app/security/layout.tsx']) { const t = /title:\s*'((?:[^'\\]|\\.)*)'/.exec(strip(read(appPath(rel))))?.[1]; assert.ok(t, rel); assert.ok(!/LiquidityHQ/i.test(t!), `${rel}: "${t}" repeats the brand the template adds`); assert.ok(!/&/.test(t!), `${rel}: "${t}" has an ampersand`); }
  assert.match(ROOT, /template:\s*'%s - LiquidityHQ'/); const def = /default:\s*'([^']+)'/.exec(ROOT)![1]; assert.ok(def.length < 60 && !/&/.test(def), `root title "${def}" (${def.length})`);
  assert.equal((ROOT.match(/title:\s*'LiquidityHQ - Crypto Liquidity, Funding, Squeeze Analytics'/g) ?? []).length, 2, 'the Open Graph and Twitter titles differ from the default');
});

test('S5. the locale titles are under 60 characters', () => {
  assert.match(LOCALE, /const fullTitle = `\$\{dict\.hero\.h1Line1\} \$\{dict\.hero\.h1Line2\} - LiquidityHQ`;\s*const localisedTitle = fullTitle\.length < 60 \? fullTitle : `\$\{dict\.hero\.h1Line1\} \$\{dict\.hero\.h1Line2\}`;/, 'the title rule is not the written one');
  const build = (l: 'en' | 'ko' | 'zh' | 'ru') => { const d = dictionaries[l]; const full = `${d.hero.h1Line1} ${d.hero.h1Line2} - LiquidityHQ`; return full.length < 60 ? full : `${d.hero.h1Line1} ${d.hero.h1Line2}`; };
  for (const l of ['ko', 'zh', 'ru'] as const) { const t = build(l); assert.ok(t.length < 60, `${l}: "${t}" is ${t.length}`); assert.ok(!/&/.test(t)); }
  assert.ok(build('ko').endsWith('- LiquidityHQ') && build('zh').endsWith('- LiquidityHQ'), 'ko and zh keep the brand'); assert.ok(!build('ru').includes('LiquidityHQ'), 'ru drops the brand to stay under 60');
});

test('S6. CONTROLS: the rule fires and the old root title had an ampersand', () => {
  const d = dictionaries.ru; assert.equal(`${d.hero.h1Line1} ${d.hero.h1Line2} - LiquidityHQ`.length, 69, 'the Russian headline + brand is 69 as the PR says');
  const k = dictionaries.ko; assert.ok(`${k.hero.h1Line1} ${k.hero.h1Line2} - LiquidityHQ`.length < 60, 'ko is under the limit with the brand');
  assert.ok('LiquidityHQ - Crypto Liquidity, Funding & Squeeze Analytics'.includes('&'));
});
