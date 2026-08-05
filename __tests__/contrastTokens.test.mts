import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/* Guards the design tokens against WCAG 2.2 SC 1.4.3 (AA, 4.5:1 for normal
   text) without needing a browser.

   This exists because the previous --txt3 fix was verified against --bg1/--bg2
   only and shipped at 4.46:1 on --bg4 and 4.32:1 on #191b1e - two surfaces
   nobody thought to check. A colour that "passes" is a claim about a specific
   pair, and the only way to keep that claim true as surfaces are added is to
   assert every pair. Parsing the values out of globals.css rather than
   duplicating them here means editing a token re-runs the check.

   Not covered here, deliberately: anything blended at runtime (opacity,
   color-mix) or painted over a gradient/image. Those need a real renderer -
   axe against the running app - and were the source of most of the failures
   this test is the aftermath of. Passing this file is necessary, not
   sufficient. */

const CSS = fs.readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

function token(name: string, scope?: string): string {
  const haystack = scope
    ? CSS.slice(CSS.indexOf(scope), CSS.indexOf(scope) + 1200)
    : CSS;
  const m = haystack.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'));
  assert.ok(m, `token --${name} not found${scope ? ' in ' + scope : ''}`);
  return m![1].toLowerCase();
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const c = [1, 3, 5].map(i => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function ratio(fg: string, bg: string): number {
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const AA = 4.5;

/* The declared surface tokens. Every text token must clear AA on all of them,
   because any of them can host any text tier. */
const SURFACES: Record<string, string> = {
  '--bg0': token('bg0'),
  '--bg1': token('bg1'),
  '--bg2': token('bg2'),
  '--bg3': token('bg3'),
  '--bg4': token('bg4'),
};

/* Surfaces that are NOT tokens - one-off card backgrounds found by running axe
   against the built app. Only asserted for the tokens actually observed on
   them, because that is all the measurement established.
   Known gap, recorded rather than papered over: --txt2 is 4.31:1 on #191b1e.
   Nothing renders --txt2 there today, so it is not a live defect, but moving
   any secondary text onto that card would create one. Fixing it means
   relightening --txt2 app-wide, which is a visible typography change and the
   owner's call - not something to slip into a contrast pass. If that surface
   ever gains secondary text, raise --txt2 to >= #7e8298 and add it below. */
const MEASURED_PAIRS: { surface: string; tokens: string[] }[] = [
  { surface: '#191b1e', tokens: ['txt', 'txt3', 'txt-dim'] },
];

test('design token contrast', async (t) => {
  await t.test('sanity: the ratio maths matches known WCAG values', () => {
    assert.equal(Math.round(ratio('#ffffff', '#000000')), 21);
    assert.equal(Math.round(ratio('#000000', '#000000')), 1);
    // The brand blue pair this branch deliberately leaves failing.
    assert.ok(Math.abs(ratio('#ffffff', '#1a7aff') - 3.98) < 0.02,
      'white on --accent should still measure ~3.98:1');
  });

  for (const name of ['txt', 'txt2', 'txt3', 'txt-dim']) {
    const fg = token(name);
    await t.test(`--${name} (${fg}) clears AA on every app surface`, () => {
      for (const [surface, bg] of Object.entries(SURFACES)) {
        const r = ratio(fg, bg);
        assert.ok(r >= AA,
          `--${name} ${fg} on ${surface} ${bg} = ${r.toFixed(2)}:1, needs ${AA}:1`);
      }
    });
  }

  await t.test('tokens clear AA on the measured non-token card surfaces', () => {
    for (const { surface, tokens } of MEASURED_PAIRS) {
      for (const name of tokens) {
        const fg = token(name);
        const r = ratio(fg, surface);
        assert.ok(r >= AA, `--${name} ${fg} on ${surface} = ${r.toFixed(2)}:1`);
      }
    }
  });

  await t.test('.lp-root overrides also clear AA on the landing surfaces', () => {
    /* .lp-root re-declares the palette to force dark mode regardless of the
       saved theme, which is how it silently reverted the :root AA fix for the
       first page every visitor sees. */
    const fg = token('txt3', '.lp-root {');
    for (const bg of ['#050505', '#0e0e12', '#0a0c10']) {
      const r = ratio(fg, bg);
      assert.ok(r >= AA, `.lp-root --txt3 ${fg} on ${bg} = ${r.toFixed(2)}:1`);
    }
  });

  await t.test('--txt-dim is the neutral it claims to be, not a tinted grey', () => {
    const v = token('txt-dim');
    assert.equal(v.slice(1, 3), v.slice(3, 5), 'r and g should match');
    assert.equal(v.slice(3, 5), v.slice(5, 7), 'g and b should match');
  });
});
