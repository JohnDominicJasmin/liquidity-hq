/* #2413: the usage rings each get their own readable colour. Computed from the TOKEN VALUES in app/globals.css (not sampled from a render), like the PR's own claim, so the claim is checkable and cannot rot.
 *   R1  six ring tokens in BOTH themes, all distinct (Deep, Chat and Search shared a gold in light, because --accent-2 equals --accent there)
 *   R2  each ring colour is at least 4.5:1 as a number on every ground a card can sit on (dark --bg1..--bg4; light white, --bg2, --bg3)
 *   R3  the track is visible on both grounds (it was white at 6%: invisible on light)
 *   R4  the component uses the tokens for every ring (no hard-coded colour), and the 70% amber / 90% red warning override still wins
 * WHAT IT CANNOT PROVE: how the banner wraps in Russian at 360 px (a browser run) or that the rings render. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ringsSrc = readFileSync(new URL('../components/UsageRings.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const IDS = ['quick', 'deep', 'chat', 'search', 'briefing', 'tools'];

/* the dark tokens live in the first :root block, the light ones in [data-theme="light"] { ... }; take the declaration nearest each theme's ring line */
function ringBlock(startMarker: string) {
  const a = css.indexOf(startMarker); assert.ok(a >= 0, `${startMarker} block not found`);
  const r = css.indexOf('--ring-quick', a); assert.ok(r > a, `no ring tokens after ${startMarker}`);
  return css.slice(a, css.indexOf('--ring-track', r) + 60);
}
const DARK = ringBlock(':root {'), LIGHT = ringBlock('[data-theme="light"] {');
const tok = (block: string, name: string) => { const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6}|rgba?\\([^)]*\\))`).exec(block); assert.ok(m, `--${name} missing`); return m[1]; };
const bgTok = (themeMarker: string, name: string) => {
  const a = css.indexOf(themeMarker); const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css.slice(a)); assert.ok(m, `--${name} missing under ${themeMarker}`); return m[1];
};
const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]: [number, number, number]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: [number, number, number], b: [number, number, number]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (rgbaStr: string, ground: [number, number, number]): [number, number, number] => {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(rgbaStr); assert.ok(m, rgbaStr);
  const a = Number(m[4]); return [0, 1, 2].map((i) => Math.round(Number(m[i + 1]) * a + ground[i] * (1 - a))) as [number, number, number];
};

const THEMES = [
  { name: 'dark', block: DARK, grounds: ['bg1', 'bg2', 'bg3', 'bg4'].map((n) => bgTok(':root {', n)) },
  { name: 'light', block: LIGHT, grounds: ['#FFFFFF', bgTok('[data-theme="light"] {', 'bg2'), bgTok('[data-theme="light"] {', 'bg3')] },
];

for (const th of THEMES) {
  test(`R1. ${th.name}: all six ring tokens exist and are distinct colours`, () => {
    const vals = IDS.map((id) => tok(th.block, `ring-${id}`).toLowerCase());
    assert.equal(new Set(vals).size, 6, `two rings share a colour in ${th.name}: ${vals.join(' ')}`);
  });
  test(`R2. ${th.name}: every ring colour is at least 4.5:1 as a number on every ground a card can sit on`, () => {
    for (const id of IDS) for (const g of th.grounds) {
      const r = ratio(rgb(tok(th.block, `ring-${id}`)), rgb(g));
      assert.ok(r >= 4.5, `${th.name} --ring-${id} on ${g}: ${r.toFixed(2)}:1 is under 4.5:1`);
    }
  });
  test(`R3. ${th.name}: the ring track is visible against the card (at least 1.15:1)`, () => {
    const track = tok(th.block, 'ring-track');
    for (const g of th.grounds) {
      const r = ratio(over(track, rgb(g)), rgb(g));
      assert.ok(r >= 1.15, `${th.name} track ${track} on ${g}: ${r.toFixed(2)}:1 is invisible`);
    }
  });
}

test('R4. UsageRings draws every ring from its own token (no hard-coded colour), the track from --ring-track, and 70% amber / 90% red still override', () => {
  for (const id of IDS) assert.ok(ringsSrc.includes(`color: 'var(--ring-${id})'`), `the ${id} ring is not on its own token`);
  assert.equal(/color:\s*'#[0-9a-fA-F]{3,6}'/.test(ringsSrc), false, 'a ring has a hard-coded colour again (the tools ring was #a78bfa: 2.2 to 2.7:1 on light)');
  assert.ok(ringsSrc.includes('stroke="var(--ring-track)"'), 'the track is not on --ring-track');
  assert.ok(ringsSrc.includes("pct >= 0.9 ? 'var(--red)' : pct >= 0.7 ? 'var(--amber)' : color"), 'the 90% red / 70% amber override changed');
});
