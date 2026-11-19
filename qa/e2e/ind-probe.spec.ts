/* ARENA INDICATORS, stage 1: ONE cell end to end (BTC 1h, 1280 and 390) to prove the instruments (chart handle, pixel oracle, legend read, independent oracles) before the matrix fans out. Qa site, Pro fixture, paid AI fenced.
 *   gh workflow run ci.yml --ref test/<ref> -f e2e=true -f base_url=https://liquidity-hq-qa.onrender.com -f project=desktop -f screenshots=true "-f" "spec=qa/e2e/ind-probe.spec.ts" */
import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON } from './_auth';
import { runCell, report } from './_indcell';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
for (const w of [1280, 390]) test(`IND probe btc 1h ${w}`, async ({ browser }) => {
  test.setTimeout(300_000);
  const rows = await runCell(browser, 'btc', '1h', w, { shots: true });
  const fails = report(rows);
  expect(fails, fails.join('\n')).toEqual([]);
});
