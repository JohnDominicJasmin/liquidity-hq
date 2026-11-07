#!/usr/bin/env node
// Asserts the PREMISE that justifies excluding wedges and triangles from `PATTERN_TYPES`:
//
//   every two-rail structure `detectStructures` produces has PARALLEL rails.
//
// If that holds, the gap between the rails is constant, `gapEnd / gapStart` is exactly 1, and the
// convergence and divergence tests in `lib/chartPatterns.ts` can never fire - so no wedge and no
// triangle can be named. `UNDETECTABLE_PATTERN_TYPES` in that file records the conclusion; this
// script is how the conclusion stays true.
//
// ── WHY A SCRIPT AND NOT A COMMENT ──────────────────────────────────────────────────────────────
//
// The exclusion rests on a property of the CURRENT detector, not on geometry in general. #2023
// replaced two independently fitted rails with one fitted rail plus a derived parallel one, because
// requiring both to clear R-squared AND the excess-touch gate produced zero channels across 40 live
// cells. Independent rails are the obvious way to make wedges detectable, and whoever tries it will
// make this premise false. They should find out from a red run, not from a paragraph.
//
// So this is the fork the file cannot see: a comment claiming "rails are always parallel" stays
// green forever. This does not.
//
// ── USAGE ───────────────────────────────────────────────────────────────────────────────────────
//
//   node --import ./qa/alias-register.mjs scripts/pattern-reachability.mjs
//   node --import ./qa/alias-register.mjs scripts/pattern-reachability.mjs --control
//
// `--control` is the positive control and SHOULD BE RUN FIRST. It feeds the same check a
// deliberately non-parallel rail pair and fails if the check calls it parallel. A zero-violation run
// is the least trustworthy output this repo produces; without the control, a check that cannot see a
// violation and a detector that has none give the same printout.
//
// The `--import` hook is `qa/alias-register.mjs`, which is QA's: it resolves `@/` and strips types,
// and `npm test` uses the same one. A change to it changes how this script resolves.
import process from 'node:process';

const CONTROL = process.argv.includes('--control');

const { detectStructures } = await import('@/lib/chartStructureDetect');
const { PATTERN_TYPES, UNDETECTABLE_PATTERN_TYPES, detectPatterns } = await import('@/lib/chartPatterns');

/* ── THE GENERATOR, NAMED AND PRINTED ──────────────────────────────────────────────────────────
   A rate measured off an unnamed generator is a property of the generator. That mistake cost a
   retraction this week (`690ae5ba`): a false-positive rate quoted as a product fact came from an
   additive random walk roughly four times noisier than the one it was compared against. So the
   parameters are stated, printed on every run, and deliberately WIDE - the point is to search for a
   counterexample, not to produce a tidy number.

   Converging envelopes are the shape most likely to produce a wedge, so a closing half-width is
   sampled on most shapes. If anything could make non-parallel rails, it is these. */
const GEN = {
  shapes: 1200,
  bars: '100-219',
  slope: '+/-0.4 per bar',
  convergence: '0-0.09 half-width per bar (envelope closing)',
  amplitude: '1-9',
  period: '4-16 bars',
  seed: 11,
};

let seed = GEN.seed;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

const candles = (n, f) =>
  Array.from({ length: n }, (_, i) => {
    const v = f(i);
    return { timestamp: 1700000000000 + i * 900000, open: v, high: v + 0.2, low: v - 0.2, close: v, volume: 1 };
  });

/* gapEnd / gapStart for a rail pair - the same quantity `classify` computes. */
function gapRatio(a, b, i0, i1) {
  const at = (r, i) => r.fit.slope * i + r.fit.intercept;
  const g0 = Math.abs(at(a, i0) - at(b, i0));
  const g1 = Math.abs(at(a, i1) - at(b, i1));
  return g0 > 0 ? g1 / g0 : null;
}

const seen = Object.create(null);
const ratios = new Set();
let twoRail = 0;
let parallel = 0;
const violations = [];

for (let k = 0; k < GEN.shapes; k++) {
  const slope = (rnd() - 0.5) * 0.8;
  const conv = rnd() * 0.09;
  const amp = 1 + rnd() * 8;
  const per = 4 + rnd() * 12;
  const n = 100 + Math.floor(rnd() * 120);
  const c = candles(n, (i) => 100 + slope * i + Math.sin(i / per) * Math.max(0.4, amp - i * conv));

  for (const p of detectPatterns(c, { timeframe: '15m' }).patterns) {
    seen[p.type] = (seen[p.type] ?? 0) + 1;
  }

  for (const s of detectStructures(c, { timeframe: '15m' }).structures) {
    if (s.rails.length !== 2) continue;
    twoRail++;
    const [a, b] = s.rails;
    const i0 = Math.min(...s.rails.flatMap((r) => r.pivots.map((p) => p.index)));
    const r = gapRatio(a, b, i0, c.length - 1);
    if (r !== null) ratios.add(r.toFixed(6));
    if (a.fit.slope === b.fit.slope) parallel++;
    else violations.push({ shape: k, slopes: [a.fit.slope, b.fit.slope], ratio: r });
  }
}

/* ── THE POSITIVE CONTROL ─────────────────────────────────────────────────────────────────────
   Hand the SAME two comparisons a pair that is genuinely not parallel. Both must notice. */
if (CONTROL) {
  const fake = (slope, intercept) => ({ fit: { slope, intercept }, pivots: [{ index: 0 }] });
  const a = fake(0.5, 100);
  const b = fake(0.1, 60);
  const sawSlope = a.fit.slope !== b.fit.slope;
  const r = gapRatio(a, b, 0, 100);
  const sawRatio = r !== null && Math.abs(r - 1) > 1e-9;
  console.log('POSITIVE CONTROL (a non-parallel pair, slopes 0.5 and 0.1):');
  console.log('  slope comparison flags it : ' + (sawSlope ? 'YES' : 'NO'));
  console.log('  gap ratio is not 1        : ' + (sawRatio ? 'YES (' + r.toFixed(4) + ')' : 'NO'));
  if (!sawSlope || !sawRatio) {
    console.error('\npattern-reachability: THE CONTROL DID NOT FIRE. The check below cannot see a ' +
      'violation, so a zero-violation result from it means nothing. Fix the check first.');
    process.exit(1);
  }
  console.log('  -> the check can see a violation, so a zero below is informative.\n');
}

console.log('generator:');
for (const [k, v] of Object.entries(GEN)) console.log('  ' + k.padEnd(12) + ' ' + v);

console.log('\ntypes classify() returned:');
for (const t of PATTERN_TYPES) console.log('  ' + t.padEnd(16) + ' ' + (seen[t] ?? 0));

/* A ZERO HERE IS NOT A REACHABILITY RESULT, and saying so in the output rather than only in a
   comment is deliberate - the numbers are what gets read.
   This generator emits sine-in-an-envelope shapes. It contains no sharp directional move followed by
   a tight drift, so it CANNOT produce a flag, and `bull_flag 0` means "not generated", not "not
   detectable". Both flags are reachable and were confirmed from a purpose-built pole-plus-flag
   fixture when they shipped. Only the wedge and triangle claim is made here, and it is made from the
   parallel-rails property below, never from a count of zero. */
console.log('\n  (a 0 above means this generator does not emit that shape - flags need a pole and a\n' +
  '   tight drift, which sine-in-an-envelope cannot make. Reachability is argued below from the\n' +
  '   parallel-rails property, not from any count being zero.)');

const leaked = UNDETECTABLE_PATTERN_TYPES.filter((t) => seen[t]);
console.log('\ntwo-rail structures           : ' + twoRail);
console.log('  with identical rail slopes  : ' + parallel +
  '  (' + (twoRail ? ((100 * parallel) / twoRail).toFixed(1) : '0') + '%)');
console.log('  distinct gapEnd/gapStart    : ' + ([...ratios].join(', ') || '(none)'));
console.log('  declared undetectable       : ' + UNDETECTABLE_PATTERN_TYPES.join(', '));

/* NOT AN EMPTY-SET PASS. Zero two-rail structures would make "all of them are parallel" vacuously
   true, which is the trap that let nine assertions pass over an empty array earlier in #1818. */
if (twoRail === 0) {
  console.error('\npattern-reachability: NO two-rail structures were produced at all, so the premise ' +
    'was not tested - it was skipped. Vacuously true is not true. The generator or the detector ' +
    'thresholds have moved; fix that before reading this as a pass.');
  process.exit(1);
}

if (leaked.length) {
  console.error('\npattern-reachability: a type declared undetectable WAS returned: ' + leaked.join(', ') +
    '. The exclusion in lib/chartPatterns.ts is now wrong - it needs copy and a drawing, not a comment.');
  process.exit(1);
}

if (violations.length) {
  const v = violations[0];
  console.error('\npattern-reachability: ' + violations.length + ' of ' + twoRail + ' two-rail structures ' +
    'have NON-PARALLEL rails (first: shape ' + v.shape + ', slopes ' + v.slopes.join(' and ') +
    ', ratio ' + v.ratio + ').');
  console.error('The premise behind UNDETECTABLE_PATTERN_TYPES no longer holds. Wedges and triangles ' +
    'may now be reachable, so they need copy in components/PatternPanel.tsx, a drawing in ' +
    'components/patterns/PatternIllustration.tsx, and their label keys back - or the convergence ' +
    'branch has to stay removed on purpose and this script has to say why.');
  process.exit(1);
}

console.log('\nOK - all ' + twoRail + ' two-rail structures have parallel rails, so gapEnd/gapStart is 1 ' +
  'and no wedge or triangle can be classified.');
