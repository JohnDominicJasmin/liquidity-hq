/* QA #1185 item 84: a cross-browser run cannot leave an old report that looks current.
 *   C1 the earlier report is removed by the main process, left alone by a worker, and a missing one is no error
 *   C2 the config removes it BEFORE anything can refuse the run, at the path the reporter writes, and stamps the target and start time
 *   C3 the summary says when and against what the report was made */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { clearOldReport } from '../qa/clearReport.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('C1. removed by the main process only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa84-')); const file = join(dir, 'report.json');
  try {
    writeFileSync(file, '{}'); clearOldReport(file, { TEST_WORKER_INDEX: '0' }); assert.equal(existsSync(file), true, 'a worker must not delete');
    clearOldReport(file, {}); assert.equal(existsSync(file), false);
    clearOldReport(file, {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('C2. the config', () => {
  const c = read('qa/crossbrowser.config.ts');
  const clear = c.indexOf("clearOldReport(join(__dirname, 'crossbrowser-report.json'));");
  assert.ok(clear > 0, 'the old report is not cleared');
  assert.ok(clear < c.indexOf('if (!BASE_URL)'), 'it must go before the run can be refused');
  assert.ok(c.includes("outputFile: '../qa/crossbrowser-report.json'"), 'CONTROL: the reporter writes the same file');
  assert.ok(c.includes('metadata: { target: BASE_URL, startedAt: new Date().toISOString() },'));
});

test('C3. the summary names the run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa84-')); const file = join(dir, 'report.json');
  try {
    writeFileSync(file, JSON.stringify({ config: { metadata: { target: 'https://staging.example' } }, stats: { startTime: '2026-11-26T10:00:00.000Z' }, suites: [{ specs: [] }] }));
    const out = execFileSync(process.execPath, [fileURLToPath(new URL('../qa/tools/crossbrowser-summary.cjs', import.meta.url)), file], { encoding: 'utf8' });
    assert.match(out.split('\n')[0], /run started 2026-11-26T10:00:00\.000Z against https:\/\/staging\.example/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
