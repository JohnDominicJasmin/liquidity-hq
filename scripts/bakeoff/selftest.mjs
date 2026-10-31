/* DOES THE SCORER DETECT THE THINGS IT CLAIMS TO? Synthetic answers, no API calls, no cost.
 *
 * **WRITTEN BEFORE A SINGLE PAID CALL, and that is the point.** The scorer and the convergence
 * rule decide the outcome of #1818. A scorer that cannot distinguish a fabrication from a refusal
 * would produce a complete, confident, meaningless result - which is exactly what two dead
 * versions of `classify.mjs` already did on this same task.
 *
 * Every assertion here is a POSITIVE control: it feeds the scorer an answer whose correct score is
 * known by construction and checks that it says so. A scorer only ever fed real model output is a
 * scorer nobody has tested.
 *
 * Run: node scripts/bakeoff/selftest.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { findSwingPivots, fitLine, lineValueAt } from '../../lib/chartStructures.ts';
import { atrOf } from './classify.mjs';
import { parseReply } from './prompt.mjs';
import { scoreAnswer, compare } from './score.mjs';

const FIX = new URL('./fixtures/', import.meta.url);
const fixtures = readdirSync(FIX).filter(n => n !== 'manifest.json')
  .map(n => JSON.parse(readFileSync(new URL(n, FIX), 'utf8')));
const byId = Object.fromEntries(fixtures.map(f => [f.id, f]));
const B = fixtures.filter(f => f.group === 'B');
const A = fixtures.filter(f => f.group === 'A');

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

/** A reply claiming a line through the first three pivots of one side - a plausible answer. */
function claimFromPivots(fx, side, skip = 0) {
  const { highs, lows } = findSwingPivots(fx.candles, 3, 3);
  const pv = (side === 'high' ? highs : lows).slice(skip);
  const picked = [pv[0], pv[Math.floor(pv.length / 2)], pv[pv.length - 1]].filter(Boolean);
  return JSON.stringify({ structures: [{
    type: 'trendline', side,
    touchTimestamps: picked.map(p => p.timestamp),
    confidence: 0.8,
  }] });
}

console.log('— refusal and fabrication on group B —');
{
  const fx = B[0];
  const refuse = scoreAnswer(parseReply('{"structures":[]}', fx.candles), fx);
  check('an empty list on B is a correct refusal', [refuse.refusedCorrectly, refuse.structureCount], [true, 0]);

  const fab = scoreAnswer(parseReply(claimFromPivots(fx, 'low'), fx.candles), fx);
  check('a claim on B is NOT a correct refusal', [fab.refusedCorrectly, fab.structureCount > 0], [false, true]);
}

console.log('\n— group A is where a refusal is WRONG —');
{
  const fx = A[0];
  const refuse = scoreAnswer(parseReply('{"structures":[]}', fx.candles), fx);
  check('an empty list on A is not credited as a refusal', refuse.refusedCorrectly, false);
}

console.log('\n— invented data is counted, not silently dropped —');
{
  const fx = B[0];
  const bogus = JSON.stringify({ structures: [{ type: 'trendline', side: 'low',
    touchTimestamps: [1, 2, 3, fx.candles[0].timestamp], confidence: 0.9 }] });
  const s = scoreAnswer(parseReply(bogus, fx.candles), fx);
  check('three timestamps outside the window are counted', s.invalidTimestamps, 3);
  check('and the one real point survives', s.claims[0].validPoints, 1);
}

console.log('\n— malformed output is repaired, and a repair is reported —');
{
  const fx = B[0];
  const fenced = '```json\n{"structures":[]}\n```';
  const s = scoreAnswer(parseReply(fenced, fx.candles), fx);
  check('a fenced reply parses and is flagged as repaired', [s.parseFailed, s.formatRepaired], [false, true]);
  const junk = scoreAnswer(parseReply('I think there is a channel here.', fx.candles), fx);
  check('prose is a parse failure, NOT a refusal', [junk.parseFailed, junk.refusedCorrectly], [true, false]);
}

console.log('\n— THE CONVERGENCE RULE —');
{
  const fx = B[0];
  const same = claimFromPivots(fx, 'low');
  const mk = txt => ({ [fx.id]: [scoreAnswer(parseReply(txt, fx.candles), fx)] });

  /* Both engines, the same line. Must be EXCLUDED rather than counted as two fabrications. */
  const conv = compare({ 'engine-a': mk(same), 'engine-b': mk(same) }, { [fx.id]: fx });
  check('identical claims on a B window converge', conv.converged.length, 1);
  check('and are excluded from the fabrication count',
    [conv.summary['engine-a'].fabricationsOnB, conv.summary['engine-a'].bRuns], [0, 0]);

  /* Two genuinely different lines. Must NOT converge - this is the negative control, without
     which "converged" could just mean "the rule fires on anything". */
  const other = claimFromPivots(fx, 'high');
  const diff = compare({ 'engine-a': mk(same), 'engine-b': mk(other) }, { [fx.id]: fx });
  check('opposite-side claims do NOT converge', diff.converged.length, 0);
  check('and both are counted as fabrications',
    [diff.summary['engine-a'].fabricationsOnB, diff.summary['engine-b'].fabricationsOnB], [1, 1]);

  /* A single engine can never converge with itself. */
  const solo = compare({ 'engine-a': mk(same) }, { [fx.id]: fx });
  check('one engine alone reports no convergence', solo.converged.length, 0);
  check('and its claim IS counted', solo.summary['engine-a'].fabricationsOnB, 1);
}

console.log('\n— a shifted line must not count as agreement —');
{
  const fx = B[0];
  const atr = atrOf(fx.candles);
  const { lows } = findSwingPivots(fx.candles, 3, 3);
  const pts = [lows[0], lows[Math.floor(lows.length / 2)], lows[lows.length - 1]].filter(Boolean);
  const base = fitLine(pts.map(p => ({ index: p.index, price: p.price })));
  /* Two lines 3 ATR apart: far outside the 0.5 ATR agreement band, so a rule that merely checks
     "same side" rather than geometry would wrongly call these the same structure. */
  const a = { line: { fit: base, side: 'low' }, touchCount: 9 };
  const b = { line: { fit: { ...base, intercept: base.intercept + 3 * atr }, side: 'low' }, touchCount: 9 };
  const sep = Math.abs(lineValueAt(a.line.fit, 0) - lineValueAt(b.line.fit, 0)) / atr;
  check('the two synthetic lines really are ~3 ATR apart', Math.round(sep), 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
