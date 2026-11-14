import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* Coverage for #2101 and #2106 - the Ask AI button (.gchat-fab) covering things it should clear.
 *
 * #2101: from 641 to 767px the bottom nav renders (`.tnav-tabs` at max-width 767) while the FAB's
 * nav clearance lived in `@media (max-width: 640px)`. That band had a 60px fixed nav and no
 * clearance, so the BOOK tab was ~30% covered - and because both elements are `position: fixed`,
 * it was the one overlap on #1185 that never cleared on scroll.
 *
 * #2106: the same button covered the /playbook favourite star, fixed with a right-hand gutter on
 * `.secret` from 641 to 1100px.
 *
 * A CSS ASSERTION IS THE RIGHT INSTRUMENT HERE, and its limit is worth stating rather than
 * implying. These cells prove the RULE EXISTS with the expected declaration. They do NOT prove the
 * overlap is gone - that is a rendered-geometry question, it needs a browser, and browser use is
 * on hold by the owner's instruction. PM measured the overlap percentages on the deployed build
 * (0% at 641, 700 and 767 in both themes) and owns the visual sign-off since the 2026-11-06
 * waiver; this file guards against the rule being deleted or its band narrowed, which is the part
 * a test can hold onto between releases.
 */

const CSS = readFileSync('app/globals.css', 'utf8');

/** The body of the first `@media <query> { ... }` block whose query matches, or null.
 *  Brace-counted rather than regex-matched to the first `}`, because a media block contains nested
 *  rules and a lazy match would stop at the first inner closing brace. */
function mediaBlock(css: string, query: string): string | null {
  const at = css.indexOf(`@media ${query}`);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

const FAB_QUERY    = '(min-width: 641px) and (max-width: 767px)';
/* #2228 (#1185): the star's gutter now applies from 641 UP, with no 1100 ceiling (the button is in the right column at every width). The trailing brace makes this the open-ended block, not the 641-767 band above it. */
const SECRET_QUERY = '(min-width: 641px) {';

test('C1. the FAB has nav clearance in the 641-767 band (#2101)', () => {
  const block = mediaBlock(CSS, FAB_QUERY);
  assert.notEqual(block, null,
    `the ${FAB_QUERY} media block is gone. That band is where .tnav-tabs renders a 60px fixed nav, `
    + 'so without it the Ask AI button sits on the nav tab again');
  assert.match(block!, /\.gchat-fab\s*\{[^}]*bottom:\s*64px\s*!important/,
    'the .gchat-fab bottom lift is missing from the 641-767 band. 64px is the smallest lift that '
    + 'clears the nav, and therefore the smallest graze of the card above it');
});

test('C2. the playbook star has a right gutter from 641 up, with no ceiling (#2106, #2228)', () => {
  const block = mediaBlock(CSS, SECRET_QUERY);
  assert.notEqual(block, null, `the ${SECRET_QUERY} media block is gone, so .secret loses its FAB gutter`);
  assert.match(block!, /\.secret\s*\{[^}]*padding-right:\s*70px/,
    'the .secret right-hand gutter is missing from the 641-and-up block, which is what keeps the Ask AI '
    + 'button off the favourite star on /playbook');
});

test('C3. CONTROL: both cells reject CSS without the rule, and the brace counter is not fooled', () => {
  /* Without this, "the rule is present" could equally mean "the matcher returns something for any
     input". Each half of the control has to fail where the real file passes. */
  const noRule = '@media (min-width: 641px) and (max-width: 767px) {\n  .something-else { color: red; }\n}';
  const block = mediaBlock(noRule, FAB_QUERY);
  assert.notEqual(block, null, 'the control fixture should still yield a block');
  assert.doesNotMatch(block!, /\.gchat-fab/,
    'CONTROL FAILED: C1 would pass on a media block that does not mention .gchat-fab');

  assert.equal(mediaBlock(noRule, '(min-width: 999px)'), null,
    'CONTROL FAILED: a query that is absent must yield null, or C1/C2 cannot detect a deleted block');

  /* The brace counter specifically: a lazy `[^}]*` match would stop at the first inner `}` and
     miss a rule that follows a nested block. This fixture has the target rule AFTER one. */
  const nested = '@media (min-width: 641px) and (max-width: 767px) {\n'
    + '  .a { color: red; }\n'
    + '  .gchat-fab { bottom: 64px !important; }\n}';
  const nestedBlock = mediaBlock(nested, FAB_QUERY);
  assert.match(nestedBlock!, /\.gchat-fab\s*\{[^}]*bottom:\s*64px\s*!important/,
    'CONTROL FAILED: the extractor stops at the first inner closing brace, so it would miss a rule '
    + 'placed after another rule in the same media block');
});
