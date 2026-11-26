import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { test as base } from '@playwright/test';
import { holdLock, releaseLock, type Held } from '../fixtureLock';

/* SPECS THAT SAVE TO FIXTURE A'S SETTINGS RUN ONE AT A TIME (#1185 item 63). They reset the saved strategy by PATCH and then read it
 * back, so a second writer between the two flips the result.
 *   - Within a job, `workers: 2` ran two such files at once: a lock now serialises them.
 *   - Across jobs, the desktop and mobile legs run in parallel on one account and no lock spans two machines, so these run on the
 *     desktop leg only (they test saved state, not layout). A second pinned account for mobile would lift that. */
const DIR = join(tmpdir(), 'lhq-e2e-fixture-a');
const MAX_WAIT = 1_200_000;

export function writesAccountA(test: typeof base): void {
  let held: Held | null = null;
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'saves to fixture A, which the desktop job is using at the same time (#1185 item 63)');
    const allowed = testInfo.timeout; testInfo.setTimeout(allowed + MAX_WAIT);
    const from = Date.now(); held = await holdLock(DIR, { waitMs: MAX_WAIT });
    testInfo.setTimeout(allowed + (Date.now() - from)); // the wait is not the test's own time
  });
  test.afterEach(() => { if (held) releaseLock(held); held = null; });
}
