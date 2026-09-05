/* The per-coin badge dots are visible in every theme (#756).
 *
 * WHAT SHIPPED. lib/coinBadge.ts hashed a coin id onto twelve fixed hexes, so
 * the dots did not follow the theme. Against the light cards they measured
 * 1.28 to 3.46 as GRAPHICS - ten of twelve below the 3:1 bar.
 *
 * NOT A 1.4.11 VIOLATION, AND THAT IS WHY IT NEEDED A RULING RATHER THAN A
 * FIX. SC 1.4.11 covers graphics required to understand content; the ticker is
 * spelled out beside every dot, so the colour is redundant encoding and the
 * exemption applies. QA ruled on the other ground: an invisible dot is
 * pointless rather than compliant. #734's "keep the dot, make the text plain"
 * left decoration that does not decorate, and BADGE_PALETTE's own comment asks
 * for "a stable, varied hue so each row gets a recognizable dot".
 *
 * So the bar here is 3:1 by choice, not by obligation. Worth stating, because
 * a future reader who checks only the standard will conclude this file is
 * over-strict and relax it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCssColor, contrastRatio, type Rgb } from '../lib/readableOn.ts';
import { coinBadgeColor, BADGE_SLOTS } from '../lib/coinBadge.ts';

/* Coin ids inline rather than imported from lib/marketStore.ts. That module
   imports './coins' without a file extension, which Node's ESM resolver
   rejects, so importing it here fails the whole file - which is why no test in
   this directory imports it. The ids below are a sample; the property under
   test is "any id maps to a slot", not "these particular coins exist". */
const SAMPLE_IDS = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'hype', 'near', 'sui',
                    'avax', 'link', 'doge', 'pepe', 'wif', 'bonk', 'xau', 'spx'];

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8');

const TARGET = 3.0;

function tokens(selector: string): Record<string, string> {
  const lines = CSS.split('\n');
  const idx = lines.findIndex(l => l.trim() === selector + ' {');
  assert.ok(idx >= 0, `token block not found: ${selector}`);
  const from = lines.slice(0, idx).join('\n').length;
  let i = CSS.indexOf('{', from), depth = 0, end = i;
  for (; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = CSS.slice(CSS.indexOf('{', from) + 1, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;\n]+)/g)) {
    out[m[1]] = m[2].split('/*')[0].trim().replace(/;$/, '');
  }
  return out;
}
function resolve(map: Record<string, string>, value: string, depth = 0): string | null {
  if (depth > 10) return null;
  const m = /^var\((--[a-z0-9-]+)(?:\s*,\s*([^)]+))?\)$/.exec(value.trim());
  if (!m) return value.trim();
  const next = map[m[1]] ?? m[2];
  return next === undefined ? null : resolve(map, next, depth + 1);
}

const root = tokens(':root');
const light = tokens('[data-theme="light"]');
const termDark = tokens('[data-design="terminal"]:not([data-theme="light"])');
const termLight = tokens('[data-design="terminal"][data-theme="light"]');
const CONTEXTS: Array<[string, Record<string, string>]> = [
  ['current dark', { ...root }],
  ['current light', { ...root, ...light }],
  ['terminal dark', { ...root, ...termDark }],
  ['terminal light', { ...root, ...light, ...termLight }],
];

/* The card surfaces a dot lands on. TradeJournal's dots and CoinIcon's
   fallback both sit inside cards, which are --bg1 or --bg2 depending on the
   screen; both are checked and the worse has to pass. */
const GROUNDS = ['--bg1', '--bg2'];
const SLOTS = Array.from({ length: BADGE_SLOTS }, (_, i) => `var(--badge-${i})`);

test('all twelve slots are declared in every context', () => {
  const missing: string[] = [];
  for (const [name, map] of CONTEXTS) {
    for (const slot of SLOTS) {
      const raw = resolve(map, slot);
      if (!raw || !parseCssColor(raw)) missing.push(`${name}: ${slot}`);
    }
  }
  assert.deepEqual(missing, [], `badge slot(s) that do not resolve:\n  ${missing.join('\n  ')}`);
});

test('every badge slot clears 3:1 on both card grounds, all four contexts', () => {
  const failures: string[] = [];
  for (const [name, map] of CONTEXTS) {
    for (const slot of SLOTS) {
      const fg = parseCssColor(resolve(map, slot) ?? '')!;
      for (const g of GROUNDS) {
        const bg = parseCssColor(resolve(map, `var(${g})`) ?? '')!;
        const c = contrastRatio(fg.rgb, bg.rgb);
        if (c < TARGET) failures.push(`${name} ${slot} on ${g} -> ${c.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(failures, [],
    `${failures.length} slot/ground pair(s) below ${TARGET}:\n  ${failures.join('\n  ')}`);
});

test('darkening did not collapse the palette toward itself', () => {
  /* THE BAR IS THE DARK PALETTE, NOT A NUMBER I CHOSE.
     My first version asserted a 12-degree floor between every pair and it
     failed on the UNTOUCHED dark palette - slots 0, 4 and 8 (#f7931a, #f3ba2f,
     #fbbf24) sit 10 degrees apart and have shipped that way for months. A
     check that fails on the baseline is measuring a property the design never
     promised, which is the mistake I made on #787's distinctness check and
     made again here.
     The property that IS promised: darkening twelve colours until they clear a
     contrast bar must not push any pair closer together than it already was.
     So each light pair is compared against its own dark separation. */
  const hue = ([r, g, b]: Rgb): number => {
    const R = r / 255, G = g / 255, B = b / 255;
    const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
    if (d === 0) return 0;
    const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const sepIn = (map: Record<string, string>, i: number, j: number) => {
    const a = hue(parseCssColor(resolve(map, SLOTS[i]) ?? '')!.rgb);
    const b = hue(parseCssColor(resolve(map, SLOTS[j]) ?? '')!.rgb);
    const raw = Math.abs(a - b);
    return Math.min(raw, 360 - raw);
  };
  const dark = { ...root };
  const failures: string[] = [];
  for (const [name, map] of CONTEXTS.filter(([n]) => n.includes('light'))) {
    for (let i = 0; i < SLOTS.length; i++) {
      for (let j = i + 1; j < SLOTS.length; j++) {
        const before = sepIn(dark, i, j);
        const after = sepIn(map, i, j);
        if (after < before - 1) {
          failures.push(`${name}: slots ${i}/${j} went ${before.toFixed(0)} -> ${after.toFixed(0)} degrees`);
        }
      }
    }
  }
  assert.deepEqual(failures, [],
    'the light palette is less distinguishable than the dark one:\n  ' + failures.join('\n  '));
});

test('a coin keeps its hue across themes', () => {
  /* The light values are the dark ones darkened, not a second palette. If a
     coin changed hue between themes the dot would stop being an identity cue,
     which is the only job it has. */
  const drift: string[] = [];
  const hueOf = (map: Record<string, string>, slot: string) => {
    const [r, g, b] = parseCssColor(resolve(map, slot) ?? '')!.rgb;
    const R = r / 255, G = g / 255, B = b / 255;
    const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
    if (d === 0) return 0;
    const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    return (h * 60 + 360) % 360;
  };
  for (const slot of SLOTS) {
    const a = hueOf({ ...root }, slot);
    const b = hueOf({ ...root, ...light }, slot);
    const raw = Math.abs(a - b);
    const sep = Math.min(raw, 360 - raw);
    if (sep > 6) drift.push(`${slot}: ${a.toFixed(0)} dark vs ${b.toFixed(0)} light`);
  }
  assert.deepEqual(drift, [], `badge hue drifts between themes:\n  ${drift.join('\n  ')}`);
});

test('coinBadgeColor returns a slot token, and every coin maps to one', () => {
  for (const c of SAMPLE_IDS) {
    const v = coinBadgeColor(c);
    assert.match(v, /^var\(--badge-(\d|1[01])\)$/, `${c} -> ${v}`);
  }
  /* The hash is stable: the same id must not move slots between runs, or a
     coin's dot changes colour on reload. */
  assert.equal(coinBadgeColor('btc'), coinBadgeColor('btc'));
});

test('CONTROL: the literals this replaced really do fail the light grounds', () => {
  /* Without this the sweep proves only that it ran. These are the twelve hexes
     that shipped; ten of them must still fail, or the light values are not
     load-bearing and this file should be revisited rather than kept. */
  const SHIPPED = ['#f7931a', '#627eea', '#9945ff', '#00aae4', '#f3ba2f', '#00c08b',
                   '#f87171', '#4ade80', '#fbbf24', '#60a5fa', '#f472b6', '#2dd4bf'];
  const lightMaps = CONTEXTS.filter(([n]) => n.includes('light'));
  let failing = 0;
  for (const hex of SHIPPED) {
    const c = parseCssColor(hex)!;
    const worst = Math.min(...lightMaps.flatMap(([, map]) =>
      GROUNDS.map(g => contrastRatio(c.rgb, parseCssColor(resolve(map, `var(${g})`) ?? '')!.rgb))));
    if (worst < TARGET) failing++;
  }
  assert.ok(failing >= 10,
    `expected at least 10 of the 12 shipped hexes to fail the light grounds; ${failing} did`);
});
