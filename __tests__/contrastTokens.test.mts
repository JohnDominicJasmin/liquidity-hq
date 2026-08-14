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

/** Flatten `fg` at `alpha` over `bg` - what a tinted background actually is by
 *  the time text sits on it. Without this the test compares against a colour
 *  no pixel ever has. */
function composite(fg: string, alpha: number, bg: string): string {
  const h = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const [fr, fg_, fb] = h(fg), [br, bg_, bb] = h(bg);
  const mix = (f: number, b: number) => Math.round(f * alpha + b * (1 - alpha));
  return '#' + [mix(fr, br), mix(fg_, bg_), mix(fb, bb)]
    .map(v => v.toString(16).padStart(2, '0')).join('');
}

function token(name: string, scope?: string): string {
  /* 3000, not 1200: the light-theme token block is ~34 lines long and --accent
     sits past the old window, so a scoped lookup silently found nothing and
     reported "token not found" rather than the wrong value. Widened when the
     gold primary landed (#419). */
  const haystack = scope
    ? CSS.slice(CSS.indexOf(scope), CSS.indexOf(scope) + 3000)
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
   against the built app.
   #14161a is the .csb2-sig chip: 2% white over --bg3. It used to be 4% white,
   which computed to #191b1e and left --txt2 at 4.31:1 and --txt3 at 4.32:1 -
   the only surface in the app where the muted tokens fell short.
   That was recorded here as a known gap rather than fixed, on the reasoning
   that clearing it meant relightening --txt2 across all 215 of its call sites.
   Wrong framing: halving one overlay fixes the same pair and moves nothing
   else. Owner picked that when it was put as a choice rather than a mechanism.
   ALL FOUR text tokens are now asserted against it, --txt2 included, so the
   overlay cannot drift back up without failing here. */
const MEASURED_PAIRS: { surface: string; tokens: string[] }[] = [
  { surface: '#14161a', tokens: ['txt', 'txt2', 'txt3', 'txt-dim'] },
];

test('design token contrast', async (t) => {
  await t.test('sanity: the ratio maths matches known WCAG values', () => {
    assert.equal(Math.round(ratio('#ffffff', '#000000')), 21);
    assert.equal(Math.round(ratio('#000000', '#000000')), 1);
    // The pair that forced --accent-solid to exist when the primary was blue.
    // Kept as a maths check even though the blue is gone (#419) - it is a known
    // published value, which is what makes it a useful sanity assertion.
    assert.ok(Math.abs(ratio('#ffffff', '#1a7aff') - 3.98) < 0.02,
      'white on the old brand blue should still measure ~3.98:1');
  });

  await t.test('the accent works AS TEXT, and its fill carries --on-accent', () => {
    /* REWRITTEN FOR THE GOLD PRIMARY (#419). The old version asserted that
       WHITE on --accent-solid clears AA - true of the blue, false of the gold
       at 2.23:1. That assertion failing is what caught the swap, which is
       exactly what it was for.
       The invariant changed shape rather than disappearing. Blue needed two
       VALUES (a darker fill for white text, a brighter one for text). Gold
       needs two FOREGROUNDS (near-black on the dark fill, white on the light
       one) and one value. So the pairing is what gets asserted now. */
    const accent = token('accent');
    const onAccent = token('on-accent');

    for (const [surface, bg] of Object.entries(SURFACES)) {
      const r = ratio(accent, bg);
      assert.ok(r >= AA,
        `--accent ${accent} as TEXT on ${surface} ${bg} = ${r.toFixed(2)}:1`);
    }

    const onFill = ratio(onAccent, accent);
    assert.ok(onFill >= AA,
      `--on-accent ${onAccent} on --accent ${accent} = ${onFill.toFixed(2)}:1, needs ${AA}:1`);

    /* The trap, restated: white must NOT be assumed safe on the accent. If
       this ever passes, the accent has drifted pale enough that every
       `color: #fff` still sitting on a gold fill would silently start working
       - and the ones that are wrong would stop being detectable. */
    assert.ok(ratio('#ffffff', accent) < AA,
      'white now passes on --accent - re-check every fill that sets its own #fff');
  });

  await t.test('LIGHT theme: the gold inverts its foreground and still clears AA', () => {
    /* The half that nearly shipped broken. #d9a626 on white is 2.23:1, so the
       light theme needs a darker gold - and then near-black on THAT is 3.63:1,
       so its foreground has to flip to white. Both directions, measured. */
    const accent = token('accent', '[data-theme="light"] {');
    const onAccent = token('on-accent', '[data-theme="light"] {');

    /* GROUNDS x TINTS, not a list of flat colours.
     *
     * This test has now been wrong twice in the same way, and each time the
     * fix was "add another ground" - which is why the third version stops
     * enumerating and starts composing.
     *
     *   v1  white + --bg2                shipped 4.18:1 on #e1e1de
     *   v2  + #e1e1de                    shipped 3.98:1 on #e1e1de + a 12% tint
     *   v3  every ground x every tint    <- here
     *
     * The tint matters because the app's selected state puts accent TEXT on an
     * accent-tinted BACKGROUND (.nav-tile.on, .gchat-coin.on). Blue had the
     * headroom for that; gold does not, and a flat-ground test cannot see it.
     * QA's rendered sweep found both misses - this is the unit-test half
     * catching up to what the sweep already knows. */
    const GROUNDS = ['#ffffff', '#f2f3f5', '#e1e1de', '#e8eaed'];
    const TINTS: Array<[string, number]> = [['plain', 0], ['accent-bg', 0.07], ['accent-dim', 0.12]];
    for (const bg of GROUNDS) {
      for (const [name, alpha] of TINTS) {
        const ground = alpha === 0 ? bg : composite(accent, alpha, bg);
        const r = ratio(accent, ground);
        assert.ok(r >= AA,
          `light --accent ${accent} on ${bg} + ${name} = ${r.toFixed(2)}:1, needs ${AA}:1`);
      }
    }

    const onFill = ratio(onAccent, accent);
    assert.ok(onFill >= AA,
      `light --on-accent ${onAccent} on ${accent} = ${onFill.toFixed(2)}:1, needs ${AA}:1`);
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
