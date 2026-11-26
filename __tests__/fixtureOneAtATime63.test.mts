/* QA #1185 item 63: specs that save to the shared test account run one at a time.
 *   L1 a second holder waits until the first lets go   L2 an abandoned lock is taken over, and its late release removes nothing
 *   L3 every spec that PATCHes the settings route from a signed-in page registers the guard */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { holdLock, releaseLock } from '../qa/fixtureLock.ts';

const place = () => { const root = mkdtempSync(join(tmpdir(), 'qa63-')); return { dir: join(root, 'lock'), done: () => rmSync(root, { recursive: true, force: true }) }; };

test('L1. one at a time', async () => {
  const p = place();
  try {
    const order: string[] = [];
    const first = await holdLock(p.dir, { pollMs: 5 });
    const second = holdLock(p.dir, { pollMs: 5 }).then((h) => { order.push('second in'); return h; });
    await new Promise((r) => setTimeout(r, 60)); order.push('first out'); releaseLock(first);
    releaseLock(await second);
    assert.deepEqual(order, ['first out', 'second in']); assert.equal(existsSync(p.dir), false);
    const held = await holdLock(p.dir, { pollMs: 5 });
    await assert.rejects(holdLock(p.dir, { pollMs: 5, waitMs: 40 }), /gave up waiting/); releaseLock(held);
  } finally { p.done(); }
});

test('L2. abandoned', async () => {
  const p = place();
  try {
    const dead = await holdLock(p.dir); const old = new Date(Date.now() - 3_600_000); utimesSync(p.dir, old, old);
    const next = await holdLock(p.dir, { pollMs: 5, waitMs: 2_000 });
    releaseLock(dead); assert.equal(existsSync(p.dir), true, 'the late release removed someone else\'s lock'); releaseLock(next); assert.equal(existsSync(p.dir), false);
  } finally { p.done(); }
});

test('L3. every writer registers', () => {
  const dir = new URL('../qa/e2e/', import.meta.url);
  const writers = readdirSync(dir).filter((f) => f.endsWith('.spec.ts')).filter((f) => /fetch\('\/api\/settings',\s*\{\s*method: 'PATCH'/.test(readFileSync(new URL(f, dir), 'utf8')));
  assert.ok(writers.length >= 8, `CONTROL: ${writers.length} writers found`);
  assert.deepEqual(writers.filter((f) => !/^\s*writesAccountA\(test\);/m.test(readFileSync(new URL(f, dir), 'utf8'))), []);
});
