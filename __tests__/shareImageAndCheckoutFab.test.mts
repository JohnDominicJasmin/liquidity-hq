/* #1633 / #1606 (#1636): the share image a posted link shows, and the Ask AI button kept off the embedded checkout.
 *
 * WHAT THIS PINS: every image the page metadata names for link previews (Open Graph and Twitter) is a file that exists under public/, and none
 * is the old icon-512.jpg (a 404 on every page); the rule hiding .gchat-fab lives only in /upgrade's embedded-checkout branch (it appears with
 * the embed and goes with it, and the fallback link keeps the button), and nothing global hides the button.
 *
 * WHAT IT CANNOT PROVE: how a social network renders the preview (each caches it), the 1200x630 share image (owner's, not built yet), or the
 * computed style in a browser (the qa photos at 390/360 on #1606 are that check). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { appPath } from './_appPath.mts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const publicFile = (urlPath: string) => new URL(`../public${urlPath}`, import.meta.url);

test('I1. every preview image in the root metadata is a real file under public/, and none is the old icon-512.jpg', () => {
  const src = stripTsComments(read(appPath('app/layout.tsx')));
  const og = /openGraph:\s*\{[\s\S]*?images:\s*\[([\s\S]*?)\]/.exec(src);
  const tw = /twitter:\s*\{[\s\S]*?images:\s*\[([\s\S]*?)\]/.exec(src);
  assert.ok(og, 'openGraph.images not found');
  assert.ok(tw, 'twitter.images not found: a Twitter/X card with no image');
  const urls = [...`${og[1]} ${tw[1]}`.matchAll(/['"](\/[^'"]+\.(?:png|jpe?g|webp))['"]/g)].map((m) => m[1]);
  assert.ok(urls.length >= 2, `expected an Open Graph and a Twitter image path, found ${JSON.stringify(urls)}`);
  for (const u of urls) assert.ok(existsSync(publicFile(u)), `${u} is named as a share image but public${u} does not exist (a 404 preview)`);
  assert.ok(!/icon-512\.jpg/.test(src), 'the 404 image /icons/icon-512.jpg is back in the metadata');
});

test('I2. metadataBase is the production origin, so the relative preview paths resolve to absolute URLs', () => {
  assert.ok(/metadataBase:\s*new URL\('https:\/\/liquidity-hq\.com'\)/.test(stripTsComments(read(appPath('app/layout.tsx')))));
});

test('F1. /upgrade hides the Ask AI button inside the embedded-checkout branch only (it goes when the embed closes or falls back)', () => {
  const src = read(appPath('app/upgrade/page.tsx'));
  const branch = src.indexOf('{embed && accountEmail && !embedFailed ? (');
  const rule = src.indexOf(`<style>{'.gchat-fab{display:none !important}'}</style>`);
  const embedEl = src.indexOf('<WhopCheckoutEmbed', branch);
  const elseBranch = src.indexOf(') : (', branch);
  assert.ok(branch > 0, 'the embedded-checkout branch was not found');
  assert.ok(rule > 0, 'the rule hiding .gchat-fab is gone: the button covers the Address field again at 390 (#1606)');
  assert.ok(branch < rule && rule < embedEl, 'the rule is not inside the embed branch, next to the embed');
  assert.ok(elseBranch < 0 || rule < elseBranch, 'the rule sits in the fallback branch, so it hides the button when there is no form to cover');
  assert.equal(src.split('.gchat-fab{display:none').length - 1, 1, 'the hide rule appears more than once on /upgrade');
});

test('F2. nothing global hides the Ask AI button: the only display:none for .gchat-fab is the /upgrade one', () => {
  const css = read(appPath('app/globals.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\.gchat-fab\s*\{[^}]*display\s*:\s*none/.test(css), 'globals.css hides .gchat-fab everywhere');
});
