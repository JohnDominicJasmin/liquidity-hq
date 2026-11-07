/* THE PUBLIC CHANGELOG HAS NO WATCHER, AND THE v2026.11.07 RELEASE IS THE PROOF.
 *
 * `lib/changelog.ts` is hand-maintained and says so about itself. On 2026-11-07 production shipped
 * 245 commits tagged `v2026.11.07` while the newest changelog entry read **`v2026.11.05`** and
 * rendered as "5 November 2026". Two versions and two days stale, live on the public page.
 *
 * NOTHING CAUGHT IT. The release-drift workflow compares `/api/version` against `main` and checks
 * the deployed commit is tagged — both passed. The changelog is the half with no detector, and it
 * was only noticed because QA happened to look after tagging.
 *
 * AND THE DATE MOVED TWICE BEFORE LANDING, WHICH IS THE OTHER HALF OF THE BUG. It was written as
 * `2026-11-05`, changed to `2026-11-06` because the release was EXPECTED to ship that day, and the
 * release went out on the 7th. **A date set from the plan is wrong whenever the plan slips.** The
 * only ordering that cannot drift is: the deploy happens, the tag is cut from what deployed, and the
 * entry follows the tag.
 *
 * ── THE RELEASE WINDOW, AND WHY THE FIRST VERSION OF THIS FILE COULD NOT BE SATISFIED ──────────
 *
 * The first version asserted `newest entry.tag === newest git tag`, full stop. That is true of a
 * repository at rest and **impossible during a release**, because the ordering above requires the
 * entry to be written, reviewed and merged BEFORE the tag it names can exist. So the check made the
 * release gate red for doing the release correctly: #2054's own build failed C1/C2 on 2026-11-07
 * while the entry was right and the tag simply had not been cut yet.
 *
 * A check that cannot be green at the moment it matters does not get fixed — it gets skipped, and a
 * skip exits 0, which is how this file's own subject matter rots unobserved.
 *
 * SO THE RULE NOW MODELS THE WINDOW, AND BOUNDS IT:
 *
 *   released   newest entry.tag === newest tag                     the resting state
 *   pending     newest entry.tag sorts AFTER the newest tag, no such tag exists yet, AND the entry
 *               directly below it === the newest tag               exactly one release in flight
 *   anything else fails
 *
 * TWO untagged entries fail, an untagged entry sitting above a STALE one fails, and a tag with no
 * entry fails — which is the original defect and is still the thing this file exists to catch. The
 * window is one entry wide because one release is in flight at a time; a second pending entry means
 * either a release was never tagged or the page is being written from a plan again.
 *
 * WHAT IS NOT CHECKED IN `pending`, STATED SO NOBODY READS MORE INTO GREEN THAN IS THERE: the
 * pending entry's own DATE cannot be verified, because the tag whose creation date it must equal
 * does not exist. C2 therefore checks the newest TAGGED entry. The pending date is verified by this
 * same cell on the first run after the tag is cut — so a wrong date is caught one run later, not
 * never. That residual gap is the price of being able to ship at all, and it is why whoever tags
 * confirms with `git log -1 --format=%cs <tag>`.
 *
 * `%cs` RENDERS IN THE COMMIT'S OWN STORED OFFSET, not the viewer's timezone — measured on
 * v2026.11.07 under UTC, Asia/Manila and America/New_York, all three give 2026-11-07. So CI and a
 * local run agree, and an entry dated from the committer's calendar day is right in both.
 *
 * WHAT THIS FILE STILL DOES NOT DO: it cannot tell whether the entry's TEXT describes what shipped.
 * `CONTRIBUTING.md`'s rule 2 — only user-visible changes — and rule 3 — a release with nothing
 * user-visible gets no entry, recorded as deliberate — are human judgements. This file checks that
 * the newest entry POINTS AT the newest release, or is the one legitimately ahead of it.
 *
 * NO NETWORK: reads the file and the local git tags. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './_appPath.mts';

const TAG_SHAPE = /^v\d{4}\.\d{2}\.\d{2}[a-z]?(\.\d+)?$/;

export interface Entry { date: string; tag: string }

/** Entries in file order, newest first — the order the page renders them in. */
function entries(): Entry[] {
  const src = readFileSync(path.join(ROOT, 'lib/changelog.ts'), 'utf8');
  /* COMMENTS STRIPPED FIRST, and that is not cosmetic here. This file's header quotes previous
     entries verbatim while explaining why they changed, so a naive scan finds dates and tags that
     are prose ABOUT the changelog rather than entries IN it. Same token, two meanings — the trap
     that produced three different counts from one migration file tonight. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const out: Entry[] = [];
  const re = /date:\s*'([^']+)'[\s\S]{0,200}?tag:\s*'([^']+)'/g;
  for (const m of code.matchAll(re)) out.push({ date: m[1], tag: m[2] });
  return out;
}

/** Release tags newest-first by creation date, not by string sort. */
function gitTags(): string[] {
  const raw = execFileSync('git', ['tag', '--sort=-creatordate'], { cwd: ROOT, encoding: 'utf8' });
  return raw.split('\n').map(s => s.trim()).filter(s => TAG_SHAPE.test(s));
}

/* A PENDING tag has no creation date, so it can only be ordered against existing tags BY NAME.
   Plain string comparison is correct for `vYYYY.MM.DD[letter][.n]` because every numeric field is
   zero-padded and fixed-width: v2026.10.29 < v2026.10.29b < v2026.10.30 < v2026.11.07
   < v2026.11.07.2 < v2026.11.08. TAG_SHAPE is enforced before this is relied on, so a tag that
   would break the ordering cannot reach it. */
const sortsAfter = (a: string, b: string): boolean => a > b;

export type Reconciled =
  | { ok: true; mode: 'released' | 'pending'; datedEntry: Entry; againstTag: string }
  | { ok: false; reason: string };

/** The whole rule, as a pure function so it can be tested on fixtures rather than only on this
 *  repository's current state — the live cells below exercise one case out of four. */
export function reconcile(e: Entry[], tags: string[]): Reconciled {
  if (e.length === 0) return { ok: false, reason: 'no changelog entries parsed' };
  if (tags.length === 0) return { ok: false, reason: 'no release tags found' };

  const newestTag = tags[0];
  if (e[0].tag === newestTag) {
    return { ok: true, mode: 'released', datedEntry: e[0], againstTag: newestTag };
  }

  if (!sortsAfter(e[0].tag, newestTag)) {
    return {
      ok: false,
      reason: `the newest changelog entry is tagged ${e[0].tag} but the newest release tag is ${newestTag}, ` +
        'which is NEWER. The page is behind what shipped - this is the v2026.11.07 defect exactly: ' +
        'the page said v2026.11.05 while production served v2026.11.07, 245 commits newer. Either add ' +
        'the entry for the release that shipped, or - if nothing user-visible shipped - record that it ' +
        'got no entry ON PURPOSE per CONTRIBUTING.md rule 3. A forgotten entry and a deliberately ' +
        'absent one look identical on the page.',
    };
  }

  if (tags.includes(e[0].tag)) {
    return {
      ok: false,
      reason: `entry ${e[0].tag} sorts after the newest tag ${newestTag}, yet a tag named ${e[0].tag} ` +
        'already exists. Tags were created out of name order, so "newest" is ambiguous and the ' +
        'comparison cannot be trusted. Resolve the tags rather than the entry.',
    };
  }

  if (e.length < 2) {
    return { ok: false, reason: `entry ${e[0].tag} is ahead of every tag and there is no entry below it to match ${newestTag}` };
  }

  if (e[1].tag !== newestTag) {
    return {
      ok: false,
      reason: `entry ${e[0].tag} is legitimately ahead of the newest tag ${newestTag} (a release in flight), ` +
        `but the entry BELOW it is ${e[1].tag}, not ${newestTag}. Only ONE release is in flight at a time, ` +
        'so either a shipped release never got its entry, or a second entry was written from a plan ' +
        'before its release existed. Both are the drift this file exists to catch.',
    };
  }

  return { ok: true, mode: 'pending', datedEntry: e[1], againstTag: newestTag };
}

/** The date `git` records for the commit a tag points at, in that commit's own stored offset. */
function tagDate(tag: string): string {
  return execFileSync('git', ['log', '-1', '--format=%cs', tag], { cwd: ROOT, encoding: 'utf8' }).trim();
}

test('C1. the newest changelog entry names the newest release tag, or is the one release in flight', () => {
  const e = entries();
  const tags = gitTags();

  /* CONTROLS FIRST. Without them "they match" can be two empty sets agreeing, which is exactly how
     a check like this passes forever while the page rots. */
  assert.ok(e.length >= 5, `only ${e.length} changelog entries parsed - the scan is broken, so any comparison below is meaningless`);
  assert.ok(tags.length >= 5, `only ${tags.length} release tags found (${tags.join(', ') || 'none'}) - no tags means no comparison`);

  const r = reconcile(e, tags);
  assert.ok(r.ok, r.ok ? '' : r.reason);
  console.log(`C1: ${r.mode}${r.mode === 'pending' ? ` - ${e[0].tag} is in flight, dated entry is ${r.datedEntry.tag}` : ''}`);
});

test('C2. the newest TAGGED entry\'s date is the date that tag was actually created', () => {
  const e = entries();
  const tags = gitTags();
  assert.ok(e.length > 0 && tags.length > 0, 'needs entries and tags - see C1');

  const r = reconcile(e, tags);
  assert.ok(r.ok, r.ok ? '' : `cannot date-check an inconsistent changelog - see C1: ${r.ok ? '' : r.reason}`);

  const iso = tagDate(r.againstTag);
  assert.match(iso, /^\d{4}-\d{2}-\d{2}$/, `could not read a date for tag ${r.againstTag}, got "${iso}"`);

  assert.equal(
    r.datedEntry.date, iso,
    `entry ${r.datedEntry.tag} is dated ${r.datedEntry.date} but ${r.againstTag} was created ${iso}.\n\n` +
    'THE DATE FOLLOWS THE TAG, AND THE TAG FOLLOWS THE DEPLOY. This entry was written as ' +
    '2026-11-05, moved to 2026-11-06 because the release was expected to ship then, and shipped on ' +
    'the 7th. A date set from the plan is wrong whenever the plan slips, and it slipped twice.' +
    (r.mode === 'pending'
      ? `\n\nNOTE: ${e[0].tag} is in flight and its own date is NOT checked here - its tag does not ` +
        'exist yet. This cell verifies it on the first run after the tag is cut.'
      : ''),
  );
});

test('C3. entries run strictly newest-first, so a new one cannot be appended below an old one', () => {
  const e = entries();
  assert.ok(e.length >= 5, `only ${e.length} entries parsed - see C1`);

  for (let i = 1; i < e.length; i++) {
    assert.ok(
      e[i - 1].date >= e[i].date,
      `entry ${i - 1} (${e[i - 1].date}, ${e[i - 1].tag}) is older than entry ${i} ` +
      `(${e[i].date}, ${e[i].tag}). The page renders in file order and says "newest first", so an ` +
      'out-of-order entry is shown in the wrong place - and an entry appended at the BOTTOM is the ' +
      'most likely way to add one without noticing.',
    );
  }
});

test('C4. every tag is well-formed and unique', () => {
  const e = entries();
  assert.ok(e.length >= 5, `only ${e.length} entries parsed - see C1`);

  const bad = e.filter(x => !TAG_SHAPE.test(x.tag)).map(x => x.tag);
  assert.deepEqual(bad, [], `malformed tags: ${bad.join(', ')}. Expected vYYYY.MM.DD with an optional letter suffix.`);

  const seen = new Map<string, number>();
  for (const x of e) seen.set(x.tag, (seen.get(x.tag) ?? 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1).map(([t, n]) => `${t} x${n}`);
  assert.deepEqual(dupes, [], `duplicate tags: ${dupes.join(', ')}. Two entries claiming one release means one of them is mislabelled.`);
});

/* ── C5: THE RULE ITSELF, ON FIXTURES ───────────────────────────────────────────────────────────
 *
 * C1 exercises exactly ONE of the four cases - whichever this repository happens to be in right
 * now. A widened rule that is only ever run against its own happy state is a rule nobody has
 * tested; the loosening added above would pass C1 just as well if it accepted everything.
 *
 * So each case gets a fixture, and the two that must FAIL are asserted to fail with a reason, not
 * merely asserted to be not-ok. */
const TAGS = ['v2026.11.07', 'v2026.10.31', 'v2026.10.30', 'v2026.10.29b', 'v2026.10.29'];
const entry = (tag: string, date: string): Entry => ({ tag, date });

test('C5. the rule accepts a repository at rest and exactly one release in flight, and nothing else', () => {
  /* (a) RESTING: newest entry is the newest tag. */
  const a = reconcile([entry('v2026.11.07', '2026-11-07'), entry('v2026.10.31', '2026-10-31')], TAGS);
  assert.ok(a.ok, `(a) at rest must pass: ${a.ok ? '' : a.reason}`);
  assert.equal(a.ok && a.mode, 'released');
  assert.equal(a.ok && a.datedEntry.tag, 'v2026.11.07', '(a) the date must be checked against the newest entry');

  /* (b) ONE IN FLIGHT: the release case. This is what #2054 needs and what the old rule refused. */
  const b = reconcile([entry('v2026.11.08', '2026-11-08'), entry('v2026.11.07', '2026-11-07')], TAGS);
  assert.ok(b.ok, `(b) one release in flight must pass: ${b.ok ? '' : b.reason}`);
  assert.equal(b.ok && b.mode, 'pending');
  assert.equal(b.ok && b.datedEntry.tag, 'v2026.11.07',
    '(b) the date must be checked against the newest TAGGED entry, since v2026.11.08 has no tag to compare to');
  assert.equal(b.ok && b.againstTag, 'v2026.11.07');

  /* (c) TWO AHEAD: must fail. One release is in flight at a time. */
  const c = reconcile([entry('v2026.11.09', '2026-11-09'), entry('v2026.11.08', '2026-11-08'), entry('v2026.11.07', '2026-11-07')], TAGS);
  assert.equal(c.ok, false, '(c) two untagged entries must FAIL - otherwise the page can be written arbitrarily far ahead of what shipped');
  assert.match(c.ok ? '' : c.reason, /ONE release is in flight/, '(c) must fail for the right reason');

  /* (d) A TAG WITH NO ENTRY: the original v2026.11.07 defect. Must still fail. */
  const d = reconcile([entry('v2026.10.31', '2026-10-31'), entry('v2026.10.30', '2026-10-30')], TAGS);
  assert.equal(d.ok, false, '(d) a shipped-and-tagged release with no entry must FAIL - this is the defect the file was written for');
  assert.match(d.ok ? '' : d.reason, /which is NEWER/, '(d) must fail for the right reason');

  /* (e) AHEAD, BUT THE ENTRY BELOW IS STALE: must fail. The pending slot does not excuse a gap
         underneath it - that is how one missed release becomes permanently invisible. */
  const e5 = reconcile([entry('v2026.11.08', '2026-11-08'), entry('v2026.10.31', '2026-10-31')], TAGS);
  assert.equal(e5.ok, false, '(e) an in-flight entry above a stale one must FAIL');
  assert.match(e5.ok ? '' : e5.reason, /the entry BELOW it is/, '(e) must fail for the right reason');

  /* (f) BEHIND AND ALSO ALREADY TAGGED: name order and creation order disagree, so "newest" is
         not well defined. Fail rather than pick one. */
  const f = reconcile([entry('v2026.11.08', '2026-11-08'), entry('v2026.11.07', '2026-11-07')],
    ['v2026.11.07', 'v2026.11.08', 'v2026.10.31', 'v2026.10.30', 'v2026.10.29b']);
  assert.equal(f.ok, false, '(f) a pending entry whose tag already exists must FAIL - the tag order is inconsistent');
  assert.match(f.ok ? '' : f.reason, /already exists/, '(f) must fail for the right reason');
});
