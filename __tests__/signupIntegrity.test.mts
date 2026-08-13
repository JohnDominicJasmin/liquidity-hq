import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyWelcomeClaim, missingRowReport } from '../lib/signupIntegrity.ts';

/* #127. The trigger works today - verified on both projects 2026-08-08. This
 * covers what happens if it ever stops.
 *
 * A signup that produces no `user_subscriptions` row gives the user no 14-day
 * trial, and `getEntitlement()` reads the missing row as `free` - correctly,
 * and identically to a trial that ended. So the account is silently downgraded
 * from the first second, the symptom is a customer who does not convert, and
 * nothing in the product, the logs or the UI distinguishes it.
 *
 * The welcome-email route is the only path every signup takes that already
 * reads that row. It could not tell the two silences apart: both "email already
 * sent" and "no row at all" produced `{ ok: true, sent: false }`.
 */

test('the two silences are told apart', async (t) => {
  await t.test('a claimed row means send the email', () => {
    assert.equal(classifyWelcomeClaim(true, true), 'send');
  });

  await t.test('unclaimed but present is the ordinary repeat call', () => {
    assert.equal(classifyWelcomeClaim(false, true), 'already-sent');
  });

  /* The one this exists for. Before the split, this returned the same thing as
     the case above and the difference was unobservable. */
  await t.test('unclaimed and absent is the defect, not a no-op', () => {
    assert.equal(classifyWelcomeClaim(false, false), 'missing-subscription-row');
  });

  /* `claimed` implies the row exists - you cannot update a row that is not
     there - so this combination should never occur. It must still not report a
     missing row, because reporting one would send someone hunting a trigger
     that fired correctly. */
  await t.test('an impossible combination does not raise a false alarm', () => {
    assert.equal(classifyWelcomeClaim(true, false), 'send');
  });
});

test('the report says what to do about it', async (t) => {
  const report = missingRowReport('11111111-2222-4333-8444-555555555555');

  /* A GlitchTip issue is read by someone with no context, months later. The
     failure this guards is silent, so the message has to carry its own
     diagnosis - the trigger name, the consequence, and that it may not be one
     account. */
  await t.test('it names the trigger, the consequence and the issue', () => {
    assert.match(report, /lhq_grant_signup_trial/);
    assert.match(report, /NO 14-day trial/);
    assert.match(report, /#127/);
  });

  await t.test('it carries the user id so it is actionable', () => {
    assert.match(report, /11111111-2222-4333-8444-555555555555/);
  });
});

/* The classifier is only worth anything if the route uses it. Comments stripped
   first - this is the fifth suite in this repo to scan source, and the previous
   four each passed a mutation on their own prose before that was added. */
test('the route reports rather than swallowing the missing row', () => {
  const src = readFileSync(
    new URL('../app/api/auth/welcome-email/route.ts', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  assert.match(src, /classifyWelcomeClaim/,
    'the route no longer classifies the claim - the two silences are collapsed again');
  assert.match(src, /missingRowReport/,
    'the route no longer reports a missing subscription row');
  assert.match(src, /apiError\([^)]*missingRowReport/,
    'the missing row is classified but not reported anywhere, which is the original defect');
});
