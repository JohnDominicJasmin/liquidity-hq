/* QA: PR #2848 (#1185 item 98): the Arena chart shows keyboard focus. Source pins; the ring itself is read in a browser.
 *   F1 the ring is drawn over the chart only for keyboard focus (:focus-visible), cannot be clicked, and uses the accent colour
 *   F2 the chart element it hangs on is still the one the library mounts into, and no other rule moves it out of "position: relative" */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = read('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '');

test('F1. a keyboard-only ring over the chart', () => {
  const rule = /\.klc-canvas:has\(> :focus-visible\)::after \{([^}]*)\}/.exec(css)?.[1] ?? '';
  for (const part of ["content: ''", 'position: absolute', 'inset: 0', 'pointer-events: none', 'border: 2px solid var(--accent)']) assert.ok(rule.includes(part), part);
  assert.equal(/\.klc-canvas:has\(> :focus\)/.test(css), false, 'a mouse click would draw the ring');
});

test('F2. the host element and its position', () => {
  assert.ok(read('components/KLineProChart.tsx').includes('className="klc-canvas"'));
  assert.match(css, /\.klc-canvas \{ position: relative; \}/);
  const others = [...css.matchAll(/([^{}]*\.klc-canvas(?![-\w])[^{}]*)\{([^}]*)\}/g)].filter((m) => !m[1].includes('::after') && /position:\s*(absolute|fixed|static|sticky)/.test(m[2]));
  assert.deepEqual(others.map((m) => m[1].trim()), []);
});
