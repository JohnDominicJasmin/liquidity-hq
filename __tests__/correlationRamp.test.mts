/* The /correlation heatmap's tint never gets dark enough to fail AA (#570).
 *
 * WHY THIS EXISTS. #570 was a real defect - 2368 of 2450 dark cells below
 * 4.5:1, worst 1.66 - and it was fixed twice. The second fix carried its
 * reasoning as a comment:
 *
 *     "Red's two thresholds sit close together (~72-73% either theme)
 *      so 65% covers both."
 *
 * That sentence measured dark and assumed light matched. Light red fails at
 * 61-66%, so a 65% cap left strongly negative correlations at 4.09:1 - an AA
 * failure that survived both the fix and its review, because a comment cannot
 * be run and nobody re-derived it.
 *
 * These assertions can be run. They composite the ramp's real output against
 * the real tokens, which is the only form of that claim that stays true.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { tintPct, GREEN_CAP_PCT, RED_CAP_PCT } from '../lib/correlationRamp.ts';
import { TERMINAL_COLORS, TERMINAL_COLORS_LIGHT } from '../lib/terminalTokens.ts';

const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (r: number[]) => 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]);
const ratio = (a: number[], b: number[]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** `color-mix(in srgb, TINT p%, transparent)` over an opaque card. */
const over = (tint: string, bg: string, pct: number) =>
  hex(tint).map((c, i) => c * (pct / 100) + hex(bg)[i] * (1 - pct / 100));

const THEMES = [
  { name: 'dark',  T: TERMINAL_COLORS as Record<string, string> },
  { name: 'light', T: TERMINAL_COLORS_LIGHT as Record<string, string> },
];
/* The cell composites over whichever card surface sits behind the grid. Which
   one is not pinned in CSS, so every plausible ground is checked and the worst
   is what has to pass. */
const GROUNDS = ['--bg0', '--bg1', '--bg2'];

test('every reachable cell clears 4.5:1 in both themes, on any card ground', () => {
  const failures: string[] = [];
  for (const { name, T } of THEMES) {
    for (const ground of GROUNDS) {
      for (let i = -100; i <= 100; i++) {
        const r = i / 100;
        const pct = tintPct(r);
        const tint = r > 0 ? T['--green'] : T['--red'];
        const c = ratio(hex(T['--txt']), over(tint, T[ground], pct));
        if (c < 4.5) failures.push(`${name} ${ground} r=${r.toFixed(2)} alpha=${pct.toFixed(1)}% -> ${c.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(failures.slice(0, 5), [], `${failures.length} cell states below 4.5:1`);
});

test('the old 65% red cap really did fail, so this test can detect the defect', () => {
  /* A positive control. Without it, the assertion above passing proves only
     that it ran - the same "an empty result from a broken check looks like a
     clean one" trap that has bitten this project in three other forms. */
  const T = TERMINAL_COLORS_LIGHT as Record<string, string>;
  const c = ratio(hex(T['--txt']), over(T['--red'], T['--bg2'], 65));
  assert.ok(c < 4.5, `expected the old cap to fail, measured ${c.toFixed(2)}`);
});

test('the caps are the binding constraint, not the curve', () => {
  /* r = +-1 must produce exactly the cap. If the curve ever changes shape,
     this catches a cap that stopped being reachable - or one that is now
     exceeded, which the sweep above would also catch but less legibly. */
  assert.equal(Number(tintPct(1).toFixed(4)), GREEN_CAP_PCT);
  assert.equal(Number(tintPct(-1).toFixed(4)), RED_CAP_PCT);
});

test('the ramp is monotonic away from zero', () => {
  /* A stronger correlation must never be tinted more faintly than a weaker
     one - the tint IS the reading, so a non-monotonic ramp would misinform
     rather than merely look odd. */
  /* Within each branch only. Comparing across zero is meaningless: r > 0 takes
     the green ramp from a 4% floor and r <= 0 takes the red one from 6%, so
     tintPct(0.01) < tintPct(0) by construction. My first version asserted
     across the boundary and failed at r=0.01 - the test was wrong, not the
     ramp. Worth noting the quirk it exposed: r exactly 0 renders a faint RED
     tint rather than a neutral one, because the branch is `r > 0`. Pre-existing
     and cosmetic at 6% alpha, recorded rather than changed here. */
  for (let i = 2; i <= 100; i++) {
    assert.ok(tintPct(i / 100) >= tintPct((i - 1) / 100), `positive ramp dipped at r=${i / 100}`);
    assert.ok(tintPct(-i / 100) >= tintPct(-(i - 1) / 100), `negative ramp dipped at r=${-i / 100}`);
  }
});
