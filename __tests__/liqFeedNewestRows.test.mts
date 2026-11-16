/* LiqFeed's 24 h history must read the NEWEST rows (Dev's hotfix, #2408 code review). The query used `.order('ts', { ascending: true }).limit(5000)`, which keeps the OLDEST 5000 rows of the window;
 * with both venues collected server-side a day can hold more than 5000, so the clusters and the one-venue note came from the start of the window and the newest rows never arrived.
 *
 * TWO PINS, because this component cannot be mounted headless here:
 *   N1  the source: the liq_events history query orders by ts DESCENDING with a limit of 5000, and reverses the page back to time order before use (the rest of the code reads it oldest first);
 *   N2  the semantics, on a 6000-row stand-in table: "newest 5000, then reversed" keeps the newest row, is in ascending order, and holds exactly 5000, while the old ascending + limit drops the newest 1000.
 * N2 is the rule written out as an oracle against a stand-in, not a run of the component; N1 is what ties it to the shipped code. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../components/LiqFeed.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

test('N1. the liq_events history query is newest-first with a 5000 limit, and is put back in time order before use', () => {
  const at = code.indexOf('sb.from(T.liq_events)');
  assert.ok(at > 0, 'the history query moved: re-read LiqFeed');
  const chain = code.slice(at, at + 900);
  assert.match(chain, /\.order\('ts',\s*\{\s*ascending:\s*false\s*\}\)/, 'the history is not ordered newest first: with limit(5000) it returns the OLDEST rows of the window');
  assert.match(chain, /\.limit\(5000\)/, 'the history limit moved');
  assert.equal(/\{\s*ascending:\s*true\s*\}/.test(chain), false, 'an ascending order is back on the history query');
  assert.match(chain, /\.reverse\(\)/, 'the newest-first page is not reversed back to time order before use: the clusters read it oldest first');
});

test('N2. newest-5000-then-reverse keeps the newest row of a 6000-row day, in ascending order; ascending-limit drops it', () => {
  const table = Array.from({ length: 6000 }, (_, i) => ({ ts: 1_000_000 + i * 1000, id: i }));       // ascending by construction; the newest is id 5999
  const newest = [...table].sort((a, b) => b.ts - a.ts).slice(0, 5000);                                  // .order(ts desc).limit(5000)
  const used = [...newest].reverse();
  assert.equal(used.length, 5000);
  assert.equal(used[used.length - 1].id, 5999, 'the newest row did not survive');
  assert.equal(used[0].id, 1000, 'the page is not the newest 5000');
  assert.ok(used.every((r, i) => i === 0 || used[i - 1].ts < r.ts), 'the page is not in ascending time order after the reverse');
  const oldest = [...table].sort((a, b) => a.ts - b.ts).slice(0, 5000);                                  // the shipped bug
  assert.equal(oldest[oldest.length - 1].id, 4999, 'control: the old query stops at id 4999 and never sees the newest 1000 rows');
});
