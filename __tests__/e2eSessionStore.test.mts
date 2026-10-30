/* The reuse POLICY behind the persisted e2e session cache (`qa/e2e/_sessionStore.ts`).
 *
 * WHY THIS IS WORTH A TEST AT ALL. Persisting a session is the one change in this area that the
 * existing code argues AGAINST: `signIn`'s own comment says a stale token across CI RUNS is the
 * failure mode to avoid, not a stale token within one. The whole safety of the change is therefore
 * in the bounds - the token's own expiry, a wall-clock cap independent of it, and refusing anything
 * malformed - and those bounds are pure functions, so they can be checked without a browser, a
 * network or a credential.
 *
 * WHAT IT DOES NOT COVER, said rather than implied: no sign-in happens here, no token is minted,
 * and nothing asserts that Supabase accepts a reused session. That needs credentials and a healthy
 * GoTrue, which is exactly what this change exists to depend on less often. What is proven here is
 * that a session is not reused OUTSIDE its bounds, which is the half that can be proven cheaply and
 * the half that silently rots if it is wrong. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  defaultStorePath, dropSession, getSession, isReusable, putSession, readStore, sessionKey,
  writeStore, type ReusePolicy, type StoredSession,
} from '../qa/e2e/_sessionStore.ts';

const POLICY: ReusePolicy = { marginSeconds: 120, maxAgeSeconds: 1800 };
const NOW = 1_762_000_000_000;

const session = (over: Partial<StoredSession> = {}): StoredSession => ({
  access_token: 'at',
  refresh_token: 'rt',
  expires_in: 3600,
  user: { id: 'u' },
  mintedAtMs: NOW,
  ...over,
});

/** A fresh file per cell, outside the repo. The real store lives under node_modules/.cache; a test
 *  that wrote there could clobber a session a developer is using in the same checkout. */
function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-session-store-'));
  return path.join(dir, 'sessions.json');
}

/* ── the bounds ───────────────────────────────────────────────────────────────────────────────── */

test('T1. a session just minted is reusable, and one past the token expiry minus the margin is not', () => {
  assert.equal(isReusable(session(), NOW, POLICY), true);
  /* THE EXPIRY BOUND IS MEASURED WITH THE CAP LIFTED, and the first version of this cell got that
   * wrong: at 3,479s the token is still inside 3600 - 120, but the 1,800s wall-clock cap has
   * already refused it, so asserting `true` there failed. **The two bounds are separate rules and a
   * cell that mixes them cannot say which one fired.** The cap gets its own cell below. */
  const noCap = { marginSeconds: 120, maxAgeSeconds: Infinity };
  // 3600 - 120 = 3480s is the cliff. One second inside, one second past.
  assert.equal(isReusable(session(), NOW + 3_479_000, noCap), true);
  assert.equal(isReusable(session(), NOW + 3_481_000, noCap), false);
  // And with the real policy both are refused, because the cap is stricter.
  assert.equal(isReusable(session(), NOW + 3_479_000, POLICY), false);
});

test('T2. the WALL-CLOCK CAP bites before the token does, which is the whole point of having it', () => {
  /* A Supabase access token lives about an hour; the cap is 30 minutes. So the cap - not the token -
   * is what ends reuse in normal operation. This is the cell that would fail if someone "simplified"
   * the policy down to the token's own expiry, which is the state `signIn`'s comment warns about:
   * the token stays cryptographically valid while the fixture's plan, profile or entitlement moves
   * underneath it. */
  const s = session({ expires_in: 3600 });
  assert.equal(isReusable(s, NOW + 1_799_000, POLICY), true);
  assert.equal(isReusable(s, NOW + 1_801_000, POLICY), false);
  // And with no cap, the same session at the same moment WOULD be reused - so the cap is doing it.
  assert.equal(isReusable(s, NOW + 1_801_000, { marginSeconds: 120, maxAgeSeconds: Infinity }), true);
});

test('T3. a clock that moved BACKWARDS refuses reuse rather than passing every bound', () => {
  /* `age` would be negative, and every `age < x` comparison would then be true - so a store written
   * by a machine whose clock is ahead, or read after a clock correction, would look permanently
   * fresh. The explicit `age < 0` check is what this asserts; without it this cell is the only
   * thing that would have caught it. */
  assert.equal(isReusable(session(), NOW - 60_000, POLICY), false);
});

test('T4. a malformed or empty entry is not reusable, field by field', () => {
  assert.equal(isReusable(undefined, NOW, POLICY), false);
  assert.equal(isReusable(session({ access_token: '' }), NOW, POLICY), false);
  assert.equal(isReusable(session({ access_token: undefined as unknown as string }), NOW, POLICY), false);
  assert.equal(isReusable(session({ mintedAtMs: NaN }), NOW, POLICY), false);
  assert.equal(isReusable(session({ mintedAtMs: undefined as unknown as number }), NOW, POLICY), false);
  assert.equal(isReusable(session({ expires_in: NaN }), NOW, POLICY), false);
  assert.equal(isReusable(session({ expires_in: undefined as unknown as number }), NOW, POLICY), false);
});

/* ── the key ──────────────────────────────────────────────────────────────────────────────────── */

test('T5. the key carries the PROJECT as well as the email, so a token cannot cross projects', () => {
  const dev = sessionKey('https://wdtjhrilakoitfcezxpx.supabase.co', 'a@example.test');
  const prod = sessionKey('https://qdpwhnvmhqgzijuwopso.supabase.co', 'a@example.test');
  assert.notEqual(dev, prod, 'the same email on two projects must not share a stored session');
  assert.match(dev, /^wdtjhrilakoitfcezxpx:/);
  /* Email case and padding are normalised the same way `normalizeCoinId` does it elsewhere: the
   * fixture files and the environment disagree about case more often than anyone expects. */
  assert.equal(sessionKey('https://x.supabase.co', ' A@Example.TEST '), sessionKey('https://x.supabase.co', 'a@example.test'));
  /* A URL that does not parse must not throw - it would turn a config typo into a crash in the
   * middle of a suite rather than a sign-in that fails with a readable message. */
  assert.equal(sessionKey('not a url', 'a@example.test'), 'unknown:a@example.test');
});

/* ── the file ─────────────────────────────────────────────────────────────────────────────────── */

test('T6. a missing, unreadable or corrupt store reads as EMPTY rather than throwing', () => {
  /* The caller's fallback is to mint, so an unusable cache must degrade to "no cache". A throw here
   * would take down a suite over an optimisation. */
  assert.deepEqual(readStore(path.join(os.tmpdir(), 'qa-session-store-does-not-exist', 'x.json')), {});
  const f = tmpFile();
  fs.writeFileSync(f, '{ this is not json');
  assert.deepEqual(readStore(f), {});
  fs.writeFileSync(f, '["an array, not an object"]');
  assert.deepEqual(readStore(f), {}, 'an array must not be returned as a store');
  fs.writeFileSync(f, 'null');
  assert.deepEqual(readStore(f), {});
});

test('T7. a write round-trips, and putSession merges rather than replacing the file', () => {
  const f = tmpFile();
  putSession(f, 'ref:a@example.test', session({ access_token: 'first' }));
  putSession(f, 'ref:b@example.test', session({ access_token: 'second' }));
  const store = readStore(f);
  assert.deepEqual(Object.keys(store).sort(), ['ref:a@example.test', 'ref:b@example.test']);
  assert.equal(store['ref:a@example.test'].access_token, 'first', 'the second write dropped the first key');
  assert.equal(getSession(f, 'ref:a@example.test', NOW, POLICY)?.access_token, 'first');
});

test('T8. getSession applies the policy - a stored-but-expired entry reads as null', () => {
  const f = tmpFile();
  putSession(f, 'k', session());
  assert.notEqual(getSession(f, 'k', NOW, POLICY), null);
  assert.equal(getSession(f, 'k', NOW + 1_801_000, POLICY), null, 'past the cap');
  /* And the entry is STILL THERE - the expired read must not delete it, because its refresh token
   * outlives its access token and the caller tries that next. */
  assert.notEqual(readStore(f)['k'], undefined);
  assert.equal(readStore(f)['k'].refresh_token, 'rt');
});

test('T9. dropSession removes one key and leaves the rest', () => {
  const f = tmpFile();
  putSession(f, 'keep', session({ access_token: 'keep' }));
  putSession(f, 'drop', session({ access_token: 'drop' }));
  dropSession(f, 'drop');
  assert.deepEqual(Object.keys(readStore(f)), ['keep']);
  dropSession(f, 'not-present');   // must not throw or empty the store
  assert.deepEqual(Object.keys(readStore(f)), ['keep']);
});

test('T10. the default path is inside node_modules/.cache, which is gitignored and wiped by npm ci', () => {
  /* THE SECURITY-RELEVANT ASSERTION IN THIS FILE. The stored file holds access tokens, and an
   * access token is a bearer credential - possession is sufficient. So the location must be one no
   * PR can carry and no artifact picks up by accident. `node_modules` is gitignored in this repo,
   * and `npm ci` deletes it, which also scopes the file to a single CI job by construction. */
  const p = defaultStorePath('/repo');
  assert.equal(p.split(path.sep).join('/'), '/repo/node_modules/.cache/qa-e2e-sessions.json');
  const ignore = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /^\/?node_modules\/?$/m, 'node_modules is not gitignored - the store would be committable');
});

test('T11. the file is written 0600, so a readable directory does not make the token readable', (t) => {
  /* Skipped rather than asserted on Windows: NTFS does not carry POSIX mode bits and `fs.stat`
   * reports 0666 whatever was requested, so this would pass vacuously there - which is worse than
   * not running it, because it would read as coverage. */
  if (process.platform === 'win32') {
    t.skip('POSIX mode bits are not meaningful on win32 - this would pass vacuously');
    return;
  }
  const f = tmpFile();
  writeStore(f, { k: session() });
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});
