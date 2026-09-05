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
import { readFileSync } from 'node:fs';

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

test('every TINTED cell clears 4.5:1 in both themes, on any card ground', () => {
  /* Tinted only, and the name says so. QA's review of #678 caught that this
     read "every reachable cell" while sweeping only cells that carry a tint and
     take --txt. The null cell is a different pair - --txt3 on
     rgba(255,255,255,0.03) - and is covered by the test below rather than by
     this one. An overstated coverage claim is exactly what this file exists to
     prevent, so the name had to narrow. */
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

test('the null cell clears 4.5:1 too, on --txt-dash (#679)', () => {
  /* The null cell paints rgba(255,255,255,0.03) over the card. That overlay
     lightens the ground toward the text, and --txt3 landed at 4.40 / 4.46 in
     dark - so it takes --txt-dash instead, the value #559 created for exactly
     this composited shape.

     --txt3 itself is NOT the problem and did not move: it passes on every bare
     palette ground in both themes (dark 5.14 / 4.71 / 4.77). An earlier version
     of this comment said it "clears by about 0.1 on --bg0 and spends that
     margin on any raised surface" - both halves wrong, and the table above is
     why. Fixing the token would have degraded three passing surfaces to rescue
     one composited one, which qa/TERMINAL_REDESIGN_STATE.md already rejected. */
  for (const { name, T } of THEMES) {
    for (const ground of GROUNDS) {
      const overlay = name === 'dark' ? '#ffffff' : '#000000';
      const alpha   = name === 'dark' ? 3 : 4;
      const c = ratio(hex(T['--txt-dash']), over(overlay, T[ground], alpha));
      assert.ok(c >= 4.5, `${name} null cell on ${ground}: ${c.toFixed(2)}`);
    }
  }
});

test('--txt3 would still fail there, so the swap is doing the work', () => {
  /* Positive control for the fix itself. If --txt3 ever passes on this ground,
     the reason for --txt-dash is gone and this should be revisited rather than
     left as cargo. */
  const T = TERMINAL_COLORS as Record<string, string>;
  const c = ratio(hex(T['--txt3']), over('#ffffff', T['--bg1'], 3));
  assert.ok(c < 4.5, `--txt3 now measures ${c.toFixed(2)} on the null ground; --txt-dash may be unnecessary`);
});

/* ── THE CURRENT DESIGN USES THE SAME RAMP NOW (#774) ──────────────────────
 *
 * app/correlation/page.tsx carried its own copy of this curve - same rescale,
 * same exponents, same floors, caps of 96% and 92% against this file's 50% and
 * 56%. Only the caps differed, and that was 1332 failing cells on production,
 * worst 1.79, concentrated in the strongly-correlated cells the screen exists
 * to highlight.
 *
 * It now imports tintPct(). These assertions are what make that safe, because
 * the caps above were derived against TERMINAL's tokens and the current design
 * has different ones:
 *
 *     terminal --green  #3fb950        current  rgba(52,211,153)
 *     terminal --red    (token)        current  rgba(248,113,113)
 *
 * The cell colours here are hardcoded literals rather than tokens, so they do
 * NOT change with the theme - only the ground and the text do. That is why a
 * cap verified in one theme cannot be assumed in the other, which is the
 * mistake this whole file exists to prevent, and which #641, #750 and #769 all
 * repeated on other surfaces the same day this was written.
 *
 * THE CAP WAS ONLY HALF THE DEFECT. The current design also used --txt3 for
 * every cell below |r| = 0.8. Against its own green that fails from 9% alpha
 * in dark, red from 12% - so most of the grid was failing as soon as it
 * carried any tint. With the terminal caps and --txt3 it still measures 1.57
 * at full strength: a smaller failure, not a fix. Text is --txt now, which is
 * the conclusion CorrelationTerminal.tsx:77 reached in #570. */
const CURRENT_GREEN = '#34d399';   // rgba(52,211,153,a)
const CURRENT_RED   = '#f87171';   // rgba(248,113,113,a)

/* Read from globals.css rather than restated: the current design has no
   TERMINAL_COLORS equivalent, and a hand-copied palette in a test is the
   two-sources bug this file's own header is about. */
const GLOBALS = readFileSync('app/globals.css', 'utf8');
function currentTokens(selector: string): Record<string, string> {
  const lines = GLOBALS.split('\n');
  const idx = lines.findIndex(l => l.trim() === selector + ' {');
  assert.ok(idx >= 0, `token block not found: ${selector}`);
  const from = lines.slice(0, idx).join('\n').length;
  let i = GLOBALS.indexOf('{', from), depth = 0, end = i;
  for (; i < GLOBALS.length; i++) {
    if (GLOBALS[i] === '{') depth++;
    else if (GLOBALS[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = GLOBALS.slice(GLOBALS.indexOf('{', from) + 1, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}
const CURRENT_ROOT  = currentTokens(':root');
const CURRENT_LIGHT = { ...CURRENT_ROOT, ...currentTokens('[data-theme="light"]') };

/* .card's background is var(--bg2) (globals.css:728) and the grid renders
   inside one. NOT a sweep of --bg0/--bg1/--bg2 like the terminal tests above:
   --bg0 is undefined in the light block, so it falls through to :root's
   near-black, and including it reports a 1.00 in light that no element on this
   page ever renders. That wrong number appeared in my first run of this
   measurement. */
const CURRENT_THEMES = [
  { name: 'current dark',  T: CURRENT_ROOT },
  { name: 'current light', T: CURRENT_LIGHT },
];

test('the shared ramp clears 4.5:1 on the CURRENT design\'s cell colours too', () => {
  const failures: string[] = [];
  for (const { name, T } of CURRENT_THEMES) {
    for (let i = -100; i <= 100; i++) {
      const r = i / 100;
      const pct = tintPct(r);
      const tint = r > 0 ? CURRENT_GREEN : CURRENT_RED;
      const c = ratio(hex(T['--txt']), over(tint, T['--bg2'], pct));
      if (c < 4.5) failures.push(`${name} r=${r.toFixed(2)} alpha=${pct.toFixed(1)}% -> ${c.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures.slice(0, 5), [],
    `${failures.length} current-design cell states below 4.5:1. The caps in ` +
    'lib/correlationRamp.ts were derived against the TERMINAL palette; if this ' +
    'fails they no longer cover both designs and the binding one has to be re-derived.');
});

test('CONTROL: the caps this replaced really did fail, and --txt3 fails even with them', () => {
  /* Two positive controls, because #774 had two halves and either alone would
     have looked like a fix.

     Without these, the assertion above passing proves only that it ran - and a
     check that cannot fail is the defect this project hit five separate ways in
     one session. */
  const T = CURRENT_ROOT;

  // 1. The old 96% green cap, which is what shipped.
  const oldCap = ratio(hex(T['--txt']), over(CURRENT_GREEN, T['--bg2'], 96));
  assert.ok(oldCap < 4.5, `expected the old 96% cap to fail, measured ${oldCap.toFixed(2)}`);

  // 2. --txt3 at the NEW cap - the half a cap change alone would have missed.
  const withTxt3 = ratio(hex(T['--txt3']), over(CURRENT_GREEN, T['--bg2'], GREEN_CAP_PCT));
  assert.ok(withTxt3 < 4.5,
    `--txt3 now measures ${withTxt3.toFixed(2)} at the capped alpha; if it passes, ` +
    'the always---txt change is no longer load-bearing and this should be revisited.');
});
