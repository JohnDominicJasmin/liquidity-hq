import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* #126 — the release PR opens itself, and for its whole life it never ran CI.
 *
 * GitHub does not trigger workflows on events created by GITHUB_TOKEN. It is
 * deliberate anti-recursion with no opt-out, so a bot-opened PR fired no
 * `pull_request` event, the required `CI Gate` check was ABSENT rather than
 * failing, and the PR was unmergeable with nothing red to explain why.
 *
 * The fix is a PAT on the release-PR step. What makes the PAT safe to adopt is
 * that its failure mode is LOUD: an expired token fails `gh pr create`, and
 * `release-pr-failed` opens an issue carrying the release body.
 *
 * THAT ARGUMENT HOLDS ONLY WHILE THE TWO JOBS USE DIFFERENT CREDENTIALS.
 * Hoisting RELEASE_PAT to a workflow-level `env:` looks like tidying and reads
 * as harmless. It would make one expiry kill the primary and the fallback
 * together - restoring the exact silence both were built to remove.
 *
 * Nothing else can catch that. There is no environment where a lapsed PAT can
 * be rehearsed, and the symptom is a release PR that stops appearing.
 *
 * Text, not YAML: `js-yaml` resolves here but is NOT a declared dependency -
 * it arrives transitively, so a dependency bump could remove it and take this
 * test with it. The file's job blocks are unambiguous at four-space indent. */

/* Line endings normalised first. Git checks this out CRLF on Windows and LF on
   the CI runner, so a pattern anchored on `:\n` matches in CI and not on a
   developer's machine - green where nobody looks, red where they do. Found by
   this test failing locally while the workflow was correct. */
const SRC = readFileSync(
  new URL('../.github/workflows/release-signals.yml', import.meta.url), 'utf8',
).replace(/\r\n/g, '\n');

/** The lines belonging to one job, from its `  name:` header to the next one,
 *  with full-line comments removed.
 *
 *  The comments have to go, and this is the third time today a source-scanning
 *  test has read prose as code. The comment on `release-pr-failed` says "do not
 *  tidy RELEASE_PAT up to a workflow-level env:" - so a check for the ABSENCE of
 *  RELEASE_PAT in that job failed on the sentence warning against it.
 *
 *  Only whole-line comments are stripped, not `#` to end of line: the run blocks
 *  contain shell strings with `#` in them (issue references, colour literals),
 *  and a naive strip would silently truncate the very lines being checked. */
function job(name: string): string {
  const start = SRC.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `job "${name}" is gone from release-signals.yml`);
  const rest = SRC.slice(start + 1);
  const next = rest.search(/\n {2}[a-z][a-z0-9-]*:\n/);
  const block = next === -1 ? rest : rest.slice(0, next);
  return block.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
}

test('release-signals token separation', async (t) => {
  await t.test('the release PR is opened by the PAT, not the bot', () => {
    const j = job('release-pr');
    assert.match(j, /GH_TOKEN:\s*\$\{\{\s*secrets\.RELEASE_PAT\s*\}\}/,
      'release-pr must use RELEASE_PAT - with github.token the PR it opens ' +
      'never triggers CI, and CI Gate is absent rather than failing (#126)');
  });

  /* The invariant everything else rests on. */
  await t.test('the fallback runs on a different credential', () => {
    const j = job('release-pr-failed');
    assert.doesNotMatch(j, /RELEASE_PAT/,
      'release-pr-failed must NOT use RELEASE_PAT. It exists to report the ' +
      'primary failing; sharing the credential means one expiry silences both.');
    assert.match(j, /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/,
      'release-pr-failed must keep github.token');
  });

  /* A workflow-level env: would leak the PAT into every job including the
     fallback, which is the tidy-up the test above cannot see on its own -
     the fallback would still not MENTION RELEASE_PAT while using it. */
  await t.test('no workflow-level env hands the PAT to every job', () => {
    const header = SRC.slice(0, SRC.indexOf('\njobs:'));
    assert.doesNotMatch(header, /GH_TOKEN/,
      'GH_TOKEN is set at workflow level - every job now shares one credential, ' +
      'including the fallback that exists to survive that credential failing');
  });

  /* Not a token concern, but the same file and the same failure shape: this
     job reads production and must never be the thing that writes to it. */
  await t.test('the drift check still runs on the default token', () => {
    assert.match(job('prod-drift'), /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
  });
});
