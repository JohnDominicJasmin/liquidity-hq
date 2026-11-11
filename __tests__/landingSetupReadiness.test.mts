/* The landing hero's Setup row: why it needs a readiness gate, and that the gate names every input.
 *
 * WHAT THIS FILE CANNOT DO, STATED FIRST. `sqReady` is an inline const inside `LandingTerminal`, not
 * an export, so no cell here can call it. The six-stage RENDER sequence - dash, then the real number,
 * never `0` - is a browser row and stays one (#1185). Re-implementing the predicate to "test" it
 * would be my own copy agreeing with itself.
 *
 * WHAT IT CAN DO is pin the two things that made the gate necessary and keep being got wrong:
 *
 *   L1  every partial input set really does produce `score: 0` / "Balanced" - the premise the gate
 *       rests on. If the function ever stopped returning a confident-looking zero for a partial set,
 *       the gate would be unnecessary, and nobody would find that out from the gate's own code.
 *   L2  the gate's field list covers every direction input the function reads. The gate has been
 *       wrong TWICE by listing the wrong subset: #2119 gated on `d` alone, #2142 added one input,
 *       #2144 added the rest. A third wrong subset is the failure this cell exists for.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_appPath.mts';
import { computeSqueezeScore } from '../lib/marketStore.ts';

/** A coin with price only - what the universe ticker pass delivers before any signal arrives. */
const bare = { price: 100 } as never;
const withFields = (f: Record<string, number>) => ({ price: 100, ...f }) as never;

test('L1. every partial input set returns a confident-looking zero - the premise the gate rests on', () => {
  /* Stage 1 is no coin at all, which already has its own cell in squeezeScore.test.mts. These are the
     stages BETWEEN that and a complete set, and they are the ones #2119 and #2142 each mis-gated. */
  const stages: ReadonlyArray<readonly [string, never]> = [
    ['2: price only, no signals',        bare],
    ['3: volRatio only (the trap)',      withFields({ volRatio: 3.2 })],
    ['4: funding only, between bands',   withFields({ fundingRate: 0.00005 })],
    ['5: funding + volRatio',            withFields({ fundingRate: 0.00005, volRatio: 3.2 })],
  ];

  for (const [name, coin] of stages) {
    const r = computeSqueezeScore(coin);
    assert.equal(r.score, 0, `${name}: expected a 0 score, got ${r.score} - if a partial set now scores, re-derive whether the readiness gate is still needed`);
    assert.equal(r.label, 'Balanced', `${name}: expected the "Balanced" label beside that zero, got "${r.label}"`);
    assert.equal(r.dir, 'NEUTRAL', `${name}: a partial set must not produce a direction`);
  }

  /* CONTROL: a COMPLETE set must score, or every assertion above would hold for a function that
     always returns zero, and this file would read as coverage while proving nothing. */
  const complete = computeSqueezeScore(withFields({ fundingRate: 0.10, longRatio: 0.52, shortRatio: 0.1, takerBuyRatio: 0.62 }));
  assert.notEqual(complete.score, 0, 'control: a complete input set must produce a non-zero score');

  /* And the trailing zero that IS real: all three present, none firing. The row must be allowed to
     show this one - it is measured, and suppressing it would swap a false number for a false absence. */
  const measuredZero = computeSqueezeScore(withFields({ fundingRate: 0.00005, longRatio: 0.5, shortRatio: 0.5, takerBuyRatio: 0.5 }));
  assert.equal(measuredZero.score, 0, 'a complete set with nothing firing is a REAL zero and must still compute as 0');
});

test('L2. the readiness gate names every direction input the function reads', () => {
  const landing = readFileSync(path.join(ROOT, 'components/LandingTerminal.tsx'), 'utf8');
  const store = readFileSync(path.join(ROOT, 'lib/marketStore.ts'), 'utf8');

  /* The gate's expression: from `const sqReady =` to the terminating semicolon. */
  const gate = /const sqReady\s*=([\s\S]*?);/.exec(landing);
  assert.ok(gate, 'control: could not find `const sqReady =` in LandingTerminal - if it was renamed, re-point this cell');
  const gateFields = new Set([...gate[1].matchAll(/d\??\.([a-zA-Z]+)/g)].map(m => m[1]));
  assert.ok(gateFields.size >= 3, `control: parsed only ${gateFields.size} fields out of the gate, which cannot be right - re-read the expression`);

  /* The function's body, sliced BY LINES rather than by a regex anchor.
     Two cleverer anchors failed here while writing this cell, and the controls are what caught both:
     the first column-0 `}` is the SIGNATURE's own `} {` (so the match held the return type and no
     body, parsing 0 fields), and "the next top-level export" landed 168 chars in. Lines are legible,
     and the length check below says plainly when the slice is wrong instead of letting an empty
     parse read as a clean one. */
  const lines = store.split('\n');
  const startLine = lines.findIndex(l => l.startsWith('export function computeSqueezeScore'));
  assert.ok(startLine >= 0, 'control: could not find the computeSqueezeScore signature line');
  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i++) {
    if (/^export (function|const|interface|type) /.test(lines[i])) { endLine = i; break; }
  }
  const fn: readonly [string] = [lines.slice(startLine, endLine).join('\n')];
  assert.ok(fn[0].length > 600,
    `control: isolated only ${fn[0].length} chars (lines ${startLine}..${endLine}) - the slice is wrong`);
  const fnFields = new Set([...fn[0].matchAll(/\bcoin\??\.([a-zA-Z]+)/g)].map(m => m[1]));
  assert.ok(fnFields.size >= 4, `control: parsed only ${fnFields.size} fields out of the function - re-read it`);

  /* EXEMPTIONS, each with its reason, because the point of this cell is that an omission has to be
     ARGUED rather than assumed. Two fields are read by the function and deliberately absent from the
     gate, and a third entry appearing here without a reason is itself the smell.

       price     - the universe ticker pass delivers it WITH the coin record, so `d != null` already
                   implies it. An assumption about arrival order rather than a guarantee: if price
                   ever arrives separately, this is the exemption to revisit.
       volRatio  - NOT a direction signal. It is a bonus multiplier the function applies only once a
                   direction already scores above 10, so with volRatio alone the row is still 0 and
                   "Balanced" (L1 stage 3 pins exactly that). Waiting for it would make the row wait
                   on a field it does not need and may never get - and a gate that treated "any
                   squeeze-ish field present" as ready is the wrong fix #2144's comment warns about. */
  const EXEMPT = new Set(['price', 'volRatio']);
  const missing = [...fnFields].filter(f => !gateFields.has(f) && !EXEMPT.has(f));

  /* THE LIST IS NOT ENOUGH, and #2142 is the proof. Its gate named all four fields and was still
     wrong, because it joined them with `||`:

       #2142:  d != null && ( fundingRate != null || (longRatio && shortRatio) || takerBuyRatio != null )
       #2144:  d != null &&   fundingRate != null && longRatio != null && shortRatio != null && takerBuyRatio != null

     Any ONE input opened the old gate, so funding arriving first published a partial sum as a
     finished score - the exact defect, with every field present in the expression. A cell that
     checks only which names appear would have passed it, which is what this file's first draft did.
     Readiness here means ALL the direction inputs, so a disjunction in this expression is the bug. */
  assert.ok(!gate[1].includes('||'),
    'the readiness gate contains `||`, so ONE input can open it and the row can publish a partial '
    + `sum as a finished score. That was #2142's defect with every field already named. Gate: ${gate[1].trim()}`);

  assert.deepEqual(missing, [],
    `computeSqueezeScore reads [${[...fnFields].sort().join(', ')}] but the readiness gate only names `
    + `[${[...gateFields].sort().join(', ')}]. The unlisted field(s) ${JSON.stringify(missing)} can arrive `
    + 'after the gate opens, so the row would publish a partial sum as a finished score - which is the '
    + 'defect #2119, #2142 and #2144 each fixed a subset of.');
});
