import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CANDIDATES, candidateValues } from '@/qa/labelCandidates';
import { LABEL_KEYS } from '@/lib/labelKeys';
import { appRoutes } from './_appPath.mts';

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
/* THERE IS DELIBERATELY NO LENGTH PREDICATE. One commit of this file had `getsLonger` and a
   `coversFixedWidth` opt-out, which are §7's two REJECTED triggers OR'd together - I built against the
   section as it read when I started and it was revised twice underneath me. §7 now records both as tried
   and wrong: character count substitutes for pixels, since a shorter string of wide glyphs can be wider in
   a proportional uppercased letter-spaced font; and "lands in a fixed-width container" is sound but needs
   the CSS inspection the rule exists to route around.

   Neither had any work left to do anyway. §7's live triggers are "no entry for this key" - unrepresentable
   here, because CANDIDATES IS the registration and membership is the compliance - and "the entry's value
   does not match the string being written", which is L6. A shortening candidate is simply measured. */
const hasNote = (c: { note: string }) => typeof c.note === 'string' && c.note.trim().length > 10;
/* ROUTE GROUPS, and this was group-aware for every route EXCEPT `/`.
 *
 * The previous version tried a direct path first (`app/x/page.tsx`) and then looked through
 * `app/(group)/x/page.tsx`. The group branch opened with `if (seg === '') return false` - a
 * guard against building `app/(main)//page.tsx` with a doubled slash. Correct in itself, and
 * it meant the landing route `/` never reached the group search at all. On a tree with no
 * groups the direct branch found `app/page.tsx` and it passed; on #1740's tree that file is
 * `app/(main)/page.tsx`, the direct branch misses, and the group branch gave up before
 * building anything - failing with "the landing route is app/page.tsx, not app//page.tsx".
 *
 * So the bug was never the group handling; it was ONE route the group handling excluded.
 *
 * Replaced with a membership test against `appRoutes('page')`, which derives every URL from
 * the files and strips parenthesised segments - so `/` is handled by the same code path as
 * every other route rather than by a special case that had to be remembered twice. It also
 * covers `page.jsx` and `page.ts` (the repo mixes extensions, which the old two-element
 * arrays had to spell out) and drops a `process.cwd()` dependency: this now resolves from
 * the module's own location, so it no longer passes or fails on where the runner was
 * invoked from. */
const ROUTES = new Set(appRoutes('page'));
const routeExists = (c: { path: string }) => c.path.startsWith('/') && ROUTES.has(c.path);
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

test('L3: every candidate actually changes the text', () => {
  /* The only property worth asserting about the pair. A candidate whose `now` equals its `was` measures
     nothing - it injects the string the page already renders and reports a pass. Which DIRECTION the change
     goes is not this test's business: §7 does not scope by length, and a shortening candidate costs one
     cell that passes easily. */
  for (const c of CANDIDATES) {
    assert.ok(changesTheText(c), `${c.key}: now and was are identical, so this cell measures nothing`);
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
  /* THE BEHAVIOUR THAT CHANGED, asserted as a positive rather than left as an absence. A shortening
     candidate used to be REJECTED by a length predicate that is now deleted, and the consequence was the
     reason to delete it: the author's cheapest exit from a wrongly-rejecting gate is removing the candidate,
     so the gate would have cost a measurement rather than forcing one. */
  assert.equal(changesTheText({ now: '24h', was: '24 hours' }), true,
    'a SHORTENING candidate is accepted - it is measured, and a cell that passes easily is not a problem');
  assert.equal(hasNote({ note: '' }), false, 'an empty note must be rejected');
  assert.equal(hasNote({ note: 'short' }), false, 'a uselessly short note must be rejected');
  assert.equal(routeExists({ path: '/no-such-route-12345' }), false, 'a route with no page file must be rejected');
  assert.equal(routeExists({ path: 'dashboard' }), false, 'a path without a leading slash must be rejected');
  assert.equal(openerKnown({ opener: 'notAnOpener' }), false, 'an unknown opener must be rejected');

  /* And the positive half: each predicate must ACCEPT the real thing, or the rejections above would be
     satisfied by a predicate that returns false for everything. */
  assert.equal(isRegisteredKey({ key: 'ARENA_SCANNER_COL_24H' }), true);
  assert.equal(changesTheText({ now: '24 hours', was: '24h' }), true);
  assert.equal(hasNote({ note: 'flyout column header, 40px fixed track' }), true);
  assert.equal(routeExists({ path: '/arena' }), true);
  assert.equal(routeExists({ path: '/' }), true, 'the landing route is app/page.tsx, not app//page.tsx');
  assert.equal(openerKnown({ opener: 'scannerFlyout' }), true);
  assert.equal(openerKnown({}), true, 'no opener is valid - most labels are on the page at rest');
});
