import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailySummaryMessages, buildDailySummaryText, DAILY_SUMMARY_MAX_SETUPS, TELEGRAM_SUMMARY_SPLIT_CHARS, type SqueezeRead, type Mover } from '../lib/dailySummary.ts';

/* #2612 THE TELEGRAM DAILY SUMMARY CAP (QA finding of the #2590 pass: past 42 setups the body was over Telegram's 4096 characters and Telegram answers 400, so the user got nothing). Expectations from the PR text:
 *   at most 10 setups are listed, then ONE trailing line "... and N more"; at 10 or fewer there is no extra line; a summary over 3800 characters goes out as TWO messages in send order: the moves, then the setups; no message ever passes Telegram's 4096; HTML tags stay balanced.
 *   S1 3 / 10 / 11 / 14 / 80 setups   S2 the strongest ten are the ones listed (the input is already sorted strongest first)   S3 no setups / no movers   S4 the split (long labels): two messages in order, each under 4096   S5 buildDailySummaryText keeps its one-string shape   S6 tags balanced */
const setup = (i: number, label = `COIN${i}`): SqueezeRead => ({ coin: `c${i}`, label, score: 100 - i, dir: i % 2 ? 'SHORT_SQ' : 'LONG_LIQ', fundingPct: 0.01 * i, longPct: 55 + (i % 20) });
const mover = (i: number, label = `MOVER${i}`): Mover => ({ coin: `m${i}`, label, changePct: 5 - i, price: 100 + i, high: 110 + i, low: 90 + i });
const base = { dateStr: 'Thu 19 Nov', threshold: 60, stamp: 'Sent 12:00' };
const lines = (m: string) => m.split('\n').filter((l) => l.startsWith('• '));
const open = (m: string) => (m.match(/<(b|i)>/g) ?? []).length, close = (m: string) => (m.match(/<\/(b|i)>/g) ?? []).length;

test('S1. 3, 10, 11, 14 and 80 setups: at most ten listed, one trailing "... and N more" only when there are more than ten', () => {
  assert.equal(DAILY_SUMMARY_MAX_SETUPS, 10);
  for (const [n, listed, more] of [[3, 3, 0], [10, 10, 0], [11, 10, 1], [14, 10, 4], [80, 10, 70]] as const) {
    const out = buildDailySummaryMessages({ ...base, movers: [mover(1), mover(2), mover(3)], setups: Array.from({ length: n }, (_, i) => setup(i + 1)) });
    const all = out.join('\n'); assert.equal(lines(all).length, listed, `${n} setups: ${lines(all).length} lines`);
    const m = /… and (\d+) more/.exec(all); if (more) { assert.ok(m, `${n}: no "… and N more" line`); assert.equal(Number(m![1]), more); assert.equal((all.match(/… and \d+ more/g) ?? []).length, 1, 'exactly one trailing line'); } else assert.equal(m, null, `${n}: an extra line appeared`);
    assert.ok(out.every((x) => x.length < 4096), `${n}: a message is over 4096`);
  }
});
test('S2. the strongest ten are the listed ones: the 11th setup is absent', () => {
  const out = buildDailySummaryMessages({ ...base, movers: [mover(1)], setups: Array.from({ length: 14 }, (_, i) => setup(i + 1)) }).join('\n');
  assert.ok(out.includes('COIN10') && !out.includes('COIN11') && !out.includes('COIN14'), 'the cap must keep the first ten and drop the rest');
});
test('S3. no setups: the threshold sentence and no "more" line; no movers: the no-data sentence', () => {
  const none = buildDailySummaryMessages({ ...base, movers: [mover(1)], setups: [] }).join('\n'); assert.ok(none.includes('None at or above your threshold (60).') && !/… and \d+ more/.test(none));
  const nom = buildDailySummaryMessages({ ...base, movers: [], setups: [setup(1)] }).join('\n'); assert.ok(nom.includes('No 24 h data for the coins you have on.'));
});
test('S4. a summary over 3800 characters goes out as TWO messages in send order (the moves, then the setups), each under 4096', () => {
  const long = 'X'.repeat(700);
  const out = buildDailySummaryMessages({ ...base, movers: [mover(1, long), mover(2, long), mover(3, long), mover(4, long), mover(5, long)], setups: Array.from({ length: 10 }, (_, i) => setup(i + 1, 'S'.repeat(40))) });
  assert.equal(out.length, 2, `expected a split, got ${out.length} message(s) of ${out.map((x) => x.length).join('+')}`);
  assert.ok(out[0].includes('Biggest 24 h moves') && !out[0].includes('Squeeze setups'), 'the first message is the moves'); assert.ok(out[1].startsWith('⚡') && out[1].includes('Squeeze setups') && out[1].includes('Sent 12:00'), 'the second is the setups with the stamp');
  assert.ok(out.every((x) => x.length < 4096));
  const short = buildDailySummaryMessages({ ...base, movers: [mover(1)], setups: [setup(1)] }); assert.equal(short.length, 1);
  assert.equal(TELEGRAM_SUMMARY_SPLIT_CHARS, 3800);
});
test('S5. buildDailySummaryText keeps its one-string shape (the parts joined by a blank line)', () => {
  const o = { ...base, movers: [mover(1)], setups: [setup(1)] }; assert.equal(buildDailySummaryText(o), buildDailySummaryMessages(o).join('\n\n'));
});
test('S6. HTML tags stay balanced in every message, split or not', () => {
  for (const n of [0, 3, 14, 80]) for (const label of ['A', 'L'.repeat(700)]) for (const m of buildDailySummaryMessages({ ...base, movers: [mover(1, label), mover(2, label), mover(3, label)], setups: Array.from({ length: n }, (_, i) => setup(i + 1)) })) assert.equal(open(m), close(m), `unbalanced tags in a ${m.length}-char message (n=${n})`);
});
