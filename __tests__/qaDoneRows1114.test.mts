import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getCoinsInHeadline } from '../lib/classify.ts';

/* QA's unit cells for DONE-on-code rows of the 2026-11-14 release tick list. Not live runs: #1631 B4 needs a paid AI call (fenced), #1651 B11 lives in a CRON_SECRET route,
 * #1185 B7's news matcher is a pure function. Each expectation is written from the tracker text, with a negative case so a function that answers the same for every input cannot pass. */

/* ---------- #1185 B7: the news coin matcher matches whole words ---------- */
test('B7-a. a headline naming a coin by word is matched', () => {
  assert.deepEqual(getCoinsInHeadline('Bitcoin climbs as Ethereum lags'), ['BTC', 'ETH']);
  assert.ok(getCoinsInHeadline('Solana outage ends').includes('SOL'));
});
test('B7-b. CONTROLS: a ticker inside another word is NOT a match (sol in solution, eth in method, sui in suit)', () => {
  assert.deepEqual(getCoinsInHeadline('A solution to the method problem'), []);
  assert.deepEqual(getCoinsInHeadline('Court suit over ethical lending'), []);
  assert.deepEqual(getCoinsInHeadline('Cosmetics maker nears a deal'), [], 'cosmos / near must not match inside other words');
});

/* ---------- #1631 B4: the AI read is given the selected indicators' real values ---------- */
/* lib/useEMAStrategy.ts cannot be imported under node (it re-exports a type from strategyCore.ts as a value), so B4-a/b are SOURCE guards on strategyToGrokLine, not calls. */
const ema = readFileSync(new URL('../lib/useEMAStrategy.ts', import.meta.url), 'utf8');
const fn = ema.slice(ema.indexOf('export function strategyToGrokLine'));
test('B4-a. the ribbon line carries the selected indicator readings, text joined from selectedReadings', () => {
  assert.match(fn, /sig\.selectedReadings\.map\(r => r\.text\)\.join\('; '\)/);
  assert.match(fn, /selected indicator readings — /);
  assert.match(fn, /\$\{condStr\}\$\{sltp\}\$\{age\}\$\{readings\}`/, 'the readings clause is part of the returned line');
});
test('B4-b. CONTROL: the clause is conditional on there being readings (a warm-up indicator with no value is not named)', () => {
  assert.match(fn, /sig\.selectedReadings\.length\s*\? ` · selected indicator readings/);
  assert.match(fn, /: ''/);
});
test('B4-c. the prompt tells the model to weigh ONLY indicators with a reading line (source guard on buildArenaPrompt)', () => {
  const src = readFileSync(new URL('../lib/grok.ts', import.meta.url), 'utf8');
  assert.match(src, /Weigh ONLY the indicators whose readings/);
  assert.match(src, /Do not weigh, or name as weighted, any indicator that has no reading line above/);
  assert.doesNotMatch(src, /The trader has chosen to weigh these indicators: /, 'the old enumerate-by-id sentence is gone');
});

/* ---------- #1651 B11: the alert:pass health row prints a count, not the list (source guard: the route needs CRON_SECRET) ---------- */
test('B11. the alert:pass health row prints fired.length in both branches and never the fired list itself', () => {
  const src = readFileSync(new URL('../app/api/telegram/alert/route.ts', import.meta.url), 'utf8');
  assert.match(src, /\$\{fired\.length\} fired, no venue skipped/);
  assert.match(src, /- fired=\$\{fired\.length\}, so a quiet result here is not evidence/);
  const i = src.indexOf('fired, no venue skipped');
  const window = src.slice(Math.max(0, i - 600), i + 600);
  assert.doesNotMatch(window, /fired\.join\(|JSON\.stringify\(fired\)|\$\{fired\}/, 'the list must not be interpolated into the health detail');
});
