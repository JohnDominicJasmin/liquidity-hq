/* #2405: the Arena chart toolbar stays one row from 1200 px up (second layer for the CLS flap at 1280).
 *   T1  from 1200 px the toolbar is nowrap and the plan badge may shrink (flex 0 1 auto, min-width 0, overflow hidden); below 1200 the toolbar keeps its wrapping (the rule is inside a min-width: 1200px media query ONLY, so 1024 and phones are untouched)
 * WHAT IT CANNOT PROVE: that the toolbar really fits one row at 1280 in en/ru/ko/zh with every chip present, nor that it still wraps cleanly at 1024: that is the measurement cell in the browser run (toolbar height + scrollWidth at 1024/1280, four languages). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('T1. nowrap + shrinkable badge only inside @media (min-width: 1200px); the base toolbar keeps wrapping', () => {
  const m = css.match(/@media \(min-width: 1200px\) \{\n\s*\.klc-toolbar \{ flex-wrap: nowrap; \}\n\s*\.klc-toolbar > \.sq-badge \{ flex: 0 1 auto; min-width: 0; overflow: hidden; \}\n\}/);
  assert.ok(m, 'the wide-screen nowrap rule changed or is gone');
  const base = [...css.matchAll(/\.klc-toolbar\s*\{[^}]*\}/g)].map((x) => x[0]);
  assert.ok(base.length >= 1, 'CONTROL: no base .klc-toolbar rule found'); assert.ok(base.some((b) => /flex-wrap:\s*wrap/.test(b)), 'the base toolbar no longer wraps below 1200 (it would overflow on a phone)');
  const outside = css.replace(m![0], ''); assert.equal(/\.klc-toolbar\s*\{[^}]*flex-wrap:\s*nowrap/.test(outside), false, 'nowrap leaked outside the 1200px media query');
});
