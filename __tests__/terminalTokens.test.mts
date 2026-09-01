import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TERMINAL_COLORS, TERMINAL_FLAT_CELL } from '../lib/terminalTokens.ts';

/* Makes lib/terminalTokens.ts's claim true: that it is the single source of
   truth both app/globals.css and this test read from, and that the two
   cannot silently disagree.

   terminalTokens.ts's own header has claimed this test existed since #413.
   It didn't - #518 found that nothing imports the file and this file was
   never written, which is exactly how --bg1 and --txt3 drifted between
   globals.css and terminalTokens.ts without either side's tests failing
   (#526). Both were owner-amended on 2026-09-01; terminalTokens.ts carries
   the values of record now. This test is what stops the next one.

   Scope: TERMINAL_COLORS only. MAGMA_RAMP and TERMINAL_FLAT_CELL are read
   directly from lib/terminalTokens.ts by their one call site each
   (KLineProChart, the hours-expectancy grid) rather than restated in CSS
   custom properties, so there is no globals.css copy for them to drift
   against. */

const CSS = fs.readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

const BLOCK_SELECTOR = '[data-design="terminal"]:not([data-theme="light"]) {';

function terminalBlock(): string {
  const start = CSS.indexOf(BLOCK_SELECTOR);
  assert.ok(start >= 0, `${JSON.stringify(BLOCK_SELECTOR)} not found in globals.css - ` +
    'has the terminal root token block been renamed or removed?');
  const openBrace = start + BLOCK_SELECTOR.length - 1;
  let depth = 0;
  for (let i = openBrace; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}') {
      depth--;
      if (depth === 0) return CSS.slice(openBrace + 1, i);
    }
  }
  throw new Error('terminal root token block never closes - unbalanced braces in globals.css');
}

function cssValue(block: string, name: string): string | undefined {
  // Matches "--name: #hex;" - the declaration itself, not a var(--name) read.
  const m = block.match(new RegExp('(?:^|[\\s;{])' + name.replace(/[-[\]]/g, '\\$&') +
    ':\\s*(#[0-9a-fA-F]{6})\\s*;'));
  return m?.[1].toLowerCase();
}

test('terminal design tokens', async (t) => {
  const block = terminalBlock();

  for (const [name, expected] of Object.entries(TERMINAL_COLORS)) {
    await t.test(`${name} in globals.css matches lib/terminalTokens.ts`, () => {
      const shipped = cssValue(block, name);
      assert.ok(shipped,
        `${name} not found as a hex declaration in the terminal root token block`);
      assert.equal(shipped, expected.toLowerCase(),
        `${name}: globals.css has ${shipped}, lib/terminalTokens.ts (the file of record) has ${expected}`);
    });
  }

  await t.test('every TERMINAL_COLORS key is a real custom property name', () => {
    for (const name of Object.keys(TERMINAL_COLORS)) {
      assert.match(name, /^--[a-z][a-z0-9-]*$/,
        `${name} does not look like a CSS custom property`);
    }
  });

  await t.test('--flat-cell matches TERMINAL_FLAT_CELL', () => {
    // The 16th value: not in TERMINAL_COLORS by design (see that constant's
    // own comment) but still a colour this block declares, so still worth
    // pinning against drift.
    const shipped = cssValue(block, '--flat-cell');
    assert.ok(shipped, '--flat-cell not found as a hex declaration in the terminal root token block');
    assert.equal(shipped, TERMINAL_FLAT_CELL.toLowerCase());
  });

  await t.test('the block declares nothing outside the 15 documented tokens plus --flat-cell', () => {
    // Catches a token added to CSS and forgotten in terminalTokens.ts - the
    // mirror-image of the drift this file exists to prevent.
    const declared = [...block.matchAll(/(--[a-z][a-z0-9-]*):\s*#[0-9a-fA-F]{6}\s*;/g)]
      .map(m => m[1]);
    const known = new Set([...Object.keys(TERMINAL_COLORS), '--flat-cell']);
    const undocumented = declared.filter(name => !known.has(name));
    assert.deepEqual(undocumented, [],
      'hex-valued custom properties in the terminal block not listed in TERMINAL_COLORS - ' +
      'add them there (or to the radius/other exception if they are not a colour)');
  });
});
