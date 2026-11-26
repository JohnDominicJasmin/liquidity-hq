/* QA: PR #2863 (#1185 item 106): the support-address link keeps a 24 px target without reaching into the words around it. The browser measurement is the proof; this holds the rule it rests on. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');

test('S1. one rule: the target is the link\'s own line box, with room above and below', () => {
  const rules = [...css.matchAll(/(?:^|\})\s*\.support-mail-link\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.equal(rules.length, 1, 'CONTROL: exactly one rule for the link');
  for (const d of ['display: inline-block', 'line-height: 24px', 'min-height: 24px', 'min-width: 24px', 'margin-block: 2px']) assert.ok(rules[0].includes(d), d);
  assert.doesNotMatch(rules[0], /inline-flex|position:|margin[^;]*:\s*-/, 'nothing that lets the box leave its line');
});
