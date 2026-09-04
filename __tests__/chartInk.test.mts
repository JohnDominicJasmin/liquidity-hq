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
  CHART_GROUND, TERMINAL_EMA_RAMP, CURRENT_EMA_RAMP, OVERLAY_LABEL_INK,
  EMA_RIBBON_PERIODS, emaInk, type EmaPeriod,
} from '../lib/chartInk.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ratio = (a: string, b: string) => contrastRatio(parseCssColor(a)!.rgb, parseCssColor(b)!.rgb);

const GRAPHIC_MIN = 3;    // SC 1.4.11
const TEXT_MIN    = 4.5;  // SC 1.4.3

test('every overlay label clears 4.5:1, which no rendered sweep can check', () => {
  const failures: string[] = [];
  for (const [name, { bg, text }] of Object.entries(OVERLAY_LABEL_INK)) {
    const r = ratio(text, bg);
    if (r < TEXT_MIN) failures.push(`${name}: ${text} on ${bg} = ${r.toFixed(2)}:1`);
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
    Object.entries(OVERLAY_LABEL_INK).map(([k, { bg, text }]) => [k, {
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
