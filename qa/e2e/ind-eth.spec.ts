/* ARENA INDICATORS, matrix: ETH x 15m/1h/4h/1d x 1280 and 390 (dark), Pro fixture. See _indcell.ts for what each row asserts.
 * Findings are printed ([IND] / [INDJ] / [IND-CELL]) and do NOT fail the test: a failing test is retried and would double the run. Only a missing chart handle fails. */
import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON } from './_auth';
import { runCell, report } from './_indcell';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
for (const tf of ['15m', '1h', '4h', '1d']) for (const w of [1280, 390]) test(`IND eth ${tf} ${w}`, async ({ browser }) => {
  test.setTimeout(300_000);
  const rows = await runCell(browser, 'eth', tf, w, { shots: true });
  const fails = report(rows);
  console.log(`[IND-CELL] eth ${tf} ${w}: ${fails.length ? 'FINDINGS ' + fails.length : 'clean'} | ${fails.join(' ;; ')}`);
  expect(rows.filter((r) => r.ind === 'CHART'), 'the chart handle was not found').toEqual([]);
});
