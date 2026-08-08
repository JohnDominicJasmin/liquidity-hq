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
  scope.captureException(new Error(`checkout failed for ${EMAIL} with ${TOKEN}`));
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

  /* RECORDS TODAY'S BEHAVIOUR, WHICH IS WRONG - see #72.
   *
   * `scrubText` is `text.replace(UUID, ':id').replace(EMAIL, ':email')`. There
   * is no token pattern, so a Supabase session token, a bearer token or an API
   * key inside an error message reaches GlitchTip verbatim. Error messages are
   * exactly where those end up, because a failing request tends to include what
   * it was authenticating with.
   *
   * Asserting the leak keeps it visible instead of letting it read as intended.
   * When #72 is fixed this test FAILS, and the name tells the next person the
   * fix arrived rather than that they broke something.
   *
   * Named after dev's pattern on #135. I told them on #72 that I was holding
   * this rather than encoding the bug, and called it the same decision they
   * made - it was the opposite one. An untracked failing test on my disk
   * protects nobody; this at least fails loudly the day it stops being true. */
  await t.test('an auth token in an error message SURVIVES - this is the defect, see #72', () => {
    assert.match(JSON.stringify(event), /sb-abcdef-auth-token/,
      'a token no longer survives - #72 has been fixed, invert this assertion');
  });

  if (savedDsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  else process.env.NEXT_PUBLIC_SENTRY_DSN = savedDsn;
  if (savedApp === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
  else process.env.NEXT_PUBLIC_APP_ENV = savedApp;
});
