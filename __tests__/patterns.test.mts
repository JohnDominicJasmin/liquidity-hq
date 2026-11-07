/* lib/patterns.ts - THE LIVE DETECTOR, AND IT HAD NEVER HAD A CELL.
 *
 * Owner instruction, 2026-11-08: "make sure it's all tested, create multiple test cases, make sure
 * QA is testing on it, not just code, and also by hand."
 *
 * WHY THIS FILE IS MORE URGENT THAN THE NEW DETECTOR'S. `lib/patterns.ts` is imported by
 * `app/api/telegram/alert/route.ts` - which SENDS REAL MESSAGES - and by `arena/page.tsx` and
 * `components/MarketProvider.tsx`. It has shipped with zero coverage, while
 * `lib/chartPatterns.ts`, which nothing imports yet, got a null model and a mutation run.
 *
 * EVERY NAME GETS A POSITIVE **AND** A NEGATIVE CASE. The negative - the pattern nearly-but-not
 * present - is what catches a loosened threshold, and a suite of positives alone would have passed
 * every broken version of the other detector this week.
 *
 * ARITHMETIC, NOT JUDGEMENT. Every fixture is hand-built with the thresholds quoted, so the right
 * answer can be checked by reading. No exchange data, no network.
 *
 * TWO CELLS PIN BUGS RATHER THAN CORRECTNESS - B1 and S2 - and say so in their names. They exist so
 * the behaviour cannot change silently while the decision about whether to fix it is still open.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_appPath.mts';
import { detectPatterns, detectPatternsStr, rankPatterns, type Candle } from '../lib/patterns.ts';

/* A filler candle that triggers NOTHING, which every positive case needs as its background.
 * Alternating so highs and lows are both non-monotonic (otherwise the trend check fires), and wide
 * enough that the 6-candle range is 3/100 = 3% - over the 1.5% tight-consolidation threshold.
 * Body 0.5 against a wick of 2 is 25%, over the 10% doji line.
 *
 * BOTH CANDLES ARE GREEN, AND THAT IS NOT COSMETIC. My first version alternated green/red with
 * aligned opens and closes, which is a textbook BEARISH ENGULFING - it fired on every even-to-odd
 * boundary, so `bg()` emitted a pattern and every positive cell below would have been asserting
 * the background instead of its own candle. N0 caught it on the first run. Two same-direction
 * candles cannot satisfy either engulfing rule, since each requires the pair to differ. */
const quiet = (i: number): Candle => (i % 2 === 0
  ? { o: 100, h: 101, l: 99, c: 100.5 }
  : { o: 99.8, h: 101.5, l: 98.5, c: 100.3 });
const bg = (n: number): Candle[] => Array.from({ length: n }, (_, i) => quiet(i));

/** Background + a specific final candle. */
const withLast = (last: Candle, n = 8): Candle[] => [...bg(n), last];

test('N0. CONTROL: the background fires nothing, so every positive below is caused by its own candle', () => {
  /* Without this, any cell could be passing on a pattern the filler emits and I would be asserting
     the background rather than the fixture. */
  assert.deepEqual(detectPatterns(bg(12)), [], `the quiet background is not quiet: ${detectPatterns(bg(12)).join(', ')}`);
  /* And the floor: fewer than 6 candles is always empty. THE FIXTURE ENDS IN A DOJI ON PURPOSE -
     a candle that WOULD be detected if the floor were removed. My first version used five quiet
     candles, which emit nothing with or without the guard, so a mutation deleting the floor stayed
     green and the assertion was describing the fixture rather than the rule. */
  const fiveEndingInADoji: Candle[] = [...bg(4), { o: 100, h: 101, l: 99, c: 100.05 }];
  assert.equal(fiveEndingInADoji.length, 5);
  assert.deepEqual(detectPatterns(fiveEndingInADoji), [], 'under 6 candles must return nothing');
  /* The other half of that control: the same candle IS detected once the array is long enough.
     Without this, the line above passes for whatever reason and proves nothing about the floor. */
  assert.ok(detectPatterns([...bg(6), { o: 100, h: 101, l: 99, c: 100.05 }]).includes('Doji'),
    'the control candle must be detectable at 7 candles, or the floor assertion is vacuous');
});

test('B1. GUARD: a perfectly FLAT market must NOT report a trend', () => {
  /* THIS CELL USED TO PIN THE BUG AND NOW GUARDS THE FIX. Until 08a2bb16, `allHH` tested
     `h >= prev` and `allHL` tested `l >= prev`, so EQUAL highs and lows satisfied both and ten
     identical candles reported "Higher highs + higher lows (uptrend)" - a degenerate input reading
     as a strong directional signal, the same shape as the RSI flat-series bug fixed in #2015 the
     same week. Worse at the seam, because it sorted first and the Telegram alert shows one name.

     IT HAD ALREADY FIRED ON REAL DATA, which is the anchor worth carrying here rather than in a
     commit message nobody re-reads. Sweeping 95,648 live windows (49 coins, 1000 candles each, a
     25-candle window slid one bar at a time) found trend names firing 244 times across 36 of 49
     coins, and one genuine flat-market case: TRX 5m, every high 0.3194 and every low 0.3193 across
     the whole 10-bar window. It concentrates on coarse-tick coins - trx alone was 90 of the 244 -
     because at a price of 0.319 ten bars sharing a high is plausible in a way it is not for BTC.

     So the guard is not hypothetical. If it goes red, a flat feed is being reported as a trend to
     real users again, on the cheap low-priced coins first. */
  const flat: Candle[] = Array.from({ length: 12 }, () => ({ o: 100, h: 100, l: 100, c: 100 }));
  const got = detectPatterns(flat);
  assert.ok(!got.includes('Higher highs + higher lows (uptrend)'),
    'a flat market is reporting an UPTREND again - the 08a2bb16 fix has regressed. ' +
    'Observed on real data before the fix: TRX 5m, every high 0.3194, every low 0.3193.');
  assert.ok(!got.includes('Lower highs + lower lows (downtrend)'), 'and it must not be a downtrend either');
  /* What it DOES say, pinned so the fix cannot drift into saying nothing at all - a flat chart is
     genuinely tight consolidation, and that is the honest name for it. */
  assert.deepEqual(got, ['Tight consolidation'], 'a flat window should read as consolidation and nothing else');
});

test('T1. trend structure: rising, falling, and the negative that breaks monotonicity', () => {
  const rising: Candle[] = Array.from({ length: 12 }, (_, i) => ({ o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i }));
  assert.ok(detectPatterns(rising).includes('Higher highs + higher lows (uptrend)'));

  const falling: Candle[] = Array.from({ length: 12 }, (_, i) => ({ o: 100 - i, h: 101 - i, l: 99 - i, c: 100.5 - i }));
  assert.ok(detectPatterns(falling).includes('Lower highs + lower lows (downtrend)'));

  /* NEGATIVE: one lower low in the middle of a rise. The check is `every`, so a single break must
     disqualify it - this is what stops a mostly-rising chart being called a clean uptrend. */
  const broken = [...rising];
  broken[6] = { ...broken[6], l: broken[5].l - 5 };
  const got = detectPatterns(broken);
  assert.ok(!got.includes('Higher highs + higher lows (uptrend)'),
    'one lower low must disqualify the uptrend - the check is every(), not most()');
  assert.ok(!got.includes('Lower highs + lower lows (downtrend)'), 'and it is not a downtrend either');
});

test('E1. engulfing: both directions, plus the range negative', () => {
  /* Bearish: prior green, current red, current opens at/above prior close, closes at/below prior
     open. There is no longer a body-ratio condition - see the note below. */
  const bear = [...bg(8), { o: 100, h: 101, l: 99, c: 101 }, { o: 101.5, h: 102, l: 99, c: 99.5 }];
  assert.ok(detectPatterns(bear).includes('Bearish engulfing'), 'bearish engulfing not detected');

  const bull = [...bg(8), { o: 101, h: 102, l: 100, c: 100 }, { o: 99.5, h: 102, l: 99, c: 101.5 }];
  assert.ok(detectPatterns(bull).includes('Bullish engulfing'), 'bullish engulfing not detected');

  /* NEGATIVE: the current candle opens below the prior close, so the range does not engulf. */
  const notEngulfing = [...bg(8), { o: 100, h: 101, l: 99, c: 101 }, { o: 100.5, h: 102, l: 99, c: 99.5 }];
  assert.ok(!detectPatterns(notEngulfing).includes('Bearish engulfing'),
    'opening below the prior close is not engulfing');

  /* `cr >= pr * 0.8` WAS DEAD CODE AND 08a2bb16 REMOVED IT, along with the `pr` and `cr` locals
     that then had no consumer. A mutation run is how it surfaced: I wrote a negative case for the
     ratio, the cell passed, and changing 0.8 to 0.4 in the source turned nothing red. The reason is
     arithmetic - the two preceding conditions are `c.o >= p.c` and `c.c <= p.o`, so
     `cr = c.o - c.c >= p.c - p.o = pr`, and the current body always at least equals the prior one
     by the time the ratio is consulted. Dev confirmed it independently over 200,000 generated
     inputs that passed the geometric guards: the ratio failed on zero of them.

     WHAT IS ASSERTED NOW IS THE PROPERTY THAT MADE IT DEAD, not the removed line. If the range
     conditions are ever loosened, this stops holding and a body-ratio check starts to matter again
     - so this is the note that tells whoever loosens them. */
  const priorBody = Math.abs(101 - 100), currentBody = Math.abs(99.5 - 101.5);
  assert.ok(currentBody >= priorBody,
    'the range-engulf conditions force the current body to at least equal the prior one; if this ' +
    'ever fails, the removed 0.8 ratio was load-bearing after all and needs reinstating');
});

test('D1. doji: body under 10% of range, and the 10% negative', () => {
  /* body 0.05 on a range of 2 = 2.5%, well under 10%. */
  assert.ok(detectPatterns(withLast({ o: 100, h: 101, l: 99, c: 100.05 })).includes('Doji'));

  /* NEGATIVE: body 0.5 on a range of 2 = 25%. */
  assert.ok(!detectPatterns(withLast({ o: 100, h: 101, l: 99, c: 100.5 })).includes('Doji'),
    'a 25% body is not a doji');

  /* And a zero-range candle must not divide by zero into a pattern. */
  assert.ok(!detectPatterns(withLast({ o: 100, h: 100, l: 100, c: 100 })).includes('Doji'),
    'a zero-range candle has no doji ratio to compute');
});

test('H1. hammer family: all four names are reachable and named by direction', () => {
  /* Long LOWER wick, small upper. Green close -> Hammer, red close -> Hanging man.
     body 1, lower 2 (>= body*2), upper 0.2 (< body*0.5 = 0.5). */
  const hammer = detectPatterns(withLast({ o: 100, h: 101.2, l: 98, c: 101 }));
  assert.ok(hammer.includes('Hammer'), `expected Hammer, got ${hammer.join(', ')}`);

  const hanging = detectPatterns(withLast({ o: 101, h: 101.2, l: 98, c: 100 }));
  assert.ok(hanging.includes('Hanging man'), `expected Hanging man, got ${hanging.join(', ')}`);

  /* Long UPPER wick. Red close -> Shooting star, green close -> Inverted hammer. */
  const star = detectPatterns(withLast({ o: 101, h: 104, l: 100.8, c: 100 }));
  assert.ok(star.includes('Shooting star'), `expected Shooting star, got ${star.join(', ')}`);

  const inverted = detectPatterns(withLast({ o: 100, h: 104, l: 99.8, c: 101 }));
  assert.ok(inverted.includes('Inverted hammer'), `expected Inverted hammer, got ${inverted.join(', ')}`);

  /* NEGATIVE: the lower wick is 1.5x the body - under the 2x floor but OVER 1x, which is what
     makes it a real negative. My first version used 0.5x; it passed, and a mutation lowering the
     multiple from 2 to 1 left it green, because 0.5x fails either way. A negative has to sit
     between the real threshold and the loosened one or it tests nothing. */
  const shallow = detectPatterns(withLast({ o: 100, h: 101.2, l: 98.5, c: 101 }));
  assert.ok(!shallow.some(p => /Hammer|Hanging/.test(p)),
    'a 1.5x lower wick must not qualify - the threshold is 2x');
});

test('C1. consolidation and flags: all three outcomes, plus the tightness negative', () => {
  /* Tight = the 6-candle range under 1.5% of the last close. These are flat-ish candles inside a
     0.5% band, and with no pole before them the name is plain consolidation. */
  const tight = (): Candle[] => Array.from({ length: 6 }, (_, i) => (
    { o: 100, h: 100.2, l: 99.8, c: i % 2 ? 100.1 : 99.95 }));

  /* Pole is candles[-11..-6]: a >3% move. Rally -> bull flag. */
  const rally: Candle[] = [
    { o: 100, h: 100.5, l: 99.5, c: 100 }, { o: 100, h: 102, l: 100, c: 102 },
    { o: 102, h: 104, l: 102, c: 104 }, { o: 104, h: 105, l: 103.5, c: 105 },
    { o: 105, h: 106, l: 104.5, c: 106 },
  ];
  const bull = detectPatterns([...bg(2), ...rally, ...tight()]);
  assert.ok(bull.includes('Bull flag (sharp rally + tight consolidation)'), `got ${bull.join(', ')}`);

  /* The rally reversed into a drop: walk the array backwards and swap open/close on each candle,
     so the pole falls as sharply as the original rose. The element itself is unused - only its
     index matters - which `noUnusedLocals` flags, so it is omitted rather than named and ignored. */
  const drop: Candle[] = rally.map((_unused, i, a) => {
    const m = a[a.length - 1 - i];
    return { o: m.c, h: m.h, l: m.l, c: m.o };
  });
  const bear = detectPatterns([...bg(2), ...drop, ...tight()]);
  assert.ok(bear.includes('Bear flag (sharp drop + tight consolidation)'), `got ${bear.join(', ')}`);

  /* No pole worth the name -> plain consolidation, not a flag. This is the branch that distinguishes
     "compression" from "pause in a move", and it is the one a loosened pole threshold would break. */
  /* A 1.5% pole: under the 3% floor but well over a trivial drift, so lowering the threshold to
     0.5% flips this case to a flag and the cell catches it. My first attempt used a 0.05% pole,
     which is below every candidate threshold and so could not detect a loosening at all. */
  const flatPole: Candle[] = [
    { o: 100, h: 100.4, l: 99.6, c: 100.3 }, { o: 100.3, h: 100.7, l: 100, c: 100.6 },
    { o: 100.6, h: 101, l: 100.3, c: 100.9 }, { o: 100.9, h: 101.3, l: 100.6, c: 101.2 },
    { o: 101.2, h: 101.6, l: 100.9, c: 101.5 },
  ];
  const plain = detectPatterns([...bg(2), ...flatPole, ...tight()]);
  assert.ok(plain.includes('Tight consolidation'), `got ${plain.join(', ')}`);
  assert.ok(!plain.some(p => /flag/i.test(p)), 'no pole means no flag');

  /* NEGATIVE on tightness: a 3% range is not consolidation at all. */
  const loose = detectPatterns([...bg(2), ...rally, ...bg(6)]);
  assert.ok(!loose.some(p => /consolidation|flag/i.test(p)),
    'a 3% six-candle range must not read as tight consolidation');
});

test('W1. double top and double bottom, plus both negatives', () => {
  /* Two highs within 0.5% of each other, at least 3 bars apart, inside the last 20. */
  const base = (): Candle[] => Array.from({ length: 20 }, () => ({ o: 100, h: 100.5, l: 99.5, c: 100 }));
  const dt = base();
  dt[4] = { o: 100, h: 110, l: 99.5, c: 100 };
  dt[14] = { o: 100, h: 110.2, l: 99.5, c: 100 };     // 0.18% apart
  assert.ok(detectPatterns(dt).includes('Double top'), 'double top not detected');

  const db = base();
  db[4] = { o: 100, h: 100.5, l: 90, c: 100 };
  db[14] = { o: 100, h: 100.5, l: 90.1, c: 100 };     // 0.11% apart
  assert.ok(detectPatterns(db).includes('Double bottom'), 'double bottom not detected');

  /* NEGATIVE 1: the two highs are 5% apart, so they are not a pair. */
  const apart = base();
  apart[4] = { o: 100, h: 110, l: 99.5, c: 100 };
  apart[14] = { o: 100, h: 115, l: 99.5, c: 100 };
  assert.ok(!detectPatterns(apart).includes('Double top'),
    'highs 5% apart are not a double top');

  /* NEGATIVE 2: equal highs only 2 bars apart - the >= 3 separation rule. Two adjacent candles at
     the same high are one peak, not two. */
  const adjacent = base();
  adjacent[10] = { o: 100, h: 110, l: 99.5, c: 100 };
  adjacent[11] = { o: 100, h: 110, l: 99.5, c: 100 };
  assert.ok(!detectPatterns(adjacent).includes('Double top'),
    'two adjacent peaks are one peak - the separation rule is >= 3 bars');

  /* And under 20 candles the whole check is skipped. */
  assert.ok(!detectPatterns(dt.slice(-19)).includes('Double top'),
    'under 20 candles there is no double-top check');
});

test('S1. the SEAM: the alert route interpolates the raw name, so a new name cannot break it', () => {
  /* `app/api/telegram/alert/route.ts:784-786` does `patternStr = pats[0]` and renders
     `Pattern: <b>${patternStr}</b>`. There is no switch and no copy mapping, so an unrecognised
     name reaches the user verbatim rather than producing a blank or a crash.
     THAT IS THE GOOD NEWS AND IT IS WORTH PINNING: the feared failure at this seam - a name the
     alert copy does not handle - cannot happen by construction. What CAN happen is S2. */
  const s = detectPatternsStr([...bg(8), { o: 100, h: 101, l: 99, c: 101 }, { o: 101.5, h: 102, l: 99, c: 99.5 }]);
  assert.ok(s.includes('Bearish engulfing'));
  assert.ok(!s.includes('undefined'), 'the joined string must never contain undefined');

  /* THE SEPARATOR IS PINNED EXACTLY, on a fixture that really produces two names. Asserting only
     `includes(oneName)` left a mutation changing '; ' to ', ' entirely undetected - the cell was
     checking membership, not the joining it is named after. */
  const twoPatterns: Candle[] = [...bg(8),
    { o: 100, h: 101, l: 99, c: 101 },
    { o: 101.5, h: 102, l: 95, c: 99.5 }];
  const names = detectPatterns(twoPatterns);
  assert.ok(names.length >= 2, `fixture must produce 2+ patterns, got ${names.length}: ${names.join(' | ')}`);
  assert.equal(detectPatternsStr(twoPatterns), names.join('; '),
    "detectPatternsStr must join with '; ' - the Arena reads this string directly");
  /* Empty in, empty out - the route guards on `pats.length > 0`, so this is the value it relies on. */
  assert.equal(detectPatternsStr(bg(12)), '');
});

test('S2. GUARD: the alert shows the RANKED first name, not whichever check ran first', () => {
  /* ALSO FLIPPED FROM PINNING A BUG TO GUARDING ITS FIX. The alert renders only `pats[0]`, and
     before 08a2bb16 `found` was built in source order - trend, engulfing, doji, hammer,
     consolidation, THEN double top/bottom last - so the single name a user saw was decided by where
     the `if` blocks happened to sit. A double top, the most consequential reversal in the
     vocabulary, was appended last and was therefore the name least likely to be shown.

     MEASURED BEFORE THE FIX, over the same 95,648 live windows: 34.99% of windows contained a
     double top or bottom, and 25.84% had one present but NOT first - so roughly one in four alerts
     that could have named a reversal named a compression instead, usually "Tight consolidation",
     which was checked one step earlier. That is why this ranked second in severity behind nothing.

     `rankPatterns` now sorts by a written-down judgement instead. */
  const both: Candle[] = Array.from({ length: 20 }, (_, i) => ({ o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i }));
  both[16] = { ...both[16], h: 130 };
  both[19] = { ...both[19], h: 130.2 };
  const got = detectPatterns(both);

  assert.ok(got.includes('Double top'), 'fixture should contain a double top');
  assert.ok(got.length >= 2, `fixture should produce more than one pattern, got ${got.join(' | ')}`);
  assert.equal(got[0], 'Double top',
    'the double top is no longer shown first. The alert renders only pats[0], so a reversal is ' +
    'being suppressed behind a less consequential name - measured at 25.84% of windows before the fix.');

  /* The ranking must beat the specific name that used to mask it, not just "something". */
  assert.ok(!got.includes('Tight consolidation') || got.indexOf('Double top') < got.indexOf('Tight consolidation'),
    'Tight consolidation is outranking Double top again - that exact pair was the 25.84% case');
});

test('P1. CONTROL: every name the detector can emit has a RANK position', () => {
  /* REPLACES A CELL FOR A FUNCTION THAT NO LONGER EXISTS. This tested `patternBias`, which 08a2bb16
     deleted. Worth recording that the deletion was clean: `patternBias` had NO production callers -
     this test file was the only thing in the tree importing it - so nothing regressed, and the only
     casualty was my own assertion.

     WHAT MATTERS NOW IS RANK COVERAGE, because `rankPatterns` sorts an unknown name to the END
     (`RANK.indexOf` returns -1 and the comparator maps that to `RANK.length`). That is the right
     default - a new name is shown last rather than dropped - but it is SILENT. A thirteenth pattern
     added to the detector without a rank entry would quietly become the least important thing on
     every chart it appears on, and the alert shows only the first name.

     THE EMITTABLE SET IS DERIVED FROM THE SOURCE, NEVER TYPED OUT HERE. A hardcoded list of names
     stops tracking the detector the moment someone adds one - which is exactly the failure this
     cell exists to catch, so writing it that way would be self-defeating. */
  const src = readFileSync(path.join(ROOT, 'lib/patterns.ts'), 'utf8');
  const pushed = [...src.matchAll(/found\.push\('([^']+)'\)/g)].map((m) => m[1]);
  const ternary = [...src.matchAll(/\?\s*'([^']+)'\s*:\s*'([^']+)'/g)].flatMap((m) => [m[1], m[2]]);
  const emittable = [...new Set([...pushed, ...ternary])];

  /* Positive control on the derivation itself: if the regexes stop matching, `emittable` goes
     empty or short and every assertion below passes vacuously. 12 is what 08a2bb16 ships. */
  assert.ok(emittable.length >= 12,
    `only ${emittable.length} emittable names derived from lib/patterns.ts (${emittable.join(', ') || 'none'}). ` +
    'The scan is broken, so the rank check below would be a false pass.');
  assert.ok(emittable.includes('Double top') && emittable.includes('Hanging man'),
    'the derivation must find both a push() name and a ternary name, or it is only reading half the source');

  /* 'Tight consolidation' is deliberately LAST in RANK, so anything unranked sorts AFTER it.
     That makes it the probe: a ranked name must come before it, an unranked one after. */
  const LAST_RANKED = 'Tight consolidation';
  const unranked = emittable.filter((name) => {
    if (name === LAST_RANKED) return false;
    return rankPatterns([LAST_RANKED, name])[0] !== name;
  });
  assert.deepEqual(unranked, [],
    `${unranked.join(', ')} can be emitted by detectPatterns but has no entry in RANK, so it sorts ` +
    'to the end and becomes the least important name on any chart it appears on - silently. The ' +
    'alert shows only the first name. Add it to RANK at the position it deserves.');

  /* And the ordering the fix exists for, asserted directly rather than only through a fixture. */
  assert.deepEqual(rankPatterns(['Tight consolidation', 'Double top']), ['Double top', 'Tight consolidation']);
  assert.deepEqual(rankPatterns([]), [], 'an empty list ranks to an empty list');
});
