/* The only guard the chart canvas can have (#806, #808).
 *
 * qa/e2e/contrast.spec.ts sweeps 32 routes in two designs and has never
 * measured a single overlay label, because `createPointFigures` returns figures
 * that klinecharts paints into a 2D context - no DOM node, no computed style,
 * nothing for axe to walk. "0 violations on /arena" was true and structurally
 * incomplete. Unlike trap 3's empty /news, no amount of seeding or waiting
 * closes it.
 *
 * So the guard is arithmetic over the constants, which is why they live in
 * lib/chartInk.ts rather than inline in the component.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastRatio, parseCssColor } from '../lib/readableOn.ts';
import {
  CHART_GROUND, TERMINAL_EMA_RAMP, CURRENT_EMA_RAMP, OVERLAY_LINE_INK,
  EMA_RIBBON_PERIODS, emaInk, lineInk, type EmaPeriod, type OverlayKind,
} from '../lib/chartInk.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ratio = (a: string, b: string) => contrastRatio(parseCssColor(a)!.rgb, parseCssColor(b)!.rgb);

const GRAPHIC_MIN = 3;    // SC 1.4.11
const TEXT_MIN    = 4.5;  // SC 1.4.3

test('every overlay label clears 4.5:1, which no rendered sweep can check', () => {
  const failures: string[] = [];
  for (const theme of ['dark', 'light'] as const) {
    for (const [name, { bg, text }] of Object.entries(OVERLAY_LINE_INK[theme])) {
      const r = ratio(text, bg);
      if (r < TEXT_MIN) failures.push(`${theme} ${name}: ${text} on ${bg} = ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [],
    `${failures.length} overlay label(s) below ${TEXT_MIN}:1:\n  ${failures.join('\n  ')}\n` +
    'These are canvas text. axe cannot see them and neither can contrast.spec.ts, ' +
    'so this test is the only thing between a regression and production.');
});

test('the label fix was the text colour, not the palette', () => {
  /* Recording WHY each choice is what it is, so a future edit that "tidies"
     them back to white has to argue with a number. Four of the five are light
     chips where black wins by a mile; the cluster chip is the one real
     judgement call, and it is nearly a coin toss. */
  const measured = Object.fromEntries(
    Object.entries(OVERLAY_LINE_INK.dark).map(([k, { bg, text }]) => [k, {
      chosen: Number(ratio(text, bg).toFixed(2)),
      white:  Number(ratio('#ffffff', bg).toFixed(2)),
      black:  Number(ratio('#000000', bg).toFixed(2)),
    }]),
  );
  assert.deepEqual(measured, {
    srResistance: { chosen: 7.59, white: 2.77, black: 7.59 },
    srSupport:    { chosen: 10.92, white: 1.92, black: 10.92 },
    gexMaxPain:   { chosen: 7.72, white: 2.72, black: 7.72 },
    gexFlip:      { chosen: 11.62, white: 1.81, black: 11.62 },
    liqCluster:   { chosen: 4.60, white: 4.60, black: 4.57 },
  });
});

test('every overlay LINE clears 3:1 on its own ground - the whole of #816', () => {
  /* The rule and the chip are one colour with two jobs. #808 fixed the text on
     the chip; this is the rule against the page, which failed on the light
     ground for six of the seven and passed on dark for all of them. */
  const failures: string[] = [];
  for (const theme of ['dark', 'light'] as const) {
    for (const [name, { bg }] of Object.entries(OVERLAY_LINE_INK[theme])) {
      const r = ratio(bg, CHART_GROUND[theme]);
      if (r < GRAPHIC_MIN) failures.push(`${theme} ${name}: ${bg} on ${CHART_GROUND[theme]} = ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [],
    'An overlay rule below 3:1 on the ground it is drawn against is a price level ' +
    'the user cannot see. SC 1.4.11 - these carry information, they are not decoration.');
});

test('the light values keep their hue - lightness is what moved', () => {
  /* Hue is what makes these tellable apart from each other; a contrast ratio
     between two of them is the wrong instrument for that (#787, #756). So the
     fix had to darken rather than recolour, and this asserts it did. */
  const hue = (hex: string) => {
    const [r, g, b] = parseCssColor(hex)!.rgb.map(v => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return 0;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; return h < 0 ? h + 360 : h;
  };
  for (const kind of Object.keys(OVERLAY_LINE_INK.dark) as OverlayKind[]) {
    const drift = Math.abs(hue(OVERLAY_LINE_INK.light[kind].bg) - hue(OVERLAY_LINE_INK.dark[kind].bg));
    assert.ok(drift <= 1, `${kind} shifted hue by ${drift.toFixed(1)} degrees - it should have been darkened, not recoloured`);
  }
});

test('the realized-cluster pink is the one that did not move', () => {
  /* It passes at 3.81 on the light ground, and its white label text beats black
     by 0.03. Retuning it would force that coin-toss to be re-made for no gain. */
  assert.equal(OVERLAY_LINE_INK.light.liqCluster.bg, OVERLAY_LINE_INK.dark.liqCluster.bg);
  assert.equal(OVERLAY_LINE_INK.light.liqCluster.text, '#ffffff');
  assert.ok(ratio('#db2777', CHART_GROUND.light) >= GRAPHIC_MIN);
});

test('lineInk hands back the table entry for the theme asked for', () => {
  assert.deepEqual(lineInk('srResistance', true), OVERLAY_LINE_INK.dark.srResistance);
  assert.deepEqual(lineInk('srResistance', false), OVERLAY_LINE_INK.light.srResistance);
  assert.notDeepEqual(lineInk('gexFlip', true), lineInk('gexFlip', false));
});

test('each terminal ramp step clears 3:1 on its own ground', () => {
  const failures: string[] = [];
  for (const theme of ['dark', 'light'] as const) {
    const ground = CHART_GROUND[theme];
    for (const p of EMA_RIBBON_PERIODS) {
      const c = TERMINAL_EMA_RAMP[theme][p];
      const r = ratio(c, ground);
      if (r < GRAPHIC_MIN) failures.push(`terminal ${theme} EMA${p}: ${c} on ${ground} = ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [],
    'A ribbon line below 3:1 on its own ground is not a ribbon line. This is why ' +
    'the ramp is per THEME and not only per design: #8b8f94 measured 6.45:1 on ' +
    'black and 2.70:1 on the light ground, and one grey cannot serve both.');
});

test('the terminal ramp stays distinct - which is the whole of #806', () => {
  /* These are neutral greys (r=g=b), so a contrast ratio IS the right measure
     of distinctness here. It is NOT for two different hues - #787 and #756
     were both filed on a contrastRatio between a brown and a blue that reported
     1.02 for colours anyone can tell apart. Instrument chosen for the case. */
  for (const theme of ['dark', 'light'] as const) {
    const ramp = TERMINAL_EMA_RAMP[theme];
    for (const p of EMA_RIBBON_PERIODS) {
      const [r, g, b] = parseCssColor(ramp[p])!.rgb;
      assert.ok(r === g && g === b, `terminal ${theme} EMA${p} is not a neutral grey, so this test's instrument no longer fits`);
    }
    for (let i = 0; i < EMA_RIBBON_PERIODS.length - 1; i++) {
      const a = EMA_RIBBON_PERIODS[i], z = EMA_RIBBON_PERIODS[i + 1];
      const sep = ratio(ramp[a], ramp[z]);
      assert.ok(sep >= 1.4, `terminal ${theme}: EMA${a} and EMA${z} are ${sep.toFixed(2)} apart, too close to read as two lines`);
    }
    const ends = ratio(ramp[9], ramp[200]);
    assert.ok(ends >= 3, `terminal ${theme}: EMA9 and EMA200 are ${ends.toFixed(2)} apart. They were 1.33 (dark) and 1.03 (light) before #806 - do not go back.`);
  }
});

test('every CURRENT ribbon line clears 3:1 too - the other half of #816', () => {
  /* #806 left EMA20 at 2.11 and EMA50 at 2.33 on the light ground, flagged and
     deliberately unfixed because changing four ribbon colours nobody asked
     about was not that issue's ruling. #816 ruled them in. */
  const failures: string[] = [];
  for (const theme of ['dark', 'light'] as const) {
    for (const p of EMA_RIBBON_PERIODS) {
      const r = ratio(CURRENT_EMA_RAMP[theme][p], CHART_GROUND[theme]);
      if (r < GRAPHIC_MIN) failures.push(`current ${theme} EMA${p}: ${CURRENT_EMA_RAMP[theme][p]} = ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, []);
});

test('CONTROL: the values #816 replaced would still fail this', () => {
  /* Otherwise the assertion above passes on any palette and proves nothing
     about the change that was made. */
  assert.ok(ratio('#60a5fa', CHART_GROUND.light) < GRAPHIC_MIN, 'old EMA20 should still measure as failing');
  assert.ok(ratio('#f97316', CHART_GROUND.light) < GRAPHIC_MIN, 'old EMA50 should still measure as failing');
  assert.ok(ratio('#22d3ee', CHART_GROUND.light) < GRAPHIC_MIN, 'old gamma-flip cyan should still measure as failing');
  assert.ok(ratio('#34d399', CHART_GROUND.light) < GRAPHIC_MIN, 'old support green should still measure as failing');
});

/** Hue angle, 0-360. Two colours far apart here are tellable apart whatever
 *  their lightness does. */
function hue(hex: string): number {
  const [r, g, b] = parseCssColor(hex)!.rgb.map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; return h < 0 ? h + 360 : h;
}
/** Shortest angular distance, so 359° and 1° are 2° apart rather than 358°. */
function hueGap(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return d > 180 ? 360 - d : d;
}

test('no two lines in a ramp collapse into each other', () => {
  /* THE PROPERTY #806 WAS ACTUALLY ABOUT, and until now nothing asserted it.
     The existing guards check each colour against its GROUND, and each light
     value against its own dark twin's hue. Neither asks whether the four
     members of a ramp are still tellable apart FROM EACH OTHER - which is the
     complaint that opened #806 ("EMA9 and EMA200 are near-identical") and the
     thing #816's darkening moved without measuring. QA caught the gap
     reviewing #821 and measured it safe; this is the guard.

     TWO INSTRUMENTS, PICKED PER PAIR, and that choice is the whole test:

       different hue   ->  hue separation. A contrast ratio between a brown and
                           a blue reports 1.02 for colours anyone can tell
                           apart. #787 and #756 were both filed on exactly that.
       same hue        ->  contrast ratio. Two blues differing only in lightness
                           have no hue gap to measure, so lightness is the only
                           separator there is.

     A single instrument for both is how this goes wrong in either direction.

     THE FLOOR IS BELOW THE SHIPPING MINIMUM, not an aspiration. 1.4 sits under
     the tightest SAME-HUE pair that ships - the only kind the floor applies to
     - so this ratchets against collapse rather than triggering a redesign.

     That pair is TERMINAL DARK EMA9 vs EMA20 at 1.50. This comment said
     current-dark EMA20/EMA200 at 1.57 until QA rechecked it on #822; the 1.57
     pair is real but fourth-tightest, and quoting it overstates the headroom by
     70%. Anyone adjusting a terminal grey has 0.10 to spend, not 0.17.

     RE-DERIVE IT RATHER THAN TRUSTING THIS SENTENCE. It has been wrong once,
     for the same reason the trap preamble in qa/README.md was wrong twice: a
     number in prose that has to be recomputed by hand on every edit. The ramps
     are three lines above; the test below computes every pair. */
  const HUE_APART = 25;   // degrees; below this, treat the pair as same-hue
  const RATIO_MIN = 1.4;  // for same-hue pairs only

  const ramps: Array<[string, Record<number, string>]> = [
    ['terminal dark ', TERMINAL_EMA_RAMP.dark],
    ['terminal light', TERMINAL_EMA_RAMP.light],
    ['current dark  ', CURRENT_EMA_RAMP.dark],
    ['current light ', CURRENT_EMA_RAMP.light],
  ];

  const failures: string[] = [];
  for (const [name, ramp] of ramps) {
    for (let i = 0; i < EMA_RIBBON_PERIODS.length; i++) {
      for (let j = i + 1; j < EMA_RIBBON_PERIODS.length; j++) {
        const a = ramp[EMA_RIBBON_PERIODS[i]], b = ramp[EMA_RIBBON_PERIODS[j]];
        const gap = hueGap(a, b);
        if (gap >= HUE_APART) continue;          // different hues: distinguishable
        const r = ratio(a, b);
        if (r < RATIO_MIN) {
          failures.push(`${name} EMA${EMA_RIBBON_PERIODS[i]} ${a} vs EMA${EMA_RIBBON_PERIODS[j]} ${b}: ` +
                        `hue gap ${gap.toFixed(1)}deg, contrast ${r.toFixed(2)} - same hue and same lightness`);
        }
      }
    }
  }
  assert.deepEqual(failures, [],
    `${failures.length} ribbon pair(s) have collapsed into each other:\n  ${failures.join('\n  ')}\n` +
    'Two lines a user cannot tell apart are one line drawn twice.');
});

test('CONTROL: the separation check fails on the pair that opened #806', () => {
  /* Terminal dark before #812: EMA9 read through --amber (#fbbf24) and EMA200
     through --accent (#d9a626). Same hue family, 1.33 apart. If this passes,
     the test above cannot catch the thing it exists for. */
  const gap = hueGap('#fbbf24', '#d9a626');
  assert.ok(gap < 25, `the two golds should read as one hue, measured ${gap.toFixed(1)} degrees apart`);
  assert.ok(ratio('#fbbf24', '#d9a626') < 1.4, 'the two golds should still measure as collapsed');
  // And the instrument-choice half: a brown and a blue are trivially
  // distinguishable while their contrast ratio says 1.02.
  assert.ok(hueGap('#8F4508', '#0052CC') >= 25);
  assert.ok(ratio('#8F4508', '#0052CC') < 1.4,
    'the brown/blue pair should still trip a ratio-only check, which is why hue is consulted first');
});

test('every ramp covers exactly the periods the ribbon draws', () => {
  for (const ramp of [TERMINAL_EMA_RAMP.dark, TERMINAL_EMA_RAMP.light, CURRENT_EMA_RAMP.dark, CURRENT_EMA_RAMP.light]) {
    assert.deepEqual(Object.keys(ramp).map(Number).sort((a, b) => a - b), [...EMA_RIBBON_PERIODS].sort((a, b) => a - b));
  }
});

test('no colour in chartInk is a CSS variable', () => {
  /* The point of the file. A canvas keeps the previous colour when handed an
     unresolvable value, so a var() here paints whatever drew last and looks
     deliberate - which is exactly how EMA9 and EMA200 went green, then pink. */
  const src = readFileSync(path.join(ROOT, 'lib', 'chartInk.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  assert.equal(/var\(--/.test(code), false, 'a CSS variable reached lib/chartInk.ts');
});

test('the chart resolves the var() strings it still hands to klinecharts', () => {
  /* Two `var(--accent-2)` uses survive - the default overlay line in the
     palettes, and the RSI indicator - because they are klinecharts' own style
     shapes rather than ours. They are resolved at the call rather than removed.
     Asserted against the source: if someone drops the wrapper the colour goes
     back to leaking, and nothing on screen says so. */
  const chart = readFileSync(path.join(ROOT, 'components', 'KLineProChart.tsx'), 'utf8');
  const setStyles = [...chart.matchAll(/setStyles\(([^;]*?)\s+as any\)/g)].map(m => m[1]);
  assert.ok(setStyles.length >= 2, 'expected both setStyles call sites');
  for (const call of setStyles) {
    assert.ok(call.includes('resolveStyleVars('), `a setStyles call does not resolve its var()s: ${call.trim()}`);
  }
  assert.ok(/lines: \[\{ color: resolveCssColor\('var\(--accent-2\)'\)/.test(chart),
    "the RSI indicator's colour is no longer resolved");
});

test('CONTROL: the measurements can fail', () => {
  /* Every assertion above is a threshold. A ratio function returning something
     large for everything would satisfy all of them silently. */
  assert.ok(ratio('#ffffff', '#f87171') < TEXT_MIN, 'white on the S/R red should still measure as failing');
  assert.ok(ratio('#8b8f94', CHART_GROUND.light) < GRAPHIC_MIN, 'the old terminal grey should still fail on the light ground');
  assert.ok(ratio('#fbbf24', '#d9a626') < 1.4, 'the two golds #806 is about should still measure as too close');
  assert.equal(emaInk(9 as EmaPeriod, { terminal: true, dark: true }), TERMINAL_EMA_RAMP.dark[9]);
  assert.equal(emaInk(200 as EmaPeriod, { terminal: false, dark: false }), CURRENT_EMA_RAMP.light[200]);
});
