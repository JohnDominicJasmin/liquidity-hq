import test from 'node:test';
import assert from 'node:assert/strict';
import * as Sentry from '@sentry/node';
import { monitoringOptions } from '../lib/monitoring.ts';

/* Does the scrubber actually run on a real event, inside the real SDK?
 *
 * `monitoringScrub.test.mts` calls `scrubEvent()` directly — 15 tests, all
 * passing, and none of them prove the function is WIRED. Issue #72 is precisely
 * that gap: the scrubber has never been observed running on an event the SDK
 * built and was about to send.
 *
 * It was recorded as "blocked by the GlitchTip quota" for days. That was wrong,
 * and it was my mistake: `beforeSend` runs client-side, before transmission, so
 * a 429 rejects the DELIVERY and says nothing about whether scrubbing happened.
 * Nothing was ever blocked.
 *
 * A stub transport captures the envelope at the same point the network would,
 * so this needs no DSN that resolves, no quota, and no browser. */

type Captured = { event?: Record<string, unknown> };

/** Stands in for the HTTP transport. Returns the envelope instead of sending. */
function stubTransport(captured: Captured) {
  return () => ({
    send: async (envelope: unknown) => {
      // envelope = [headers, [[itemHeader, payload], ...]]
      const items = (envelope as [unknown, [unknown, Record<string, unknown>][]])[1] ?? [];
      for (const [, payload] of items) {
        if (payload && typeof payload === 'object') captured.event = payload;
      }
      return {};
    },
    flush: async () => true,
  });
}

const EMAIL = 'victim@example.test';
const TOKEN = 'sb-abcdef-auth-token';
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP';
const ORDINARY = 'retrying in 5 seconds after upstream timeout';

test('the scrubber runs inside the real SDK pipeline', async (t) => {
  const savedDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const savedApp = process.env.NEXT_PUBLIC_APP_ENV;
  process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://key@example.invalid/1';
  process.env.NEXT_PUBLIC_APP_ENV = 'prod';

  const captured: Captured = {};
  const client = new Sentry.NodeClient({
    ...monitoringOptions(),
    dsn: 'https://key@example.invalid/1',
    transport: stubTransport(captured),
    stackParser: Sentry.defaultStackParser,
    integrations: [],
  });
  const scope = new Sentry.Scope();
  scope.setClient(client);

  scope.setUser({ id: 'u1', email: EMAIL, ip_address: '203.0.113.9', username: 'victim' });

  /* An implicit-flow OAuth callback, the real shape. This app reverted PKCE on
   * 2026-07-20, so Supabase returns the session in the URL FRAGMENT - and the
   * browser SDK reports `window.location.href`, fragment included.
   *
   * A fragment never reaches a server, so no API-side test can see this. The
   * envelope captured at the transport is the only place it is observable. */
  scope.addBreadcrumb({
    category: 'navigation',
    data: { to: `https://liquidity-hq.com/auth/callback#access_token=${JWT}&refresh_token=v1.MRq8` },
  });
  scope.captureException(new Error(`checkout failed for ${EMAIL} with ${TOKEN} - ${ORDINARY}`));
  await client.flush(2000);

  const event = captured.event;

  /* POSITIVE CONTROL FIRST. Every assertion below is about something being
   * ABSENT, and absence is also what a transport that captured nothing looks
   * like. Without this, a broken stub reports a perfectly clean scrub. */
  await t.test('an event was actually captured (guards against a vacuous pass)', () => {
    assert.ok(event, 'the stub transport captured nothing - every assertion below would pass trivially');
    assert.ok(JSON.stringify(event).length > 100, 'captured something, but it is not a real event payload');
  });

  await t.test('the error still arrives - a scrubber that removes everything is useless', () => {
    const serialised = JSON.stringify(event);
    assert.match(serialised, /checkout failed/, 'the message was destroyed, not scrubbed');
    assert.ok((event as { exception?: unknown }).exception, 'the exception itself was dropped');
  });

  await t.test('the user email and ip never leave the process', () => {
    const serialised = JSON.stringify(event);
    assert.doesNotMatch(serialised, new RegExp(EMAIL.replace('.', '\\.')), 'user email survived the pipeline');
    assert.doesNotMatch(serialised, /203\.0\.113\.9/, 'ip address survived the pipeline');
    assert.doesNotMatch(serialised, /victim/, 'username survived the pipeline');
  });

  /* INVERTED 2026-08-08 after #143 landed. This assertion previously recorded
   * that the token SURVIVED, and its failure message said
   * `#72 has been fixed, invert this assertion` - which is what happened. A
   * characterisation test that cannot tell you it has become obsolete rots into
   * a wrong assertion nobody questions. */
  await t.test('an auth token in an error message is redacted', () => {
    assert.doesNotMatch(JSON.stringify(event), /sb-abcdef-auth-token/, 'an auth token survived inside the error message');
  });

  /* THE ONE ONLY THIS TEST CAN PROVE.
   *
   * `scrubUrl` dropping the fragment is verifiable in isolation by a unit test.
   * That it is WIRED - that a real breadcrumb built by the SDK passes through
   * it before the envelope leaves - is only observable here, at the transport. */
  await t.test('an OAuth callback fragment never reaches the envelope', () => {
    const serialised = JSON.stringify(event);
    assert.doesNotMatch(serialised, /eyJhbGciOi/, 'an access token survived in a breadcrumb URL fragment');
    assert.doesNotMatch(serialised, /refresh_token/, 'a refresh token survived in a breadcrumb URL fragment');
    assert.match(serialised, /auth\/callback/, 'the path was destroyed too - the breadcrumb is now useless for debugging');
  });

  /* OVER-REDACTION IS THE REAL COST OF #143, and unit tests cannot rule it out.
   *
   * A pattern broad enough to catch every credential also catches version
   * strings, hashes and ids. If this fails, the fix is a one-line narrowing -
   * not a wider allowlist. */
  await t.test('ordinary prose is left alone', () => {
    assert.match(JSON.stringify(event), /retrying in 5 seconds after upstream timeout/,
      'ordinary text was redacted - a credential pattern is too broad');
  });

  if (savedDsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  else process.env.NEXT_PUBLIC_SENTRY_DSN = savedDsn;
  if (savedApp === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
  else process.env.NEXT_PUBLIC_APP_ENV = savedApp;
});
