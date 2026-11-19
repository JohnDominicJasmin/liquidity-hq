import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/* #2613 "Deep read (14:05) replaced the Quick read from 14:02. Levels can differ between them." The Deep card names it ONLY when a Quick read on that coin is older than the Deep read. The condition (the page's own line, sliced and run) against a table of cases written from that sentence.
 *   D1 deep newer than quick = shown   D2 quick equal or newer = not shown   D3 no quick read = not shown   D4 a quick-only card = not shown   D5 NaN or missing times = not shown   D6 the label carries both times and the warning */
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const page = read('app/(main)/arena/page.tsx'), labels = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const at = page.indexOf('const showReplaced = '); assert.ok(at > 0, 'CONTROL: showReplaced not found');
const line = page.slice(at, page.indexOf(';\n', at) + 1);
const run = new Function('cacheEntry', 'quickAt', 'result', `${ts.transpileModule(line, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}\nreturn showReplaced;`) as (c: unknown, q: number | undefined, r: { analyzedAt: number }) => boolean;
const T = Date.UTC(2026, 10, 19, 14, 5);

test('D1. a Deep read newer than the Quick read names the replacement', () => { assert.equal(run({ mode: 'deep' }, T - 3 * 60_000, { analyzedAt: T }), true); });
test('D2. a Quick read equal to or newer than the Deep read: no notice', () => { assert.equal(run({ mode: 'deep' }, T, { analyzedAt: T }), false); assert.equal(run({ mode: 'deep' }, T + 1, { analyzedAt: T }), false); });
test('D3. no Quick read on that coin: no notice', () => { assert.equal(run({ mode: 'deep' }, undefined, { analyzedAt: T }), false); });
test('D4. a Quick-only card: no notice', () => { assert.equal(run({ mode: 'quick' }, T - 60_000, { analyzedAt: T }), false); assert.equal(run(null, T - 60_000, { analyzedAt: T }), false); });
test('D5. a NaN or missing time never produces the notice', () => { assert.equal(run({ mode: 'deep' }, NaN, { analyzedAt: T }), false); assert.equal(run({ mode: 'deep' }, T - 60_000, { analyzedAt: NaN }), false); assert.equal(run({ mode: 'deep' }, T - 60_000, { analyzedAt: undefined as unknown as number }), false); });
test('D6. the label names both times and says the levels can differ; the notice is rendered only through that label', () => {
  const l = labels.ARENA_DEEP_REPLACED_QUICK; assert.ok(l && l.includes('{deep}') && l.includes('{quick}') && /levels can differ/i.test(l), l);
  assert.ok(page.includes("t('ARENA_DEEP_REPLACED_QUICK', { deep: clock(result.analyzedAt), quick: clock(quickAt!) })") && page.includes('data-testid="deep-replaced-quick"'));
});
