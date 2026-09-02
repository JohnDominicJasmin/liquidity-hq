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

  await t.test('the block declares nothing outside the 18 documented tokens plus --flat-cell', () => {
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

  await t.test('every custom property USED under [data-design="terminal"] is DECLARED in the terminal block', () => {
    // #559: the asymmetry that let --accent-bg/--accent-solid/--blue/--bg3/
    // --bg4 etc fall through ungoverned for months. The test above only ever
    // checked "does the block declare anything undocumented" - never the
    // opposite direction, "does everything a terminal-scoped rule USES
    // actually get declared here". A token can be perfectly correct by
    // inheritance (--purple: var(--accent) resolves via cascade even though
    // --purple itself is never redeclared in this block) so this check is
    // scoped to what terminal-scoped SELECTORS reference directly, not every
    // var() in the stylesheet - the same query QA specified.
    const declaredNames = new Set(
      [...block.matchAll(/(--[a-z][a-z0-9-]*)\s*:/g)].map(m => m[1])
    );

    // Tokens that are legitimately universal - not part of the colour
    // palette, so never redeclared per design mode (typography scale,
    // spacing scale, neumorphic shadows, structural sizing).
    const EXEMPT = new Set([
      '--font-mono', '--font-sans-terminal',
      '--fs-body', '--fs-caption', '--fs-card-title', '--fs-data',
      '--fs-display', '--fs-label', '--fs-micro', '--fs-page', '--fs-section',
      '--space-1', '--space-2', '--space-3', '--space-4', '--space-5',
      '--space-6', '--space-7', '--space-8',
      '--nm-btn', '--nm-inset', '--nm-raise', '--nm-raise-sm',
      /* Shell layout heights, the same category as --banner-h above and for
         the same reason: they are structural sizing, not colour, so the
         terminal token block is the wrong place to look for them. Both DO
         take a terminal-specific value - --appbar-h is 44px (38 below 768)
         against the current design's 52, and --strip-h is 34px against 0 -
         but that value is set on the [data-design="terminal"] block as a
         declaration, which is what this assertion skips, not as a colour.
         Added when #628 pinned .price-ticker-strip with
         top: calc(var(--appbar-h) + var(--banner-h)) and the check caught
         the first half of an expression whose second half it already
         exempted. */
      '--banner-h', '--appbar-h', '--strip-h',
    ]);

    const rulePattern = /\[data-design="terminal"\][^{]*\{([^}]*)\}/g;
    const missing = new Map<string, Set<string>>();
    for (const ruleMatch of CSS.matchAll(rulePattern)) {
      const selector = ruleMatch[0].slice(0, ruleMatch[0].indexOf('{')).trim();
      if (selector === BLOCK_SELECTOR.slice(0, -2)) continue; // the token block itself
      for (const varMatch of ruleMatch[1].matchAll(/var\((--[a-z][a-z0-9-]*)/g)) {
        const name = varMatch[1];
        if (declaredNames.has(name) || EXEMPT.has(name)) continue;
        if (!missing.has(name)) missing.set(name, new Set());
        missing.get(name)!.add(selector);
      }
    }

    assert.deepEqual([...missing.keys()], [],
      [...missing.entries()]
        .map(([name, selectors]) => `${name} used in [${[...selectors].join(', ')}] but not declared in the terminal token block`)
        .join('\n'));
  });
});
