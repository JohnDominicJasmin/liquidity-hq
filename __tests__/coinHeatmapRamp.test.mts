/* CoinHeatmap's red ramp, in every context and every bucket (#835).
 *
 * The tile is a TINT of `--red` over the context's own ground, and the text sat
 * on `--red-soft`. In both dark themes that is a light text on a dark tint and
 * measures 8-10:1. In both light themes `--red-soft` resolves to `var(--red)`,
 * so the text was the tint's own colour painted onto itself.
 *
 * QA found one failure by rendering: 4.17:1 on the -10% bucket in current+light.
 * Sweeping all four contexts found SIX:
 *
 *   current light   5.75  5.01  4.17  1.63
 *   terminal dark   4.91  4.44  3.81  8.66
 *   terminal light  5.94  5.15  4.30  1.98
 *   current dark   10.42  9.48  7.97  9.26     the one that was measured when the ramp was written
 *
 * THE 1.63 AND 1.98 ARE THE DEEPEST BUCKET and nobody saw them, because that
 * bucket only renders when a coin is down more than 10% — the board is live
 * data, so the worst case is also the rarest. A rendered audit measures the
 * market that happened to exist that minute.
 *
 * Reading the tokens out of globals.css rather than restating them, so a
 * palette change moves this assertion with it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compositeOver, contrastRatio, parseCssColor } from '../lib/readableOn.ts';
import { CONTEXTS, resolve } from './_cssContexts.mts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPONENT = readFileSync(path.join(ROOT, 'components', 'CoinHeatmap.tsx'), 'utf8');

const TEXT_MIN = 4.5;
const hex = (rgb: number[]) => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

/** The tint percentages the ramp uses, read from the component so a new bucket
 *  cannot be added without this test seeing it. */
function bucketsFromComponent(): Array<{ pct: number; token: string }> {
  const out: Array<{ pct: number; token: string }> = [];
  for (const m of COMPONENT.matchAll(/var\(--red\) (\d+)%, transparent\)',\s*text: 'var\((--[a-z-]+)\)'/g)) {
    out.push({ pct: Number(m[1]), token: m[2] });
  }
  return out;
}

test('the component still has four red buckets, each with a token colour', () => {
  /* If this drops to three, the sweep below silently stops covering one. A
     hardcoded hex would also fail here, which is what the deepest bucket had
     before this fix. */
  const buckets = bucketsFromComponent();
  assert.equal(buckets.length, 4, 'expected four red buckets reading token colours');
  assert.deepEqual(buckets.map(b => b.pct), [7, 15, 25, 38]);
});

test('every bucket clears 4.5:1 in all four contexts', () => {
  const failures: string[] = [];
  for (const [name, map] of CONTEXTS) {
    const ground = resolve(map, 'var(--bg1)');
    const red = resolve(map, 'var(--red)');
    assert.ok(ground && red, `${name}: could not resolve --bg1 or --red`);
    for (const { pct, token } of bucketsFromComponent()) {
      const fg = resolve(map, `var(${token})`);
      assert.ok(fg, `${name}: could not resolve ${token}`);
      const tile = hex(compositeOver(parseCssColor(red)!.rgb, parseCssColor(ground)!.rgb, pct / 100));
      const r = contrastRatio(parseCssColor(fg)!.rgb, parseCssColor(tile)!.rgb);
      if (r < TEXT_MIN) failures.push(`${name} ${pct}%: ${fg} on ${tile} = ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [],
    `${failures.length} heatmap bucket(s) below ${TEXT_MIN}:1:\n  ${failures.join('\n  ')}\n` +
    'The tile is a tint of --red over the context ground, so a text colour that ' +
    'works in dark can be the tint\'s own colour in light.');
});

test('the ramp text is not --red-soft any more, in either direction', () => {
  /* --red-soft is `var(--red)` in three of the four contexts, so using it as
     the ramp's foreground is the bug rather than a value that happened to be
     wrong. Named so a future edit does not reach for it again. */
  assert.equal(/text: 'var\(--red-soft\)'/.test(COMPONENT), false,
    'the ramp reads --red-soft again - in the light themes that resolves to --red, the tint\'s own colour');
  assert.equal(/text: '#[0-9a-fA-F]{3,6}'/.test(COMPONENT), false,
    'a bucket has a hardcoded hex - it cannot follow the theme, which is how the deepest bucket reached 1.63:1');
});

test('CONTROL: the old values still measure as failing', () => {
  /* Without this the sweep passes on any palette. These are the four worst
     readings from before the fix, recomputed from first principles. */
  const bad = (ground: string, red: string, pct: number, fg: string) => {
    const tile = hex(compositeOver(parseCssColor(red)!.rgb, parseCssColor(ground)!.rgb, pct / 100));
    return contrastRatio(parseCssColor(fg)!.rgb, parseCssColor(tile)!.rgb);
  };
  assert.ok(bad('#FFFFFF', '#B91C1C', 25, '#B91C1C') < TEXT_MIN, 'current light -10% should still fail');
  assert.ok(bad('#FFFFFF', '#B91C1C', 38, '#fee2e2') < TEXT_MIN, 'current light worst bucket should still fail');
  assert.ok(bad('#141517', '#f0524d', 25, '#f0524d') < TEXT_MIN, 'terminal dark -10% should still fail');
  assert.ok(bad('#ebe9e6', '#9d1a23', 38, '#fee2e2') < TEXT_MIN, 'terminal light worst bucket should still fail');
});
