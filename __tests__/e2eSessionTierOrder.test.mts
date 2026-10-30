/* THE TIER ORDER ITSELF, with a stand-in for the network and no credentials.
 *
 * `e2eSessionStore.test.mts` proves the reuse POLICY - the bounds a stored session must pass. It
 * says nothing about whether `_auth.ts` actually consults the store, in what order, or how many
 * requests a run makes. That wiring is the change: memory, then disk, then a REFRESH grant, then
 * the password grant.
 *
 * WHY IT CAN BE TESTED AT ALL WITHOUT CREDENTIALS. The only thing `getOrMintSession` needs from the
 * outside is `fetch`, so the whole tier order is observable by counting the requests a stand-in
 * receives. The environment is set BEFORE the module is imported, because `_auth.ts` reads it at
 * module scope and a later assignment would be invisible to it.
 *
 * NO REAL HOST IS CONTACTED. The Supabase URL is a `.invalid` hostname - reserved by RFC 2606 and
 * guaranteed not to resolve - and the stand-in `fetch` throws on any URL it does not recognise, so
 * a request escaping this file fails the test rather than leaving the machine.
 *
 * WHAT IT STILL DOES NOT PROVE, and the PR says so too: that Supabase accepts a reused session.
 * That needs a credentialed run against a healthy GoTrue, which is the thing this change exists to
 * need less often. Here the assertion is about which requests are MADE, not about what a real
 * server would answer. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SUPABASE = 'https://proj-ref.supabase.invalid';
const EMAIL = 'tier-order@liquidityhq.test';
const PASSWORD = 'not-a-real-password';

function storeFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-tier-order-')), 'sessions.json');
}

/** Counts what it was asked for and answers plausibly. Anything unrecognised THROWS - a request
 *  that escapes this stand-in must fail the cell, never silently succeed. */
function standInFetch() {
  const calls: string[] = [];
  const fn = async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    if (url.startsWith(`${SUPABASE}/auth/v1/token?grant_type=password`)) {
      calls.push('password');
      return new Response(JSON.stringify({
        access_token: 'minted-by-password', refresh_token: 'rt-1', expires_in: 3600, user: { id: 'u' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith(`${SUPABASE}/auth/v1/token?grant_type=refresh_token`)) {
      calls.push('refresh');
      const sent = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      if (sent.refresh_token !== 'rt-stored') {
        /* A refresh with the wrong token must look like a server refusal, not like a pass. */
        return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      }
      return new Response(JSON.stringify({
        access_token: 'minted-by-refresh', refresh_token: 'rt-2', expires_in: 3600, user: { id: 'u' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`a request escaped the stand-in: ${url}`);
  };
  return { calls, fn };
}

/** Fresh module instance per cell: `_auth.ts` holds its in-memory cache and its env-derived
 *  constants at module scope, so two cells sharing one instance would share tier 1 and the second
 *  would measure nothing. The query string is what defeats the module cache. */
async function freshAuth(file: string, extra: Record<string, string> = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-placeholder';
  process.env.E2E_USER_A_EMAIL = EMAIL;
  process.env.E2E_USER_A_PASSWORD = PASSWORD;
  process.env.QA_SESSION_STORE = file;
  delete process.env.QA_SESSION_PERSIST;
  delete process.env.QA_SESSION_MAX_AGE_SECONDS;
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;
  return import(`../qa/e2e/_auth.ts?tier=${Math.random()}`);
}

const stored = (over: Record<string, unknown> = {}) => ({
  access_token: 'from-the-store',
  refresh_token: 'rt-stored',
  expires_in: 3600,
  user: { id: 'u' },
  mintedAtMs: Date.now(),
  ...over,
});

const KEY = `proj-ref:${EMAIL}`;

test('U1. a usable stored session means ZERO auth requests - the whole point of the change', async () => {
  const file = storeFile();
  fs.writeFileSync(file, JSON.stringify({ [KEY]: stored() }));
  const net = standInFetch();
  const real = globalThis.fetch;
  globalThis.fetch = net.fn as typeof fetch;
  try {
    const auth = await freshAuth(file);
    const token = await auth.signIn(EMAIL, PASSWORD);
    assert.equal(token, 'from-the-store', 'the stored session was not used');
    assert.deepEqual(net.calls, [], `expected no auth request, got: ${net.calls.join(', ')}`);
  } finally { globalThis.fetch = real; }
});

test('U2. an EXPIRED stored session is refreshed, with no password grant', async () => {
  /* The bound that matters is the wall-clock cap, so "expired" here is a session minted 40 minutes
   * ago with an hour of life left - still cryptographically valid, past the cap. That is the
   * ordinary case, not an edge one: it is what every run after the first looks like. */
  const file = storeFile();
  fs.writeFileSync(file, JSON.stringify({ [KEY]: stored({ mintedAtMs: Date.now() - 40 * 60_000 }) }));
  const net = standInFetch();
  const real = globalThis.fetch;
  globalThis.fetch = net.fn as typeof fetch;
  try {
    const auth = await freshAuth(file);
    const token = await auth.signIn(EMAIL, PASSWORD);
    assert.equal(token, 'minted-by-refresh');
    assert.deepEqual(net.calls, ['refresh'], 'the password grant must not be reached when a refresh works');
    /* And the refreshed session replaced the stored one, so the next run starts from the new token
       rather than refreshing the same dead one forever. */
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(after[KEY].access_token, 'minted-by-refresh');
    assert.equal(after[KEY].refresh_token, 'rt-2');
  } finally { globalThis.fetch = real; }
});

test('U3. a REJECTED refresh falls through to the password grant and drops the dead entry', async () => {
  const file = storeFile();
  fs.writeFileSync(file, JSON.stringify({
    [KEY]: stored({ mintedAtMs: Date.now() - 40 * 60_000, refresh_token: 'rt-expired' }),
  }));
  const net = standInFetch();
  const real = globalThis.fetch;
  globalThis.fetch = net.fn as typeof fetch;
  try {
    const auth = await freshAuth(file);
    const token = await auth.signIn(EMAIL, PASSWORD);
    assert.equal(token, 'minted-by-password');
    assert.deepEqual(net.calls, ['refresh', 'password'], 'both tiers must be attempted, in that order');
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(after[KEY].access_token, 'minted-by-password', 'the freshly minted session was not stored');
  } finally { globalThis.fetch = real; }
});

test('U4. an EMPTY store means exactly one password grant, and the result is persisted', async () => {
  const file = storeFile();
  const net = standInFetch();
  const real = globalThis.fetch;
  globalThis.fetch = net.fn as typeof fetch;
  try {
    const auth = await freshAuth(file);
    assert.equal(await auth.signIn(EMAIL, PASSWORD), 'minted-by-password');
    /* Tier 1 covers the second call within the process - this is the #949/#1025 behaviour, asserted
       here so the new tiers cannot be read as having replaced it. */
    assert.equal(await auth.signIn(EMAIL, PASSWORD), 'minted-by-password');
    assert.deepEqual(net.calls, ['password'], 'the in-process cache stopped working');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[KEY].access_token, 'minted-by-password');
  } finally { globalThis.fetch = real; }
});

test('U5. QA_SESSION_PERSIST=0 ignores the store entirely - the one-variable escape hatch', async () => {
  /* THE DIAGNOSTIC THAT HAS TO WORK. If a stored session ever makes a spec behave oddly, the first
   * step is to take persistence out of the picture - so this must not read the file AND must not
   * write it. A half-disabled cache is worse than either state. */
  const file = storeFile();
  fs.writeFileSync(file, JSON.stringify({ [KEY]: stored() }));
  const net = standInFetch();
  const real = globalThis.fetch;
  globalThis.fetch = net.fn as typeof fetch;
  try {
    const auth = await freshAuth(file, { QA_SESSION_PERSIST: '0' });
    assert.equal(await auth.signIn(EMAIL, PASSWORD), 'minted-by-password', 'the store was consulted while disabled');
    assert.deepEqual(net.calls, ['password']);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[KEY].access_token, 'from-the-store',
      'the store was WRITTEN while persistence was disabled');
  } finally { globalThis.fetch = real; }
});

test('U6. a session for ANOTHER project is not reused, even with the same email', async () => {
  /* The key carries the project ref. A token minted against a different Supabase project would be
   * rejected by the app, and the failure would read as a broken account rather than a wrong key. */
  const file = storeFile();
  fs.writeFileSync(file, JSON.stringify({ [`other-ref:${EMAIL}`]: stored() }));
  const net = standInFetch();
  const real = globalThis.fetch;
  globalThis.fetch = net.fn as typeof fetch;
  try {
    const auth = await freshAuth(file);
    assert.equal(await auth.signIn(EMAIL, PASSWORD), 'minted-by-password');
    assert.deepEqual(net.calls, ['password'], "another project's session was reused");

    /* AND THE NEW ENTRY MUST BE KEYED BY THIS PROJECT, which is the half the first version of this
     * cell was missing. Refusing to reuse `other-ref:<email>` is satisfied by ANY key shape - the
     * mutation control proved it: keying by the bare email made four other cells red and left this
     * one green, so it was passing for a reason unrelated to the project ref. Asserting where the
     * mint LANDED is what actually pins the key's shape. */
    const keys = Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')));
    assert.ok(
      keys.includes(KEY),
      `the minted session was not stored under this project's key. keys: ${keys.join(', ')}`,
    );
    assert.ok(keys.includes(`other-ref:${EMAIL}`), "the other project's entry was destroyed");
  } finally { globalThis.fetch = real; }
});
