import { test, expect, type APIResponse } from '@playwright/test';
import { getGuarded } from './_shared';

/* `/api/version`'s `configured` block, asserted against the RUNNING SERVICE (#282).
 *
 * Dev's unit test (`__tests__/versionConfigured.test.mts`) pins the invariant on
 * `configuredFlags()` - a pure function over an env bag. That is the right place
 * for it and it is not the same claim as this one. A route can serialize
 * anything it likes around a well-behaved function: a `...process.env` spread, a
 * debugging field, a second block added next quarter by someone who never read
 * the header comment. **The unit test would still pass.**
 *
 * So this asserts the property where it actually matters - on the bytes a host
 * hands to an anonymous caller over the internet.
 *
 * WHY THE BLOCK EXISTS AT ALL. `staging` was created missing most of its
 * integrations, that quietly reduced what QA could verify before a release, and
 * NOBODY NOTICED FOR ELEVEN DAYS. Silence was the defect. This spec is the other
 * half of that fix: the block only helps if something reads it.
 *
 * WHAT IT DOES NOT ASSERT. Not which flags are true. Those legitimately differ
 * per service - `posthog` is false on every non-prod host by design, `cronSecret`
 * false means those routes reject everything rather than standing open. Pinning
 * them would make this a spec about one environment. It records them instead, so
 * a red run elsewhere has the context beside it.
 */

type VersionBody = {
  commit?: unknown;
  branch?: unknown;
  appEnv?: unknown;
  configured?: Record<string, unknown>;
};

/* Values that must never appear in a public response, in any form. Deliberately
   generic: this is a shape check on the OUTPUT, so it cannot import the app's
   env and must recognise a secret by looking like one. */
const SECRET_SHAPED: ReadonlyArray<readonly [label: string, re: RegExp]> = [
  ['a JWT',                    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['a PostHog key',            /\bphc_[A-Za-z0-9]{16,}/],
  ['a Sentry DSN',             /https:\/\/[0-9a-f]{16,}@[\w.-]*ingest[\w.-]*\.sentry\.io/i],
  ['a Telegram bot token',     /\b\d{8,10}:[A-Za-z0-9_-]{30,}/],
  ['a Brevo key',              /\bxkeysib-[A-Za-z0-9]{16,}/],
  ['a LemonSqueezy checkout',  /\/checkout\/buy\/[0-9a-f-]{16,}/i],
  ['a bearer-ish long hex',    /\b[0-9a-f]{40,}\b/i],
];

let res: APIResponse;
let body: VersionBody;
let raw = '';

test.describe('/api/version configured block', () => {
  test.beforeAll(async ({ request }) => {
    res = await getGuarded(request, '/api/version');
    raw = await res.text();
    body = JSON.parse(raw) as VersionBody;
  });

  test('CONTROL: the endpoint answers and identifies the host', async () => {
    /* Every assertion below reads `body.configured`. If the endpoint 404'd or
       returned HTML, `configured` would be undefined and the boolean sweep would
       iterate zero entries and pass - the empty-result trap. This is what stops
       that. */
    expect(res.status(), `/api/version returned HTTP ${res.status()}`).toBe(200);
    expect(body.commit, '/api/version reported no commit - this is not the version endpoint')
      .toEqual(expect.any(String));
    expect(body.branch).toEqual(expect.any(String));
    expect(body.appEnv).toEqual(expect.any(String));
  });

  test('no secret-shaped value appears anywhere in the response', async () => {
    /* Runs regardless of whether `configured` exists, because the point is the
       whole response and not one block of it. This is the assertion that would
       survive someone adding a completely different field. */
    for (const [label, re] of SECRET_SHAPED) {
      expect(re.test(raw),
        `/api/version response contains something shaped like ${label}. This endpoint is ` +
        `UNAUTHENTICATED - the drift check needs it that way - so anything here is public. ` +
        `Booleans only.`).toBe(false);
    }
  });

  test('every value in `configured` is a boolean - never a value, prefix or length', async () => {
    test.skip(!body.configured,
      `host predates #283 - no 'configured' block on ${String(body.branch)} @ ${String(body.commit)}`);

    const entries = Object.entries(body.configured!);

    /* Without this the loop below passes on `configured: {}`, which is exactly
       what a broken build would emit. */
    expect(entries.length,
      '`configured` is present but empty - the block reports nothing and would pass ' +
      'every type assertion below').toBeGreaterThan(5);

    for (const [key, value] of entries) {
      expect(typeof value,
        `configured.${key} is a ${typeof value}, not a boolean. Only booleans may be ` +
        `exposed here - a prefix or a length is a leak too.`).toBe('boolean');
    }
  });

  test('record which integrations this host reports, so a silent gap is visible', async () => {
    test.skip(!body.configured, 'host predates #283');

    const flags = body.configured!;
    const on  = Object.keys(flags).filter(k => flags[k] === true).sort();
    const off = Object.keys(flags).filter(k => flags[k] === false).sort();

    /* Not an assertion about which are on - those differ per service by design.
       This exists so a red run anywhere else in the suite has the environment's
       own answer sitting beside it in the log, rather than someone inferring it
       from a dashboard they may not have access to. */
    // eslint-disable-next-line no-console
    console.log(
      `[configured] ${String(body.branch)} @ ${String(body.commit)} (appEnv=${String(body.appEnv)})\n` +
      `  ON : ${on.join(', ') || '(none)'}\n` +
      `  OFF: ${off.join(', ') || '(none)'}`,
    );

    expect(on.length + off.length, 'no flags reported').toBeGreaterThan(0);
  });
});
