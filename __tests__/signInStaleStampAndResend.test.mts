/* #2440: a brand-new session is not signed out for a stale activity stamp (#3); an unconfirmed email gets a clear message and a resend action (#10).
 *   S1-S4  isSessionExpired runs as the REAL function: it is SLICED out of components/AuthProvider.tsx, type-stripped and executed with a fake localStorage and clock, so no second copy of the rule exists here.
 *          A session created AFTER the stamp is never expired; an OLD session with a stale stamp is; a fresh stamp is not; a missing stamp lets Supabase decide
 *   E1-E2  lib/authErrors: isEmailNotConfirmed and the message (real functions)
 *   R1     the login page: the resend button exists only when the sign-in failed as unconfirmed, sends auth.resend({type:'signup'}) once (disabled while sending / after sent), and shows sent / failed copy
 *   K1     the three label keys have English text and are registered
 * The sign-in-by-magic-link scenario itself is a browser run (needs a real session whose last_sign_in_at is newer than a stale stamp). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { friendlyAuthError, isEmailNotConfirmed } from '../lib/authErrors.ts';
import { INACTIVITY_MS, LAST_ACTIVE_KEY } from '../lib/authSession.ts';

/* Cast rather than a named import: stripTypeScriptTypes is experimental and this repo's @types/node does not declare it (TS2305), though it exists at runtime (same pattern as libStrippable.test.mts). */
const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (source: string) => string }).stripTypeScriptTypes;

const AUTH = readFileSync(new URL('../components/AuthProvider.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const a = AUTH.indexOf('function isSessionExpired('); assert.ok(a >= 0, 'CONTROL: isSessionExpired not found');
const fnText = AUTH.slice(a, AUTH.indexOf('\n}\n', a) + 3);
/* The slice is OUR OWN checked-in source, never input: evaluating it in a test is not an injection path. */
const make = (store: Record<string, string>, now: number) => {
  const wrapper = `${fnText}\nreturn isSessionExpired;`;
  const build = new Function(`return (${stripTypeScriptTypes(`function mk(localStorage: any, LAST_ACTIVE_KEY: string, INACTIVITY_MS: number, Date: any) {\n${wrapper}\n}`)});`)() as (ls: unknown, k: string, ms: number, d: unknown) => (s?: string | null) => boolean;
  const fakeDate = { now: () => now, parse: (s: string) => Date.parse(s) };
  return build({ getItem: (k: string) => store[k] ?? null }, LAST_ACTIVE_KEY, INACTIVITY_MS, fakeDate);
};
const NOW = Date.parse('2026-11-17T12:00:00Z'), DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();

test('S1. THE DEFECT: a stamp 10 days old and a session created just now (magic link / Google / confirm email) is NOT expired', () => {
  const expired = make({ [LAST_ACTIVE_KEY]: String(NOW - 10 * DAY) }, NOW);
  assert.equal(expired(iso(NOW - 5_000)), false, 'a brand-new session was signed out for a stale stamp: the user has to request another link');
});
test('S2. an OLD session (signed in 20 days ago) with a 10-day-old stamp IS expired', () => {
  const expired = make({ [LAST_ACTIVE_KEY]: String(NOW - 10 * DAY) }, NOW);
  assert.equal(expired(iso(NOW - 20 * DAY)), true, 'the inactivity expiry stopped working for a genuinely old session');
});
test('S3. a fresh stamp (1 hour old) is not expired, whatever the sign-in time; an unknown sign-in time falls back to the stamp alone', () => {
  const e = make({ [LAST_ACTIVE_KEY]: String(NOW - 3_600_000) }, NOW);
  assert.equal(e(iso(NOW - 30 * DAY)), false); assert.equal(e(null), false); assert.equal(e(undefined), false);
  const stale = make({ [LAST_ACTIVE_KEY]: String(NOW - 10 * DAY) }, NOW);
  assert.equal(stale(null), true, 'no sign-in time + stale stamp must still expire'); assert.equal(stale('garbage'), true, 'an unparseable sign-in time must not rescue a stale stamp');
});
test('S4. no stored stamp (first visit or cleared) lets Supabase decide: never expired', () => {
  assert.equal(make({}, NOW)(iso(NOW - 30 * DAY)), false);
});
test('S5. the window is 7 days: a stamp 6.9 days old is open, 7.1 days is expired (for a session that predates it)', () => {
  assert.equal(INACTIVITY_MS, 7 * DAY);
  assert.equal(make({ [LAST_ACTIVE_KEY]: String(NOW - 6.9 * DAY) }, NOW)(iso(NOW - 30 * DAY)), false);
  assert.equal(make({ [LAST_ACTIVE_KEY]: String(NOW - 7.1 * DAY) }, NOW)(iso(NOW - 30 * DAY)), true);
});

test('E1. isEmailNotConfirmed matches GoTrue\'s message (any case) and nothing else', () => {
  assert.equal(isEmailNotConfirmed('Email not confirmed'), true); assert.equal(isEmailNotConfirmed('email NOT confirmed '), true);
  for (const other of ['Invalid login credentials', 'User banned', 'Email rate limit exceeded', '']) assert.equal(isEmailNotConfirmed(other), false, other);
});
test('E2. the unconfirmed message says what to do (confirm, check the inbox, resend) and does not show GoTrue\'s raw text; other messages keep their copy', () => {
  const m = friendlyAuthError('Email not confirmed');
  assert.match(m, /confirm your email/i); assert.match(m, /resend/i); assert.doesNotMatch(m, /not confirmed/i);
  assert.match(friendlyAuthError('User is banned'), /suspended/i, 'the ban copy was lost');
});

const LOGIN = readFileSync(new URL('../app/(main)/login/page.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
test('R1. the resend action: shown only after an unconfirmed failure, sends auth.resend({type:"signup"}) to the typed address, disabled while sending and after sent, three states of copy', () => {
  assert.ok(LOGIN.includes('setNeedsConfirm(isEmailNotConfirmed(error.message));'), 'the button is not tied to the unconfirmed failure');
  assert.ok(LOGIN.includes('{needsConfirm && ('), 'the button shows without an unconfirmed failure');
  assert.ok(LOGIN.includes("sb.auth.resend({ type: 'signup', email: pwEmail.trim(),"), 'the resend call changed (type, or the address)');
  assert.ok(LOGIN.includes("disabled={resendState === 'sending' || resendState === 'sent'}"), 'a second click can send a second email');
  assert.ok(LOGIN.includes("setResendState(error ? 'failed' : 'sent');"), 'the result is not reflected');
  assert.ok(LOGIN.includes('data-testid="login-resend-confirmation"'), 'the test id is gone');
  for (const k of ['LOGIN_RESEND_CONFIRM_BUTTON', 'LOGIN_RESEND_CONFIRM_SENT', 'LOGIN_RESEND_CONFIRM_FAILED']) assert.ok(LOGIN.includes(`t('${k}')`), `${k} is not rendered`);
});
test('K1. the three resend keys have English text', () => {
  const en = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;
  for (const k of ['LOGIN_RESEND_CONFIRM_BUTTON', 'LOGIN_RESEND_CONFIRM_SENT', 'LOGIN_RESEND_CONFIRM_FAILED']) assert.ok((en[k] ?? '').length > 5, `${k} has no English text`);
});
