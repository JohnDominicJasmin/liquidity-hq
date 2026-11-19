/* #2438 (U10): one user's usage block must never reach another user. The AI tool routes reserve a per-user use INSIDE the cached() miss; concurrent requests for one key share ONE in-flight loader, so when user A's loader
 * threw A's own block, user B (who joined the same promise and has quota) was handed A's rejection. cachedOwn retries a foreign block so B becomes the next loader.
 *   O1-O6  lib/apiCache.cachedOwn, REAL code, concurrent callers
 *   S1     the five routes use cachedOwn with the caller's id and throw RateLimitError with blockedUserId = the caller
 * WHAT IT CANNOT PROVE: the five routes end to end (they cannot be imported by the unit runner: their RateLimitError uses a TypeScript parameter property); the browser scenario of two accounts at one moment. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cached, cachedOwn } from '../lib/apiCache.ts';

class Block extends Error { blockedUserId?: string; constructor(uid?: string) { super('blocked'); this.blockedUserId = uid; } }
let n = 0; const key = () => `qa:own:${++n}`;
const tick = () => new Promise((r) => setImmediate(r));

test('O1. THE DEFECT: A (at the cap) and B (with quota) request one key together: A gets A\'s block, B gets an ANSWER and is the one who reserved', async () => {
  const k = key(); const reservedFor: string[] = [];
  const loaderFor = (uid: string, atCap: boolean) => async () => { await tick(); if (atCap) throw new Block(uid); reservedFor.push(uid); return `answer-for-${uid}`; };
  const [a, b] = await Promise.allSettled([cachedOwn('A', k, 60_000, loaderFor('A', true)), cachedOwn('B', k, 60_000, loaderFor('B', false))]);
  assert.equal(a.status, 'rejected'); assert.equal((a as PromiseRejectedResult).reason.blockedUserId, 'A', 'A did not get A\'s own block');
  assert.equal(b.status, 'fulfilled', 'B was handed A\'s block: B has quota and was refused with A\'s message'); assert.equal((b as PromiseFulfilledResult<string>).value, 'answer-for-B');
  assert.deepEqual(reservedFor, ['B'], 'the use was not charged to B (the one who got the answer)');
});
test('O2. the plain cached() has the defect (CONTROL: the same scenario hands A\'s block to B), so O1 measures the fix', async () => {
  const k = key();
  const [a, b] = await Promise.allSettled([
    cached(k, 60_000, async () => { await tick(); throw new Block('A'); }),
    cached(k, 60_000, async () => { await tick(); return 'answer-for-B'; }),
  ]);
  assert.equal(a.status, 'rejected'); assert.equal(b.status, 'rejected', 'CONTROL: cached() no longer shares the in-flight rejection, so the premise of #2438 changed');
});
test('O3. a block for the CALLER\'S OWN user is thrown to that caller (no retry), and a block carrying no user id is thrown as is', async () => {
  let calls = 0;
  await assert.rejects(cachedOwn('A', key(), 60_000, async () => { calls++; throw new Block('A'); }), (e: Block) => e.blockedUserId === 'A'); assert.equal(calls, 1, 'an own block was retried (A would reserve twice)');
  calls = 0;
  await assert.rejects(cachedOwn('A', key(), 60_000, async () => { calls++; throw new Block(undefined); }), /blocked/); assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(cachedOwn('A', key(), 60_000, async () => { calls++; throw new Error('upstream down'); }), /upstream down/); assert.equal(calls, 1, 'an ordinary failure was retried');
});
test('O4. at most TWO retries on a foreign block, then the block is thrown (no endless loop)', async () => {
  let calls = 0;
  await assert.rejects(cachedOwn('B', key(), 60_000, async () => { calls++; throw new Block('A'); }), (e: Block) => e.blockedUserId === 'A');
  assert.equal(calls, 3, 'expected the first call plus two retries');
});
test('O5. a cache HIT and a joiner of a SUCCESSFUL loader are untouched: one loader, no extra reservation', async () => {
  const k = key(); let loads = 0;
  const loader = async () => { loads++; await tick(); return 'ok'; };
  const [x, y] = await Promise.all([cachedOwn('A', k, 60_000, loader), cachedOwn('B', k, 60_000, loader)]);
  assert.deepEqual([x, y], ['ok', 'ok']); assert.equal(loads, 1, 'a joiner started its own loader');
  assert.equal(await cachedOwn('C', k, 60_000, loader), 'ok'); assert.equal(loads, 1, 'a cache hit loaded again');
});
test('O6. a failed loader caches nothing: the next caller loads again', async () => {
  const k = key(); let loads = 0;
  await assert.rejects(cachedOwn('A', k, 60_000, async () => { loads++; throw new Block('A'); }));
  assert.equal(await cachedOwn('B', k, 60_000, async () => { loads++; return 'fresh'; }), 'fresh'); assert.equal(loads, 2);
});

const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
test('S1. draw-structure, smc-snapshot, token-unlock, onchain and macro-context load through cachedOwn with the caller\'s id and throw their RateLimitError with blockedUserId = the caller', () => {
  for (const r of ['draw-structure', 'smc-snapshot', 'token-unlock', 'onchain', 'macro-context']) {
    const s = code(readFileSync(new URL(`../app/api/${r}/route.ts`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
    assert.ok(/cachedOwn\(authData\.user\.id, /.test(s), `${r}: does not load through cachedOwn with the caller's id (one user's block can reach another)`);
    assert.ok(/new RateLimitError\([^)]*, authData\.user\.id\)/.test(s), `${r}: its RateLimitError does not carry blockedUserId = the caller (the retry cannot tell whose block it is)`);
    assert.ok(s.includes('public blockedUserId?: string'), `${r}: RateLimitError lost blockedUserId`);
  }
});
