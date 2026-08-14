/* #413 - the Monochrome Terminal tokens exist in two places and must not drift.
 *
 * app/globals.css carries them so the browser can use them; lib/terminalTokens.ts
 * carries them so a test can read them. Two copies of fifteen hex strings is a
 * drift machine, and the drift would be INVISIBLE - each file looks correct on
 * its own, and the only symptom is a conformance spec that passes against a
 * stylesheet it no longer describes.
 *
 * This is the positive control for that: it reads the actual CSS text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TERMINAL_COLORS, TERMINAL_FLAT_CELL, MAGMA_RAMP, TERMINAL_ALLOWED,
} from '../lib/terminalTokens.ts';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

/** The [data-design="terminal"] block, isolated - not the whole stylesheet. */
function terminalBlock(): string {
  const start = css.indexOf('[data-design="terminal"]');
  assert.notEqual(start, -1, 'the terminal token block is missing from globals.css');
  const end = css.indexOf('}', start);
  assert.notEqual(end, -1, 'the terminal token block is not closed');
  return css.slice(start, end);
}

/* ── 1. the two copies agree ─────────────────────────────────────────────── */

test('every token in lib/ is declared in the CSS block with the same value', () => {
  const block = terminalBlock();
  for (const [name, value] of Object.entries(TERMINAL_COLORS)) {
    const re = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`);
    const m = block.match(re);
    assert.ok(m, `${name} is missing from the [data-design="terminal"] block`);
    assert.equal(m![1].toLowerCase(), value.toLowerCase(),
      `${name} disagrees: lib says ${value}, CSS says ${m![1]}`);
  }
});

test('the FLAT cell is declared too, and is NOT equal to --mark-idle', () => {
  const block = terminalBlock();
  const m = block.match(/--flat-cell\s*:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(m, '--flat-cell missing');
  assert.equal(m![1].toLowerCase(), TERMINAL_FLAT_CELL);
  // They both mean "not firing" and they are different values. If a future
  // edit collapses them, that should be a deliberate act with this test in
  // front of it - see the note on TERMINAL_FLAT_CELL.
  assert.notEqual(TERMINAL_FLAT_CELL, TERMINAL_COLORS['--mark-idle']);
});

/* ── 2. the block does not quietly grow ──────────────────────────────────── */

test('the CSS block declares EXACTLY the documented tokens and nothing else', () => {
  const declared = [...terminalBlock().matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]);
  const expected = [...Object.keys(TERMINAL_COLORS), '--flat-cell'].sort();
  assert.deepEqual([...declared].sort(), expected,
    'the terminal block gained or lost a token - 15 documented + 1 undocumented is the whole set');
});

/* ── 3. the values themselves ────────────────────────────────────────────── */

test('the accent is amber and there is exactly one of it', () => {
  // The design's premise is a single accent. If a second saturated hue ever
  // appears in this table, the premise is gone and it should be argued for
  // rather than merged.
  assert.equal(TERMINAL_COLORS['--accent'], '#d9a626');
});

test('the magma ramp runs 0 to 1 with ascending stops', () => {
  assert.equal(MAGMA_RAMP[0].stop, 0);
  assert.equal(MAGMA_RAMP[MAGMA_RAMP.length - 1].stop, 1);
  for (let i = 1; i < MAGMA_RAMP.length; i++) {
    assert.ok(MAGMA_RAMP[i].stop > MAGMA_RAMP[i - 1].stop,
      `stop ${i} does not ascend`);
  }
});

/* ── 4. control ──────────────────────────────────────────────────────────── */

test('CONTROL: the allowlist rejects a colour the design does not use', () => {
  // Without this, a conformance spec built on TERMINAL_ALLOWED could be
  // permitting everything and still look like it was working.
  assert.ok(TERMINAL_ALLOWED.includes('#d9a626'), 'the accent must be allowed');
  assert.ok(!TERMINAL_ALLOWED.includes('#f7931a'), 'the old BTC badge hue must NOT be allowed');
  assert.ok(!TERMINAL_ALLOWED.includes('#38b6c4'), 'the props-panel cyan must NOT be allowed');
  assert.equal(TERMINAL_ALLOWED.length, 15 + 1 + 7, 'allowlist size changed unexpectedly');
});
