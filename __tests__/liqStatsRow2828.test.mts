/* QA: PR #2828 (#1185 owner item 75). The live-liquidations stats row: one grid column for each of its five children. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('L1. five children, five columns, the three figures in equal ones', () => {
  const css = read('app/globals.css');
  const rule = /\n\.liqfeed-stats \{([^}]*)\}/.exec(css)?.[1] ?? '';
  const columns = /grid-template-columns:\s*([^;]+);/.exec(rule)?.[1].match(/minmax\([^)]*\)|\S+/g) ?? [];
  assert.deepEqual(columns, ['minmax(0, 1fr)', '24px', 'minmax(0, 1fr)', '24px', 'minmax(0, 1fr)']);
  const jsx = read('components/LiqFeed.tsx');
  const from = jsx.indexOf('<div className="liqfeed-stats">');
  const row = jsx.slice(from, from + 2_000);
  const children = [...row.matchAll(/\n {8}<div className="(liqfeed-stat(?:-sep)?)"/g)].map((m) => m[1]);
  assert.deepEqual(children, ['liqfeed-stat', 'liqfeed-stat-sep', 'liqfeed-stat', 'liqfeed-stat-sep', 'liqfeed-stat']);
});
