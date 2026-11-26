/* QA #85, test ref only: runs qa/landing-conformance.mjs against the runner build and prints C15 and C20. */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test.describe.configure({ timeout: 400_000, retries: 0 });
test('C15 and C20 find the plan cards', async () => {
  const run = (...args: string[]) => execFileSync(process.execPath, ['qa/landing-conformance.mjs', '--base', 'http://localhost:3100', ...args], { encoding: 'utf8', timeout: 300_000, maxBuffer: 5e7 });
  const out = JSON.parse(run('--json')) as { out: Record<string, { desktop: { c15: unknown }; mobile: { c20: unknown } }> };
  for (const [theme, v] of Object.entries(out.out)) console.log(`[L85] ${theme}: c15=${JSON.stringify(v.desktop.c15)} c20=${JSON.stringify(v.mobile.c20)}`);
  for (const line of run().split('\n').filter((l) => /\bC(7|15|20) /.test(l))) console.log(`[L85] ${line.trim()}`);
  for (const v of Object.values(out.out)) { expect(v.desktop.c15).not.toBeNull(); expect(v.mobile.c20).not.toBeNull(); }
});
