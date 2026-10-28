import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CANDIDATES, candidateValues } from '@/qa/labelCandidates';
import { LABEL_KEYS } from '@/lib/labelKeys';

/* OWNER-RULES §7 (owner, 2026-10-28), ENFORCED IN THE GATE INSTEAD OF REMEMBERED.
 *
 * Label copy lives in the database, so a wording change reaches the live site with no build, no tests and no
 * staging. The owner approves the text; the render is ours. He chose an automatic check over eyeballing it
 * BECAUSE a standing rule to check `text-transform` before approving a label with units already existed and
 * was not followed.
 *
 * The rule as first written said: add a target to QA's phone-width spec and run it. That is the same
 * omission moved one step - running the spec was never compliance, because the target list was hardcoded, so
 * an unlisted label was measured by nobody AND THE RUN WENT GREEN. Six values injected, five measured, which
 * is #1771.
 *
 * `qa/labelCandidates.ts` makes that unrepresentable by requiring `path` and `note` on every candidate. This
 * file enforces what a type cannot: that the key is real, that the change is one the rule actually covers,
 * and that the route exists. It runs in `npm test`, so it runs in the pre-push gate - an omission now FAILS
 * rather than passes, which is the owner's principle applied to the compliance step itself.
 *
 * L8 IS THE LOAD-BEARING ONE. Every predicate below is re-run against a deliberately broken list, because a
 * validator that cannot fail is indistinguishable from one that always passes - and a green suite is exactly
 * what the old shape produced. */

/* The predicates, named once and used twice: on the real list, and on the broken one in L8. Extracting them
   is the only way the control tests the SAME logic rather than a second implementation of it. */
const isRegisteredKey = (c: { key: string }) => (LABEL_KEYS as readonly string[]).includes(c.key);
const changesTheText = (c: { now: string; was: string }) => c.now !== c.was;
const getsLonger = (c: { now: string; was: string }) => c.now.length > c.was.length;
/* §7 has TWO triggers - longer, or a fixed-width container - so requiring "longer" alone would REJECT a
   same-length label moving into a 40px track, and the author's cheapest exit would be to delete the
   candidate. The fixed-width half is an explicit opt-in rather than a silent exception, so the flag has to
   be written down and is visible in review. */
const ruleApplies = (c: { now: string; was: string; coversFixedWidth?: boolean }) =>
  getsLonger(c) || c.coversFixedWidth === true;
const hasNote = (c: { note: string }) => typeof c.note === 'string' && c.note.trim().length > 10;
const routeExists = (c: { path: string }) => {
  if (!c.path.startsWith('/')) return false;
  const seg = c.path.replace(/^\//, '');
  const base = process.cwd();
  /* `/` is app/page.tsx; `/x` is app/x/page.tsx. Both extensions, because the repo mixes them. */
  const candidates = seg === ''
    ? ['app/page.tsx', 'app/page.jsx']
    : [`app/${seg}/page.tsx`, `app/${seg}/page.jsx`];
  return candidates.some((p) => existsSync(join(base, p)));
};
const KNOWN_OPENERS = ['scannerFlyout'];
const openerKnown = (c: { opener?: string }) => c.opener === undefined || KNOWN_OPENERS.includes(c.opener);

test('L1: every candidate key is a REGISTERED label key', () => {
  /* The type says `LabelKey`, so this is the belt to that brace - but it is not redundant, and the mechanism
     is what makes it worth a test. `installLabelOverride` writes `labels[k] = v` into the real /api/labels
     payload. A key nothing reads means the page renders the ORIGINAL string, the cell measures that, and it
     PASSES while its own log line reports the new text. A vacuous pass that reads exactly like a real one. */
  for (const c of CANDIDATES) {
    assert.ok(isRegisteredKey(c),
      `${c.key} is not in lib/labelKeys.ts - the override would write a key nothing reads, and the cell `
      + 'would measure the OLD string while reporting the new one');
  }
});

test('L2: no key appears twice', () => {
  /* Two entries for one key means one of them is never measured - the last write to `candidateValues()`
     wins and the other cell silently measures its sibling's string. */
  const seen = new Set<string>();
  for (const c of CANDIDATES) {
    assert.ok(!seen.has(c.key), `${c.key} appears more than once`);
    seen.add(c.key);
  }
});

test('L3: every candidate changes the text, and is one §7 actually covers', () => {
  /* §7 scopes the rule to a change that is LONGER than the old value, or lands in a FIXED-WIDTH container.
     A change that only shortens a string cannot clip, so a shorter candidate with no fixed-width claim is
     either a mistake or a pair of values entered the wrong way round - and the second is the dangerous one,
     because the cell would then inject the OLD string and report it as the new. */
  for (const c of CANDIDATES) {
    assert.ok(changesTheText(c), `${c.key}: now and was are identical, so this cell measures nothing`);
    assert.ok(ruleApplies(c),
      `${c.key}: "${c.now}" (${c.now.length}) is not longer than "${c.was}" (${c.was.length}) and does not `
      + 'set coversFixedWidth - either the values are swapped, or this change cannot clip. If it DOES sit in '
      + 'a fixed-width container, set the flag rather than removing the candidate');
  }
});

test('L4: every candidate names a route that exists, and a note that says how it renders', () => {
  for (const c of CANDIDATES) {
    assert.ok(routeExists(c), `${c.key}: no page file for ${c.path} - the cell would navigate nowhere`);
    assert.ok(hasNote(c),
      `${c.key}: note is missing or too short. It is what makes a failure readable - "40px fixed track, `
      + 'uppercase + .07em tracking" is the difference between a number and a diagnosis');
  }
});

test('L5: every opener name is one the spec can resolve', () => {
  /* A deliberate tripwire. The spec resolves names through an exhaustive `Record<OpenerName, …>`, so a new
     name is a compile error there; this fails too, so the name cannot be added in one place only. */
  for (const c of CANDIDATES) {
    assert.ok(openerKnown(c), `${c.key}: opener "${c.opener}" is not one of ${KNOWN_OPENERS.join(', ')}`);
  }
});

test('L6: candidateValues() maps every key to its NEW text, once', () => {
  /* The spec injects this. If it ever derived `was` instead of `now`, every cell would measure the old copy
     and pass, and the suite would report the new copy fitting. */
  const vals = candidateValues();
  assert.equal(Object.keys(vals).length, CANDIDATES.length, 'one entry per candidate');
  for (const c of CANDIDATES) {
    assert.equal(vals[c.key], c.now, `${c.key} must inject the NEW text`);
    assert.notEqual(vals[c.key], c.was, `${c.key} must not inject the OLD text`);
  }
});

test('L7: the list is non-empty and still covers the six measured on production 2026-10-27', () => {
  /* Not a count for its own sake. An empty or truncated list makes the whole spec a no-op that reports
     success, which is the failure mode this file exists to prevent - so the floor is asserted explicitly. */
  assert.ok(CANDIDATES.length >= 6, `expected at least the six 2026-10-27 candidates, got ${CANDIDATES.length}`);
  for (const key of [
    'MARKET_CONDITIONS_WIDGET_RSI_LABEL', 'HOURS_SESSION_MAP_TITLE', 'MARKETS_24H_COL_LABEL',
    'FUNDING_RANGE_24H', 'ABSORPTION_DETECTOR_MTF_BADGE', 'ARENA_SCANNER_COL_24H',
  ]) {
    assert.ok(CANDIDATES.some((c) => c.key === key), `${key} was dropped from the candidate list`);
  }
});

test('L8: CONTROL - every predicate above rejects a candidate that breaks it', () => {
  /* Without this, L1-L7 passing says only that the current list is clean. It must also be shown that a dirty
     list would NOT pass - the same question I ask of any guard, after a rubric of mine once scored a correct
     build as a failure and a check of mine passed on a write that would have destroyed four translations. */
  assert.equal(isRegisteredKey({ key: 'NOT_A_REAL_LABEL_KEY_12345' }), false, 'an unregistered key must be rejected');
  assert.equal(changesTheText({ now: '24h', was: '24h' }), false, 'an unchanged string must be rejected');
  assert.equal(getsLonger({ now: '24h', was: '24 hours' }), false, 'a SHORTER new value must be rejected');
  assert.equal(getsLonger({ now: '24 hours', was: '24 hours' }), false, 'equal lengths must be rejected');
  assert.equal(ruleApplies({ now: '24h', was: '24 hours' }), false, 'shorter with no fixed-width claim is out of scope');

  /* THE ESCAPE HATCH MUST WORK AND MUST NOT BE A BLANKET BYPASS - both halves, because a flag that lets
     anything through would quietly disable L3 for every future candidate. */
  assert.equal(ruleApplies({ now: '1h', was: '24 hours', coversFixedWidth: true }), true,
    'a SHORTER label in a fixed-width container is in scope - that is §7\'s second trigger');
  assert.equal(ruleApplies({ now: '24h', was: '24 hours', coversFixedWidth: false }), false,
    'the flag set to false must not act as if it were absent-and-true');
  assert.equal(ruleApplies({ now: '24 hours', was: '24h' }), true, 'longer alone is enough, no flag needed');
  assert.equal(hasNote({ note: '' }), false, 'an empty note must be rejected');
  assert.equal(hasNote({ note: 'short' }), false, 'a uselessly short note must be rejected');
  assert.equal(routeExists({ path: '/no-such-route-12345' }), false, 'a route with no page file must be rejected');
  assert.equal(routeExists({ path: 'dashboard' }), false, 'a path without a leading slash must be rejected');
  assert.equal(openerKnown({ opener: 'notAnOpener' }), false, 'an unknown opener must be rejected');

  /* And the positive half: each predicate must ACCEPT the real thing, or the rejections above would be
     satisfied by a predicate that returns false for everything. */
  assert.equal(isRegisteredKey({ key: 'ARENA_SCANNER_COL_24H' }), true);
  assert.equal(changesTheText({ now: '24 hours', was: '24h' }), true);
  assert.equal(getsLonger({ now: '24 hours', was: '24h' }), true);
  assert.equal(hasNote({ note: 'flyout column header, 40px fixed track' }), true);
  assert.equal(routeExists({ path: '/arena' }), true);
  assert.equal(routeExists({ path: '/' }), true, 'the landing route is app/page.tsx, not app//page.tsx');
  assert.equal(openerKnown({ opener: 'scannerFlyout' }), true);
  assert.equal(openerKnown({}), true, 'no opener is valid - most labels are on the page at rest');
});
