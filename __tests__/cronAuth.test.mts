/* The gate in front of every scheduled write route (#757).
 *
 * `checkCronAuth` guards `news/ingest`, `telegram/alert`, `macro-alert`,
 * `signals/track`, `alert-outcomes/resolve` and `telegram/setup-webhook` — every
 * route that writes on a schedule with no user session behind it. On a public
 * repository it is the difference between a cron endpoint and an open one.
 *
 * It had no tests. It was rewritten once already, from a fail-OPEN shape where
 * `if (secret) { check }` meant an unset `CRON_SECRET` ran every one of those
 * routes unauthenticated.
 *
 * WHY THIS FILE EXISTS NOW. #757 asked why no non-prod environment receives
 * news. Measured on the deployed services:
 *
 *   qa       /api/version  configured.cronSecret = false   unsigned POST -> 401
 *   staging  /api/version  configured.cronSecret = true    unsigned POST -> 401
 *
 * The two 401s look identical and mean opposite things. On staging it is a
 * gate refusing an unsigned caller. On qa there is no secret configured, so
 * `checkCronAuth` denies EVERYONE — including a correctly signed scheduler.
 * The ingest route cannot run there at all, and that is a configuration fact
 * rather than a missing feature.
 *
 * These tests pin the behaviour that makes that true, so a future "make it
 * work on qa" change cannot quietly reintroduce fail-open.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCronAuth } from '../lib/cronAuth.ts';

const SECRET = 'a-test-cron-secret';
const original = process.env.CRON_SECRET;

function withSecret<T>(value: string | undefined, fn: () => T): T {
  if (value === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = value;
  try { return fn(); } finally {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  }
}

const req = (init: { header?: string; query?: string } = {}) => {
  const url = init.query === undefined
    ? 'https://example.test/api/news/ingest'
    : `https://example.test/api/news/ingest?secret=${encodeURIComponent(init.query)}`;
  return new Request(url, {
    method: 'POST',
    headers: init.header === undefined ? {} : { 'x-cron-secret': init.header },
  });
};

test('an unset CRON_SECRET denies everyone, including a correct caller', () => {
  /* THE qa CASE. This is not a hypothetical: /api/version reports
     configured.cronSecret = false on liquidity-hq-qa today, so its ingest route
     401s every request and no news can reach that environment by any path.
     The previous implementation returned TRUE here — `if (secret) { check }`
     with no secret skipped the check entirely and ran the route. */
  withSecret(undefined, () => {
    assert.equal(checkCronAuth(req({ header: SECRET })), false);
    assert.equal(checkCronAuth(req({})), false);
    assert.equal(checkCronAuth(req({ query: SECRET })), false);
  });
});

test('an empty CRON_SECRET is unset, not a secret equal to empty', () => {
  /* What an env var declared-but-blank in a Render dashboard produces. A
     length-only comparison would match a caller sending no header at all. */
  withSecret('', () => {
    assert.equal(checkCronAuth(req({})), false);
    assert.equal(checkCronAuth(req({ header: '' })), false);
  });
});

test('the matching secret is accepted from the header', () => {
  withSecret(SECRET, () => {
    assert.equal(checkCronAuth(req({ header: SECRET })), true);
  });
});

test('the matching secret is accepted from the query string', () => {
  /* Both forms are live: cron-job.org jobs send the header, and the query
     param exists for schedulers that cannot set one. Dropping either silently
     stops a live job. */
  withSecret(SECRET, () => {
    assert.equal(checkCronAuth(req({ query: SECRET })), true);
  });
});

test('a wrong secret is rejected however it arrives', () => {
  withSecret(SECRET, () => {
    assert.equal(checkCronAuth(req({ header: 'wrong' })), false);
    assert.equal(checkCronAuth(req({ query: 'wrong' })), false);
    assert.equal(checkCronAuth(req({})), false);
  });
});

test('a prefix of the real secret is rejected', () => {
  /* The length check runs before timingSafeEqual, which throws on unequal
     lengths. A caller probing one character at a time must not be able to tell
     "right so far" from "wrong" by the response. */
  withSecret(SECRET, () => {
    assert.equal(checkCronAuth(req({ header: SECRET.slice(0, -1) })), false);
    assert.equal(checkCronAuth(req({ header: SECRET + 'x' })), false);
  });
});

test('the header wins over the query string', () => {
  /* Not a security property, a predictability one: a scheduler that sends both
     must not depend on which the implementation happens to read first. */
  withSecret(SECRET, () => {
    const both = new Request(`https://example.test/x?secret=wrong`, {
      method: 'POST', headers: { 'x-cron-secret': SECRET },
    });
    assert.equal(checkCronAuth(both), true);
  });
});

test('CONTROL: the gate can return true, so the refusals above mean something', () => {
  /* Nine assertions in this file expect false. A function stuck on false
     satisfies every one of them and would also break every scheduled job in
     production — silently, because a cron failure is invisible until someone
     notices the data stopped. */
  withSecret(SECRET, () => {
    assert.equal(checkCronAuth(req({ header: SECRET })), true);
    assert.equal(checkCronAuth(req({ query: SECRET })), true);
  });
});

test('CONTROL: the environment is restored between tests', () => {
  /* These tests mutate process.env. If the restore leaks, a later test file
     runs against a secret this one set, and the failure lands somewhere
     unrelated. */
  assert.equal(process.env.CRON_SECRET, original);
});
