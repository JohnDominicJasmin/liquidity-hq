/* The /hours session-band labels, measured against the real palette (#707).
 *
 * Two fixes shipped here and each one fixed a theme and broke the other:
 * `'#fff'` fails all six bands in light, `var(--txt)` fails three in dark.
 * Both were reasoned about correctly and measured on one axis. This is the
 * test that makes the second axis non-optional.
 *
 * It reads the band colours from app/hours/page.tsx and the grounds from
 * app/globals.css - not from constants restated here - so a palette change
 * moves the assertion with it. Restating either would be the two-sources bug
 * that #736 and #663 are both about, in the file meant to prevent it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSS, CONTEXTS, resolve } from './_cssContexts.mts';
import {
  readableOn, parseCssColor, compositeOver, contrastRatio, relativeLuminance,
  BLACK, WHITE, type Rgb,
} from '../lib/readableOn.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = readFileSync(path.join(ROOT, 'app', 'hours', 'page.tsx'), 'utf8');

const BAR = 4.5;

/* tokens(), resolve() and CONTEXTS moved to ./_cssContexts.mts when a second
   test needed them (#696). Two copies of a CSS parser drift quietly: a stale
   one still returns well-formed colours, just not the page's. */

/** The band colours, read out of the page rather than copied.
 *  `{ start: 4, end: 7, bg: 'rgba(248,113,113,0.45)', labelKey: 'HOURS_SEG_DEAD' … }` */
function bandsFromPage(): Array<{ label: string; bg: string }> {
  const out: Array<{ label: string; bg: string }> = [];
  for (const m of PAGE.matchAll(/bg:\s*'([^']+)',\s*labelKey:\s*'([A-Z_]+)'/g)) {
    out.push({ label: m[2].replace('HOURS_SEG_', ''), bg: m[1] });
  }
  return out;
}

test('the band list parsed out of the page is plausible', () => {
  const bands = bandsFromPage();
  assert.equal(bands.length, 6,
    `expected 6 session bands in app/hours/page.tsx, parsed ${bands.length} ` +
    `(${bands.map(b => b.label).join(', ')}). If a band was added or the literal ` +
    'was reformatted, fix the parser - do not relax this number, or the sweep ' +
    'below silently stops covering a band.');
  for (const b of bands) {
    assert.ok(parseCssColor(b.bg), `band ${b.label} has an unparseable colour: ${b.bg}`);
  }
});

test('every band label clears 4.5:1 in all four theme x design contexts', () => {
  /* HONEST NOTE ON WHAT THIS CAN AND CANNOT FAIL.
   *
   * I wrote this expecting it to be the main guard, then control-tested it by
   * swapping a band for a mid-grey - and it still passed. It cannot fail on a
   * band colour, and the reason is the point of the whole ruling:
   *
   *   contrast(white, L) = 1.05 / (L + 0.05)
   *   contrast(black, L) = (L + 0.05) / 0.05
   *
   * The two are equal at L = 0.1791, where both are 4.58. So max(black, white)
   * has a FLOOR of 4.58 for every opaque colour that exists, and compositing a
   * translucent band onto an opaque ground always produces an opaque colour.
   * There is no band this can fail on - which is exactly why deriving per band
   * is guaranteed to work where a single token could not.
   *
   * What it does still catch: an unresolvable --bg3, a band literal that stops
   * parsing, and any future change to the candidate set (a token instead of
   * black/white has no such floor). Kept for those, with its ceiling stated
   * rather than left to be discovered by whoever trusts it next. The assertion
   * that carries real weight here is the opacity one below. */
  const bands = bandsFromPage();
  const failures: string[] = [];
  for (const [name, map] of CONTEXTS) {
    const ground = resolve(map, 'var(--bg3)');
    assert.ok(ground, `--bg3 does not resolve in ${name}`);
    for (const band of bands) {
      const pick = readableOn(band.bg, ground!);
      assert.ok(pick, `readableOn returned null for ${band.label} on ${ground}`);
      if (pick!.ratio < BAR) {
        failures.push(`${name} / ${band.label}: best is ${pick!.color} at ${pick!.ratio.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(failures, [],
    'a session band cannot carry a legible label:\n  ' + failures.join('\n  ') +
    '\nBlack and white are the only candidates, so this means the BAND colour ' +
    'has to move - no text colour rescues a band that lands mid-tone.');
});

test('the 4.58 floor is real, not an assumption - swept', () => {
  /* The claim above, measured rather than derived on paper: across a dense
     sweep of the sRGB cube, the better of black and white never drops below
     4.5. If this ever fails, the guarantee the #707 ruling rests on is wrong
     and the per-band derivation needs a third candidate. */
  let worst = Infinity, worstAt: Rgb = [0, 0, 0];
  for (let r = 0; r <= 255; r += 5) {
    for (let g = 0; g <= 255; g += 5) {
      for (let b = 0; b <= 255; b += 5) {
        const c: Rgb = [r, g, b];
        const best = Math.max(contrastRatio(BLACK, c), contrastRatio(WHITE, c));
        if (best < worst) { worst = best; worstAt = c; }
      }
    }
  }
  assert.ok(worst >= BAR,
    `black-or-white bottoms out at ${worst.toFixed(3)} on rgb(${worstAt.join(',')}), below the 4.5 bar`);
  assert.ok(Math.abs(worst - 4.58) < 0.02,
    `expected the floor near 4.58, swept ${worst.toFixed(3)} - the maths in ` +
    'relativeLuminance or contrastRatio has changed');
});

test('the label carries no opacity - the fade is what made ASIA unfixable', () => {
  /* With opacity 0.9 ASIA in dark measures 4.27 black / 4.07 white: both
     below the bar, so no colour choice can fix it while the fade is there.
     This is the assertion that stops the fade coming back as a "restore the
     original look" change - it would silently re-break one band. */
  const seg = PAGE.slice(PAGE.indexOf('{width > 7 && ('), PAGE.indexOf('{width > 7 && (') + 400);
  assert.ok(!/opacity/.test(seg),
    'the session-band label has an opacity again. Any fade multiplies through ' +
    'the contrast: ASIA in dark falls to 4.27 (black) / 4.07 (white) at 0.9, ' +
    'and no colour clears it. Remove the opacity or move the band colour.');
});

test('a translucent surface is measured against the ground, not against white', () => {
  /* The bug this whole file exists for, in one assertion: the SAME band gets
     opposite answers on the two grounds, so any code path that forgets the
     ground gets the light answer in dark. */
  const prime = 'rgba(125,224,164,0.70)';
  const onDark = readableOn(prime, '#0f1115');
  const onLight = readableOn(prime, '#E4E6E9');
  assert.equal(onDark?.color, '#000');
  assert.equal(onLight?.color, '#000');

  const london = 'rgba(122,184,245,0.55)';
  assert.equal(readableOn(london, '#0f1115')?.color, '#fff');
  assert.equal(readableOn(london, '#E4E6E9')?.color, '#000');
});

test('an unparseable ground returns null rather than guessing', () => {
  assert.equal(readableOn('rgba(125,224,164,0.70)', 'var(--bg3)'), null);
  assert.equal(readableOn('rgba(125,224,164,0.70)', 'chartreuse'), null);
  assert.equal(readableOn('not a colour', '#000000'), null);
});

test('the primitives agree with the WCAG reference values', () => {
  // Anchors, so a refactor of the maths cannot drift unnoticed.
  assert.equal(relativeLuminance(WHITE), 1);
  assert.equal(relativeLuminance(BLACK), 0);
  assert.equal(contrastRatio(BLACK, WHITE), 21);
  assert.equal(contrastRatio(WHITE, WHITE), 1);

  // #767676 on white is the canonical 4.54:1 "smallest passing grey".
  const grey = parseCssColor('#767676')!.rgb;
  assert.ok(Math.abs(contrastRatio(grey, WHITE) - 4.54) < 0.01,
    `#767676 on white measured ${contrastRatio(grey, WHITE).toFixed(2)}, expected 4.54`);
});

test('parseCssColor handles the three shapes this codebase writes', () => {
  assert.deepEqual(parseCssColor('#fff'), { rgb: [255, 255, 255], alpha: 1 });
  assert.deepEqual(parseCssColor('#0f1115'), { rgb: [15, 17, 21], alpha: 1 });
  assert.deepEqual(parseCssColor('rgb(1, 2, 3)'), { rgb: [1, 2, 3], alpha: 1 });
  assert.deepEqual(parseCssColor('rgba(125,224,164,0.7)'), { rgb: [125, 224, 164], alpha: 0.7 });
  assert.equal(parseCssColor('#ff'), null);
  assert.equal(parseCssColor(''), null);
});

test('compositeOver flattens toward the ground as alpha falls', () => {
  const white: Rgb = [255, 255, 255];
  assert.deepEqual(compositeOver(white, BLACK, 1), [255, 255, 255]);
  assert.deepEqual(compositeOver(white, BLACK, 0), [0, 0, 0]);
  assert.deepEqual(compositeOver(white, BLACK, 0.5), [127.5, 127.5, 127.5]);
});

/* ── color(srgb …), AND THE THINGS THAT MUST STILL RETURN null ─────────────
 *
 * Added after #771, where my own chain walk matched `rgb()`/`rgba()` only,
 * silently skipped a `color(srgb 0.458824 0.305882 0 / 0.1)` layer, and
 * measured an element against the bare card - 5.56 for something that measures
 * 4.82. No error, no warning, a plausible number.
 *
 * Every color-mix() in this codebase computes to this syntax, so a parser used
 * against getComputedStyle output that cannot read it is not conservative, it
 * is wrong in the direction that looks fine. */

test('color(srgb ...) parses, scaled by prefix rather than by value range', () => {
  // The exact value from #771's .ms-last-event: --accent at 10%.
  const gold = parseCssColor('color(srgb 0.458824 0.305882 0 / 0.1)');
  assert.ok(gold, 'color(srgb …) did not parse');
  assert.deepEqual(gold!.rgb.map(c => Math.round(c)), [117, 78, 0]);
  assert.ok(Math.abs(gold!.alpha - 0.1) < 1e-9);

  // No alpha component means opaque, not zero.
  const opaque = parseCssColor('color(srgb 0.2 0.7 0.3)');
  assert.equal(opaque?.alpha, 1);
  assert.deepEqual(opaque!.rgb.map(c => Math.round(c)), [51, 179, 77]);

  // Percentage channels are the same colour by another spelling.
  const pct = parseCssColor('color(srgb 100% 0% 50%)');
  assert.deepEqual(pct!.rgb.map(c => Math.round(c)), [255, 0, 128]);
});

test('a 0-255 rgb() is NOT rescaled just because its numbers are small', () => {
  /* The value-range heuristic - "these all look like 0-1, so scale them" -
     would turn this into black. The prefix is the only thing that says which
     space a triple is in, which is why the branch keys on it. */
  const small = parseCssColor('rgb(0 1 2)');
  assert.deepEqual(small!.rgb, [0, 1, 2]);
  assert.equal(small!.alpha, 1);
});

test('transparent is alpha 0, not a parse failure', () => {
  /* A layer that is genuinely transparent must composite as a no-op. Returning
     null for it would make a chain walk treat it as unreadable and stop, which
     is a different wrong answer from the one this file is about. */
  const t = parseCssColor('transparent');
  assert.equal(t?.alpha, 0);
  assert.deepEqual(compositeOver(t!.rgb, [10, 20, 30], t!.alpha), [10, 20, 30]);
});

test('FAIL CLOSED: every syntax this does not understand returns null', () => {
  /* THE LOAD-BEARING TEST. A parser that returns null leaves a visible hole;
     one that returns a confident number produces a finding. On 2026-09-04 that
     distinction was the difference between a probe that reported nothing and a
     probe that reported /correlation at 1.05:1 with "the encoding deleted",
     which reached an issue and nearly reached the owner.
     If a later change makes any of these parse, it must be a deliberate branch
     with its own test - not a lenient fallback that guesses. */
  for (const s of [
    'oklch(0.7 0.1 150)',
    'lab(50% 40 59)',
    'hsl(210 50% 40%)',
    'hwb(200 20% 30%)',
    'color(display-p3 0.2 0.7 0.3)',   // same syntax, DIFFERENT primaries
    'color(rec2020 0.2 0.7 0.3)',
    'color(srgb 0.2 0.7)',             // too few channels
    'color(srgb 0.2 0.7 nope)',
    'rebeccapurple',
    '#ff',
    '',
  ]) {
    assert.equal(parseCssColor(s), null, `${JSON.stringify(s)} should not parse`);
  }
});

test('readableOn composites a color(srgb ...) surface and ground correctly', () => {
  /* End to end on the shape that broke: a translucent modern-syntax tint over
     an opaque card. The answer has to match the same colour written as rgba. */
  const viaColorFn = readableOn(
    'color(srgb 0.458824 0.305882 0 / 0.1)',
    'color(srgb 0.921569 0.913725 0.901961)',
  );
  const viaRgba = readableOn('rgba(117,78,0,0.1)', '#ebe9e6');
  assert.ok(viaColorFn && viaRgba);
  assert.ok(Math.abs(viaColorFn!.ratio - viaRgba!.ratio) < 0.02,
    `same colour, two spellings, different answers: ${viaColorFn!.ratio} vs ${viaRgba!.ratio}`);
});
