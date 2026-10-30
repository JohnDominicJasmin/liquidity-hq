/* #1810 item 6 / #1824: A SURFACE THAT PRINTS THE TRADER'S LEGAL NAME MUST BE ABLE TO SEE WHETHER
 * THAT NAME IS CONFIRMED.
 *
 * WHAT HAPPENED, because this gate exists for one specific reason. `lib/traderIdentity.ts` ships
 * `TRADER_LEGAL_NAME = 'PLACEHOLDER - LEGAL NAME NOT YET CONFIRMED'` behind
 * `LEGAL_NAME_CONFIRMED = false`, and its header states the design: while the switch is false, every
 * surface that prints the name shows the gap rather than silently filling it with a wrong one.
 *
 * `/security` imported both and rendered the pending note. `/upgrade` imported the NAME ONLY. So the
 * checkout page read "Sold by PLACEHOLDER - LEGAL NAME NOT YET CONFIRMED, the Philippines" directly
 * above the buttons, with payments live, on a page the owner had already signed off - and the one
 * line whose entire job is trader-identity disclosure was the line saying PLACEHOLDER.
 *
 * The design was never in dispute. It was applied to one of two surfaces, and what found it was a
 * reviewer who happened to grep. THAT IS NOT A CONTROL. This is.
 *
 * IT ADAPTS WHEN THE NAME IS CONFIRMED rather than becoming dead weight. While the switch is false
 * the rule is "every printer imports the switch". Once it is true that import would be unused, so
 * the rule becomes "the placeholder string is gone" - which is the real risk at that point, since
 * flipping the switch without replacing the name would publish the placeholder with nothing marking
 * it. Neither state is vacuous. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_appPath.mts';
import { LEGAL_NAME_CONFIRMED, TRADER_LEGAL_NAME } from '../lib/traderIdentity.ts';

const NAME = 'TRADER_LEGAL_NAME';
const SWITCH = 'LEGAL_NAME_CONFIRMED';
/** The module that defines them is exempt: defining a thing is not printing it. */
const DEFINER = 'lib/traderIdentity.ts';

/* ══ THE PURE CORE, so the red path is proved here and not by editing app code ═══════════════════ */

/**
 * Files that read the legal name without also reading the confirmed switch.
 * A Map rather than the filesystem so it can be driven with fixtures.
 */
export function printersMissingGuard(sources: ReadonlyMap<string, string>): string[] {
  const missing: string[] = [];
  for (const [rel, src] of sources) {
    if (rel.replace(/\\/g, '/') === DEFINER) continue;
    if (!src.includes(NAME)) continue;
    if (!src.includes(SWITCH)) missing.push(rel);
  }
  return missing;
}

test('N1. CONTROL: the rule itself catches a missing guard and passes a present one', () => {
  const good = new Map([
    ['app/x/page.tsx', `import { LEGAL_NAME_CONFIRMED, TRADER_LEGAL_NAME } from '@/lib/traderIdentity';`],
  ]);
  const bad = new Map([
    ['app/y/page.tsx', `import { TRADER_COUNTRY, TRADER_LEGAL_NAME } from '@/lib/traderIdentity';`],
  ]);
  const unrelated = new Map([['app/z/page.tsx', `const greeting = 'hello';`]]);

  assert.deepEqual(printersMissingGuard(good), [], 'a file importing both must pass');
  assert.deepEqual(printersMissingGuard(bad), ['app/y/page.tsx'],
    'a file importing the name without the switch must be reported - this is the exact shape of the ' +
    '/upgrade defect, and if this assertion ever passes trivially the gate is measuring nothing');
  assert.deepEqual(printersMissingGuard(unrelated), [], 'a file mentioning neither must not be reported');
  assert.deepEqual(printersMissingGuard(new Map([[DEFINER, `export const ${NAME} = 'x';`]])), [],
    'the defining module is exempt');
});

/* ══ THE REAL TREE ══════════════════════════════════════════════════════════════════════════════ */

const SCAN_DIRS = ['app', 'components', 'lib'];
const CODE = /\.(ts|tsx|mts|js|jsx|mjs)$/;

function collect(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(path.join(ROOT, dir))) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const rel = `${dir}/${entry}`;
      if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel);
      else if (CODE.test(entry)) out.set(rel, readFileSync(path.join(ROOT, rel), 'utf8'));
    }
  };
  for (const d of SCAN_DIRS) walk(d);
  return out;
}

const SOURCES = collect();

test('N2. CONTROL: the scan found the tree and the surfaces that print the name', () => {
  assert.ok(SOURCES.size > 200,
    `only ${SOURCES.size} source files found under ${SCAN_DIRS.join(', ')} - the walk is not reaching ` +
    'the tree, so every result below would be a false pass');

  const printers = [...SOURCES].filter(([rel, src]) => rel !== DEFINER && src.includes(NAME)).map(([rel]) => rel);
  assert.ok(printers.length >= 2,
    `expected at least two surfaces printing ${NAME}, found ${printers.length} (${printers.join(', ') || 'none'}). ` +
    'Both /security and /upgrade print it. A zero or one here means the scan is broken or the pages ' +
    'were refactored - either way this gate is no longer watching what it was written for, and ' +
    '"no matches" is not evidence.');
});

test('N3. every surface that prints the legal name can also see whether it is confirmed', () => {
  const missing = printersMissingGuard(SOURCES);
  assert.deepEqual(
    missing, [],
    `these files read ${NAME} without reading ${SWITCH}: ${missing.join(', ')}.\n\n` +
    `While ${SWITCH} is false, ${NAME} is the literal string "${TRADER_LEGAL_NAME}". A surface that ` +
    'prints it without checking the switch publishes that placeholder with nothing marking it - which ' +
    'is what /upgrade did above the checkout buttons until #1824. Import the switch and render the ' +
    'pending note, as app/(main)/security/page.tsx does.',
  );
});

test('N4. the switch and the placeholder stay consistent with each other', () => {
  if (!LEGAL_NAME_CONFIRMED) {
    assert.match(
      TRADER_LEGAL_NAME, /PLACEHOLDER/,
      `${SWITCH} is false but ${NAME} does not announce itself as a placeholder. A name that looks ` +
      'real while the switch says it is not confirmed is the worst of both: reviewers approve it and ' +
      'the switch hides nothing.',
    );
    return;
  }
  /* The switch has been flipped. The import rule above is now satisfied trivially by whatever remains,
     so the live risk moves: flipping it without replacing the name would publish the placeholder as
     the trader's legal identity. */
  assert.doesNotMatch(
    TRADER_LEGAL_NAME, /PLACEHOLDER|NOT YET CONFIRMED/i,
    `${SWITCH} is true but ${NAME} is still "${TRADER_LEGAL_NAME}". The switch and the name must be ` +
    'changed in the SAME commit - lib/traderIdentity.ts says so - or every surface prints the ' +
    'placeholder as a confirmed legal name with no note beside it.',
  );
  assert.ok(
    TRADER_LEGAL_NAME.trim().length > 0,
    `${SWITCH} is true but ${NAME} is empty, so the disclosure names nobody`,
  );
});
