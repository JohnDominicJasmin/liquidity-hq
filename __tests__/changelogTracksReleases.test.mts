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
 * WHAT THIS FILE DOES NOT DO, so nobody reads more into a green run than is there: it cannot tell
 * whether the entry's TEXT describes what shipped. `CONTRIBUTING.md`'s rule 2 — only user-visible
 * changes — and rule 3 — a release with nothing user-visible gets no entry, recorded as deliberate —
 * are human judgements. This file checks that the newest entry POINTS AT the newest release. That is
 * the failure that actually happened.
 *
 * NO NETWORK: reads the file and the local git tags. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './_appPath.mts';

const TAG_SHAPE = /^v\d{4}\.\d{2}\.\d{2}[a-z]?(\.\d+)?$/;

/** Entries in file order, newest first — the order the page renders them in. */
function entries(): Array<{ date: string; tag: string }> {
  const src = readFileSync(path.join(ROOT, 'lib/changelog.ts'), 'utf8');
  /* COMMENTS STRIPPED FIRST, and that is not cosmetic here. This file's header quotes previous
     entries verbatim while explaining why they changed, so a naive scan finds dates and tags that
     are prose ABOUT the changelog rather than entries IN it. Same token, two meanings — the trap
     that produced three different counts from one migration file tonight. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const out: Array<{ date: string; tag: string }> = [];
  const re = /date:\s*'([^']+)'[\s\S]{0,200}?tag:\s*'([^']+)'/g;
  for (const m of code.matchAll(re)) out.push({ date: m[1], tag: m[2] });
  return out;
}

/** Release tags newest-first by creation date, not by string sort. */
function gitTags(): string[] {
  const raw = execFileSync('git', ['tag', '--sort=-creatordate'], { cwd: ROOT, encoding: 'utf8' });
  return raw.split('\n').map(s => s.trim()).filter(s => TAG_SHAPE.test(s));
}

test('C1. the newest changelog entry names the newest release tag', () => {
  const e = entries();
  const tags = gitTags();

  /* CONTROLS FIRST. Without them "they match" can be two empty sets agreeing, which is exactly how
     a check like this passes forever while the page rots. */
  assert.ok(e.length >= 5, `only ${e.length} changelog entries parsed - the scan is broken, so any comparison below is meaningless`);
  assert.ok(tags.length >= 5, `only ${tags.length} release tags found (${tags.join(', ') || 'none'}) - no tags means no comparison`);

  assert.equal(
    e[0].tag, tags[0],
    `the newest changelog entry is tagged ${e[0].tag} but the newest release tag is ${tags[0]}.\n\n` +
    'On 2026-11-07 this exact mismatch was live: the page said v2026.11.05 while production served ' +
    'v2026.11.07, 245 commits newer. The release-drift check passed throughout, because it compares ' +
    '/api/version against main and whether the deployed commit is tagged - neither of which reads ' +
    'this file.\n\n' +
    'Either add the entry for the release that shipped, or - if nothing user-visible shipped - ' +
    'record that it got no entry ON PURPOSE, per CONTRIBUTING.md rule 3. A forgotten entry and a ' +
    'deliberately absent one look identical on the page.',
  );
});

test('C2. the newest entry\'s date is the date that tag was actually created', () => {
  const e = entries();
  const tags = gitTags();
  assert.ok(e.length > 0 && tags.length > 0, 'needs entries and tags - see C1');

  const iso = execFileSync('git', ['log', '-1', '--format=%cs', tags[0]], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.match(iso, /^\d{4}-\d{2}-\d{2}$/, `could not read a date for tag ${tags[0]}, got "${iso}"`);

  assert.equal(
    e[0].date, iso,
    `the newest entry is dated ${e[0].date} but ${tags[0]} was created ${iso}.\n\n` +
    'THE DATE FOLLOWS THE TAG, AND THE TAG FOLLOWS THE DEPLOY. This entry was written as ' +
    '2026-11-05, moved to 2026-11-06 because the release was expected to ship then, and shipped on ' +
    'the 7th. A date set from the plan is wrong whenever the plan slips, and it slipped twice.',
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
