/* A DATED SELF-FIRING CHECK: China's 2027 holiday LENGTHS are not published yet, and nothing
 * watches for them.
 *
 * THE SITUATION, from #1952. China's statutory holiday DATES are fixed, but the actual closure
 * WINDOWS are a State Council arrangement published each November or December for the following
 * year. The 2027 notice is not out - sources give the Spring Festival break as 5, 9 or 11 February
 * and none of them is official. So `lib/session.ts` ships only the statutory dates for 2027, and
 * **every window understates the real one**. That was the right call: leaving 2027 empty would print
 * "open" on 6 February, the lunar new year, and guessing a 7-day range would be indistinguishable
 * from a sourced one to the next reader.
 *
 * WHY A CELL RATHER THAN A NOTE. The note exists - `lib/session.ts` says this about itself, and PM
 * has it for December. But `docs/OWNER-BLOCKERS.md` names the failure mode this is an instance of:
 * **an instruction with no expiry.** `RELEASE_PR_PAUSED` was correct on the day it was set and
 * nothing was watching the date, so it skipped every release PR for a month. A comment does not
 * fire. This does.
 *
 * NOT IN `qa/e2e/clock.spec.ts`, AND THE DIVERGENCE IS DELIBERATE. That is where the sibling
 * timebomb lives (the one that caught `HOLIDAYS_2026` tonight) and PM asked for "the same pattern".
 * But `ci.yml:636` gates the whole e2e job on `base_ref == 'main' || workflow_dispatch`, so a cell
 * there fires ONLY on a release PR or a manual run. A dated reminder belongs where it cannot be
 * missed: `__tests__/` runs on every `npm test`, so this fires on the first PR after the date
 * whoever opens it. Same idea, better placement for this particular job.
 *
 * WHAT IT CHECKS, and why this is the discriminating property: a statutory-only Spring Festival is
 * a ONE-DAY window (`2027-02-06` to `2027-02-06`). Every published arrangement is multi-day - the
 * 2026 notice gave 8. So "the Spring Festival window is still one day" is exactly "the notice has
 * not been applied", and it needs no knowledge of what the notice will say.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(ROOT, 'lib', 'session.ts'), 'utf8');

/** The date from which the State Council notice should exist. PM/DevOps's call: 2026-12-15. */
const DUE = Date.UTC(2026, 11, 15);

/** The 2027 China ranges, read out of the shipped table. */
function china2027(): Array<{ start: string; end: string; name: string }> {
  const at = SRC.indexOf("'2027'");
  assert.notEqual(at, -1, "lib/session.ts has no '2027' key in HOLIDAYS_BY_YEAR - the table shape changed, so update this cell rather than deleting it");
  const cn = SRC.indexOf('China:', at);
  assert.notEqual(cn, -1, 'no China entry under 2027 - if China support was removed, delete this cell and say so');
  const block = SRC.slice(cn, SRC.indexOf(']', cn));
  return [...block.matchAll(/start:\s*'([^']+)',\s*end:\s*'([^']+)',\s*name:\s*"?'?([^'"]+)"?'?\s*\}/g)]
    .map((m) => ({ start: m[1], end: m[2], name: m[3] }));
}

const days = (r: { start: string; end: string }) =>
  Math.round((Date.parse(r.end) - Date.parse(r.start)) / 86_400_000) + 1;

test('CN1. PREMISE: the 2027 China table is readable and holds a Spring Festival entry', () => {
  const ranges = china2027();
  assert.ok(ranges.length > 0, 'parsed zero 2027 China ranges, so the check below would pass by having nothing to look at');
  assert.ok(ranges.some((r) => /Spring Festival/i.test(r.name)),
    `no Spring Festival entry among ${ranges.map((r) => r.name).join(', ')} - that is the entry this check keys on`);
});

test("CN2. from 2026-12-15, China's 2027 holiday windows must no longer be statutory-only", () => {
  const spring = china2027().find((r) => /Spring Festival/i.test(r.name))!;
  const len = days(spring);

  if (Date.now() < DUE) {
    /* Before the due date, statutory-only is CORRECT and this cell must not fail. Reported so a
       reader knows the check is armed and what it is waiting for, rather than silently passing. */
    const left = Math.ceil((DUE - Date.now()) / 86_400_000);
    console.log(`      armed: Spring Festival 2027 is ${len} day(s); fires in ${left} day(s) if still statutory-only`);
    assert.ok(len >= 1, 'the Spring Festival range is malformed');
    return;
  }

  assert.ok(len >= 5,
    `China's 2027 Spring Festival is still a ${len}-day window (${spring.start} to ${spring.end}), which is the STATUTORY date only - `
    + 'the State Council arrangement should have been published by now (it comes out each November or December for the following year), '
    + 'and every 2027 CN window in lib/session.ts understates the real closure until it is applied. '
    + 'Source: the State Council notice on gov.cn, "关于2027年部分节假日安排的通知". Update HOLIDAYS_BY_YEAR 2027 China and move this check to 2028 - '
    + 'do NOT widen this assertion, and do not guess the range: an invented 7-day window reads as sourced to the next person.');
});
