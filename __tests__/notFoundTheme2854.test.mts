/* QA: PR #2854 (#1185 item 103): "Page not found" follows the visitor's theme.
 *   M1 its theme script is, character for character, the one every other page runs, and sits in <head> before the body
 *   M2 the script itself: a stored choice wins, otherwise the device's preference, and blocked storage leaves the dark default */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const script = (src: string) => [...src.matchAll(/<script id="theme-init" dangerouslySetInnerHTML=\{\{ __html: `([^`]*)` \}\} \/>/g)].map((m) => m[1]);
const page = read('app/global-not-found.tsx');

test('M1. the same script, in the head', () => {
  const root = script(read('components/RootDocument.tsx')), mine = script(page);
  assert.equal(root.length, 1, 'CONTROL'); assert.deepEqual(mine, root);
  const at = (s: string) => page.lastIndexOf(s);
  assert.ok(at('<head>') < at('id="theme-init"') && at('id="theme-init"') < at('</head>') && at('</head>') < at('<body>'));
  assert.match(page, /<html [^>]*data-theme="dark"[^>]*suppressHydrationWarning>/);
});

test('M2. what the script sets', () => {
  const run = (stored: string | null | Error, prefersLight: boolean) => {
    let set = 'dark';
    new Function('localStorage', 'window', 'document', script(page)[0])(
      { getItem: () => { if (stored instanceof Error) throw stored; return stored; } },
      { matchMedia: () => ({ matches: prefersLight }) },
      { documentElement: { setAttribute: (name: string, value: string) => { assert.equal(name, 'data-theme'); set = value; } } });
    return set;
  };
  assert.equal(run('light', false), 'light'); assert.equal(run('dark', true), 'dark');
  assert.equal(run(null, true), 'light'); assert.equal(run(null, false), 'dark'); assert.equal(run('blue', true), 'light');
  assert.equal(run(new Error('blocked'), true), 'dark');
});
