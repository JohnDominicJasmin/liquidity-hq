import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubUrl, scrubText, scrubEvent, monitoringEnvironment, monitoringDsn, monitoringOptions } from '../lib/monitoring.ts';

/* The PII scrubber runs on every event leaving the app for GlitchTip. It is the
   last thing between a user's id or email and a third-party dashboard, and it
   has no user-visible symptom when it breaks - a leak looks exactly like normal
   operation from the inside.

   So it is a pure function, tested here rather than "verified" by watching real
   traffic. The failure this guards against is not "the scrubber throws"; it is
   "the scrubber quietly stops matching a shape" - which is why the assertions
   below check for the ABSENCE of specific values, not for a redaction marker
   being present somewhere. */

const UUID_A = '9489f7cf-3d9f-4f1e-8648-c5611562d466';
const UUID_B = '00000000-1111-2222-3333-444444444444';

test('monitoring PII scrubbing', async (t) => {
  await t.test('URL paths lose row and user ids but keep the route shape', () => {
    assert.equal(scrubUrl(`/api/hypotheses/${UUID_A}`), '/api/hypotheses/:id');
    assert.equal(scrubUrl(`/api/trades/${UUID_A}/notes/${UUID_B}`), '/api/trades/:id/notes/:id');
    // Collapsing to a shape is also what stops one broken route producing one
    // issue per user - 400 identical bugs read as 400 bugs.
    assert.equal(
      scrubUrl(`/api/hypotheses/${UUID_A}`),
      scrubUrl(`/api/hypotheses/${UUID_B}`),
      'two users hitting the same broken route must group into one issue',
    );
  });

  await t.test('query strings go entirely, path survives', () => {
    assert.equal(scrubUrl('/scanner?coin=BTC&user=me@x.com'), '/scanner?<redacted>');
    assert.equal(scrubUrl('/login?next=/dashboard'), '/login?<redacted>');
    assert.ok(!scrubUrl('/x?email=a@b.com').includes('a@b.com'));
  });

  await t.test('emails in a path are redacted', () => {
    assert.equal(scrubUrl('/api/ops/user/someone@example.com'), '/api/ops/user/:email');
  });

  await t.test('empty and plain URLs are left alone', () => {
    assert.equal(scrubUrl(''), '');
    assert.equal(scrubUrl('/dashboard'), '/dashboard');
    // A coin symbol is not PII and the route is more useful with it.
    assert.equal(scrubUrl('/markets/BTC'), '/markets/BTC');
  });

  await t.test('free text loses ids and emails', () => {
    assert.equal(
      scrubText(`row ${UUID_A} not found for user@example.com`),
      'row :id not found for :email',
    );
  });

  await t.test('an event is stripped of credentials, body and query', () => {
    const event = scrubEvent({
      request: {
        url: `https://liquidity-hq.com/api/hypotheses/${UUID_A}?token=abc`,
        query_string: 'token=abc',
        cookies: { sb_session: 'xyz' },
        data: { notes: 'my private trading journal entry' },
        headers: {
          Authorization: 'Bearer eyJhb',
          apikey: 'anon-key-value',
          Cookie: 'sb=1',
          'X-Cron-Secret': 'shhh',
          'User-Agent': 'Mozilla/5.0',
          'content-type': 'application/json',
        },
      },
      user: { id: UUID_A, email: 'someone@example.com', ip_address: '203.0.113.9', username: 'joe' },
    });

    const serialised = JSON.stringify(event);
    for (const secret of ['Bearer eyJhb', 'anon-key-value', 'shhh', 'sb=1',
                          'someone@example.com', '203.0.113.9', 'joe',
                          'my private trading journal entry', 'token=abc']) {
      assert.ok(!serialised.includes(secret), `event still contains ${secret}`);
    }

    // Kept on purpose - the user id is how you tell "one user" from "everyone",
    // and it is the key you would use to reproduce.
    assert.equal(event.user!.id, UUID_A);
    // Harmless headers survive; this is a denylist, not a wipe.
    assert.equal(event.request!.headers!['User-Agent'], 'Mozilla/5.0');
    assert.equal(event.request!.headers!['content-type'], 'application/json');
  });

  await t.test('header matching ignores case', () => {
    const event = scrubEvent({
      request: { headers: { authorization: 'a', AUTHORIZATION: 'b', ApiKey: 'c' } },
    });
    assert.deepEqual(Object.keys(event.request!.headers!), []);
  });

  await t.test('exception messages and breadcrumbs are scrubbed too', () => {
    const event = scrubEvent({
      message: `failed for ${UUID_A}`,
      exception: { values: [{ value: `no row ${UUID_A} for a@b.com` }] },
      breadcrumbs: [
        { message: `loaded ${UUID_A}`, data: { url: `/api/x/${UUID_A}?q=1` } },
        { data: { from: `/journal/${UUID_A}`, to: `/journal/${UUID_B}?tab=history` } },
      ],
    });
    assert.equal(event.message, 'failed for :id');
    assert.equal(event.exception!.values![0].value, 'no row :id for :email');
    assert.equal(event.breadcrumbs![0].message, 'loaded :id');
    assert.equal(event.breadcrumbs![0].data!.url, '/api/x/:id?<redacted>');
    assert.equal(event.breadcrumbs![1].data!.from, '/journal/:id');
    assert.equal(event.breadcrumbs![1].data!.to, '/journal/:id?<redacted>');
  });

  await t.test('stack frame source context is scrubbed, not just the message', () => {
    /* Regression test for the one thing the unit tests missed and the live
       end-to-end run caught: the exception VALUE was correctly redacted while an
       email survived in the source lines the SDK attaches around the throwing
       frame. Anything that ships verbatim source is in scope. */
    const event = scrubEvent({
      exception: {
        values: [{
          value: 'boom',
          stacktrace: {
            frames: [{
              context_line: `  const u = "${UUID_A}";`,
              pre_context: ['// owner: someone@example.com', 'function f() {'],
              post_context: [`  log("${UUID_B}")`],
              vars: { email: 'someone@example.com', count: 3 },
            }],
          },
        }],
      },
    });
    const frame = event.exception!.values![0].stacktrace!.frames![0];
    assert.equal(frame.context_line, '  const u = ":id";');
    assert.deepEqual(frame.pre_context, ['// owner: :email', 'function f() {']);
    assert.deepEqual(frame.post_context, ['  log(":id")']);
    assert.equal(frame.vars!.email, ':email');
    assert.equal(frame.vars!.count, 3, 'non-string locals must survive untouched');
  });

  await t.test('an event with none of those fields passes through unharmed', () => {
    // Sentry sends plenty of events with no request and no user. Throwing here
    // would drop the event entirely and take the error with it.
    const event = scrubEvent({ level: 'error', tags: { route: 'cron/x' } });
    assert.deepEqual(event, { level: 'error', tags: { route: 'cron/x' } });
  });
});

test('monitoring environment resolution', async (t) => {
  const saved = {
    sentry: process.env.NEXT_PUBLIC_SENTRY_ENV,
    app: process.env.NEXT_PUBLIC_APP_ENV,
  };
  const set = (sentry?: string, app?: string) => {
    if (sentry === undefined) delete process.env.NEXT_PUBLIC_SENTRY_ENV;
    else process.env.NEXT_PUBLIC_SENTRY_ENV = sentry;
    if (app === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
    else process.env.NEXT_PUBLIC_APP_ENV = app;
  };

  await t.test('the dedicated variable wins, which is the whole point', () => {
    /* qa MUST run with NEXT_PUBLIC_APP_ENV=dev or lib/tables.ts switches it to
       production table names - that has already happened once. So qa can only
       get its own error-tracker label from a separate variable. */
    set('qa', 'dev');
    assert.equal(monitoringEnvironment(), 'qa');
  });

  await t.test('falls back to the app env, so prod and dev keep working unset', () => {
    set(undefined, 'prod');
    assert.equal(monitoringEnvironment(), 'prod');
    set(undefined, 'dev');
    assert.equal(monitoringEnvironment(), 'dev');
  });

  await t.test('never returns empty - an unlabelled event is unattributable', () => {
    set(undefined, undefined);
    assert.equal(monitoringEnvironment(), 'production');
    set('', '');
    assert.equal(monitoringEnvironment(), 'production');
  });

  set(saved.sentry, saved.app);
});

test('reporting is restricted to production', async (t) => {
  /* Issue #57. All three services pointed at one GlitchTip project sharing one
     1,000-event/month quota, and dev + qa spent it: a forced error from BOTH
     prod and staging returned HTTP 429, so production monitoring was dead.

     These assertions exist because the config-only version of this fix
     (unset the DSN on two dashboards) regresses silently. */
  const savedDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const savedApp = process.env.NEXT_PUBLIC_APP_ENV;
  const DSN = 'https://key@app.glitchtip.com/25983';

  const set = (dsn?: string, app?: string) => {
    if (dsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = dsn;
    if (app === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
    else process.env.NEXT_PUBLIC_APP_ENV = app;
  };

  await t.test('production reports', () => {
    set(DSN, 'prod');
    assert.equal(monitoringDsn(), DSN);
  });

  await t.test('dev does not', () => {
    set(DSN, 'dev');
    assert.equal(monitoringDsn(), undefined);
  });

  await t.test('qa does not - it runs as dev, which is the whole point', () => {
    /* qa CANNOT be given its own NEXT_PUBLIC_APP_ENV: lib/tables.ts treats
       anything that is not 'dev' as production table names. So the only thing
       that can exclude qa is the same 'dev' value that keeps it on the dev
       database - and a qa-specific label must never be allowed to re-enable
       reporting. */
    set(DSN, 'dev');
    process.env.NEXT_PUBLIC_SENTRY_ENV = 'qa';
    assert.equal(monitoringDsn(), undefined,
      'setting SENTRY_ENV=qa must not turn reporting back on');
    delete process.env.NEXT_PUBLIC_SENTRY_ENV;
  });

  await t.test('a missing APP_ENV still reports, rather than silently going dark', () => {
    /* The deliberate difference from issue #57's suggested `=== "prod"`. If the
       variable goes missing on prod, that predicate would switch monitoring off
       with no signal - re-creating the exact failure this fixes. Such a service
       would also be reading production tables, so erring toward "report" is the
       safer of the two wrong answers. */
    set(DSN, undefined);
    assert.equal(monitoringDsn(), DSN);
  });

  await t.test('no DSN configured means off, everywhere', () => {
    set(undefined, 'prod');
    assert.equal(monitoringDsn(), undefined);
    set('', 'prod');
    assert.equal(monitoringDsn(), undefined);
  });

  set(savedDsn, savedApp);
});

/* The quota settings, guarded because both are one line and neither has a
   visible symptom when removed.

   `autoSessionTracking: false` was added 2026-08-08 after a production probe
   found 14 envelopes across 6 pageviews and ZERO of them an error - every item
   was type=session. Release Health was spending the entire free-tier month, so
   every real error came back 429. Deleting that line does not break a test, does
   not warn, and does not fail a build; it just silently stops error reporting
   again a few hundred pageviews later.

   `tracesSampleRate: 0` is the same shape of decision and was already load
   bearing, so it is asserted here too rather than left to the file comment. */
test('monitoring quota settings', async (t) => {
  const savedDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const savedApp = process.env.NEXT_PUBLIC_APP_ENV;
  process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://key@glitchtip.example/1';
  process.env.NEXT_PUBLIC_APP_ENV = 'prod';

  await t.test('session tracking is OFF - it consumed the whole free-tier quota', () => {
    assert.equal(monitoringOptions().autoSessionTracking, false);
  });

  await t.test('transaction sampling stays at 0', () => {
    assert.equal(monitoringOptions().tracesSampleRate, 0);
  });

  await t.test('PII is not sent by default', () => {
    assert.equal(monitoringOptions().sendDefaultPii, false);
  });

  /* Both scrub hooks must stay wired. beforeSend is what makes PII scrubbing
     verifiable client-side at all (issue #72) - it runs before transmission, so
     a 429 rejects delivery without affecting whether scrubbing happened. */
  await t.test('both scrub hooks are wired', () => {
    const o = monitoringOptions();
    assert.equal(typeof o.beforeSend, 'function');
    assert.equal(typeof o.beforeSendTransaction, 'function');
  });

  if (savedDsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  else process.env.NEXT_PUBLIC_SENTRY_DSN = savedDsn;
  if (savedApp === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
  else process.env.NEXT_PUBLIC_APP_ENV = savedApp;
});
