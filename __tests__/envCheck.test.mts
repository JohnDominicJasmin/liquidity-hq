import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEnv, reportEnv, type EnvFinding } from '../lib/envCheck.ts';

/* The startup env check exists because every misconfiguration it looks for was
   introduced through a Render dashboard - invisible to git, invisible to CI,
   and silent at runtime until something downstream misbehaved days later.

   These tests matter more than usual for one specific reason: a check that
   fails to fire is indistinguishable from a correctly configured environment.
   Both print nothing alarming. So the assertions below are mostly about the
   check FIRING on known-bad input, not about it staying quiet on good input -
   quiet is the failure mode that hides.

   The prod-Supabase rule is the only one that throws, and the test that
   production can never reach it is the most important one here: a bug in this
   file must not be able to take prod down. */

const PROD_REF = 'qdpwhnvmhqgzijuwopso';
const DEV_REF = 'wdtjhrilakoitfcezxpx';

const base = (over: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  NEXT_PUBLIC_APP_ENV: 'dev',
  NEXT_PUBLIC_APP_URL: 'https://liquidity-hq-qa.onrender.com',
  NEXT_PUBLIC_SUPABASE_URL: `https://${DEV_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ...over,
});

const keys = (f: EnvFinding[]) => f.map(x => x.key);
const levelFor = (f: EnvFinding[], key: string) => f.find(x => x.key === key)?.level;

test('startup environment check', async (t) => {
  await t.test('a correctly configured non-prod environment produces nothing', () => {
    assert.deepEqual(checkEnv(base()), []);
  });

  await t.test('a correctly configured production environment produces nothing', () => {
    assert.deepEqual(checkEnv(base({
      NEXT_PUBLIC_APP_ENV: 'prod',
      NEXT_PUBLIC_APP_URL: 'https://liquidity-hq.com',
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
      NEXT_PUBLIC_SENTRY_DSN: 'https://key@glitchtip/1',
      CRON_SECRET: 'secret',
    })), []);
  });

  /* The switch-not-label trap. 'qa' looks like the most reasonable value in the
     world and silently selects the PRODUCTION tables, because lib/tables.ts
     branches on === 'dev'. This is not hypothetical: the qa service was created
     with exactly this value. */
  await t.test("APP_ENV values that are not 'dev' or 'prod' are caught", () => {
    for (const bad of ['qa', 'staging', 'QA', 'development', 'production']) {
      const f = checkEnv(base({ NEXT_PUBLIC_APP_ENV: bad }));
      assert.ok(keys(f).includes('NEXT_PUBLIC_APP_ENV'), `"${bad}" should be rejected`);
      assert.match(f[0].message, /PRODUCTION tables/);
    }
  });

  await t.test('an unset APP_ENV is caught, since it also selects prod tables', () => {
    const f = checkEnv(base({ NEXT_PUBLIC_APP_ENV: undefined }));
    assert.ok(keys(f).includes('NEXT_PUBLIC_APP_ENV'));
  });

  /* The unrecoverable one. Prod Supabase is free-tier with no backups, so a
     test environment writing into it cannot be undone. */
  await t.test('a non-prod environment pointed at the prod database is FATAL', () => {
    const f = checkEnv(base({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co` }));
    assert.equal(levelFor(f, 'NEXT_PUBLIC_SUPABASE_URL'), 'fatal');
    assert.throws(() => reportEnv(f), /refusing to start/);
  });

  /* The safety property of the check itself. However wrong this file gets, it
     must not be able to stop production booting. */
  await t.test('production can never reach the fatal rule', () => {
    const f = checkEnv(base({
      NEXT_PUBLIC_APP_ENV: 'prod',
      NEXT_PUBLIC_APP_URL: 'https://liquidity-hq.com',
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
    }));
    assert.equal(f.filter(x => x.level === 'fatal').length, 0);
    assert.doesNotThrow(() => reportEnv(f));
  });

  /* APP_ENV='prod' passes the validity check while making lib/tables.ts select
     the LIVE tables. This is the more dangerous direction of rule 1 and it was
     missed in the first version of this file. */
  await t.test("APP_ENV='prod' on a non-production host is flagged", () => {
    for (const url of [
      'https://liquidity-hq-qa.onrender.com',
      'https://liquidity-hq-staging.onrender.com',
      'https://liquidity-hq-dev.onrender.com',
      'http://localhost:3000',
    ]) {
      const f = checkEnv(base({ NEXT_PUBLIC_APP_ENV: 'prod', NEXT_PUBLIC_APP_URL: url }));
      assert.equal(levelFor(f, 'NEXT_PUBLIC_APP_ENV'), 'error', `${url} should be flagged`);
      assert.match(f.find(x => x.key === 'NEXT_PUBLIC_APP_ENV')!.message, /LIVE tables/);
    }
  });

  /* It must never refuse to boot production, whatever prod's APP_URL turns out
     to be - both known hostnames clear it, and the rule is error, not fatal. */
  await t.test('neither production hostname is flagged, and the rule never throws', () => {
    for (const url of ['https://liquidity-hq.com', 'https://liquidity-hq.onrender.com']) {
      const f = checkEnv(base({
        NEXT_PUBLIC_APP_ENV: 'prod', NEXT_PUBLIC_APP_URL: url,
        NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
      }));
      assert.deepEqual(f, [], `${url} should be clean`);
    }
    const wrong = checkEnv(base({ NEXT_PUBLIC_APP_ENV: 'prod', NEXT_PUBLIC_APP_URL: 'https://example.com' }));
    assert.doesNotThrow(() => reportEnv(wrong));
  });

  /* lib/monitoring.ts already suppresses the DSN whenever APP_ENV === 'dev'.
     Warning again here fired on every local boot and on qa and staging, which
     is how a check stops being read. */
  await t.test("SENTRY_DSN is not flagged when APP_ENV='dev' suppresses it anyway", () => {
    const f = checkEnv(base({ NEXT_PUBLIC_SENTRY_DSN: 'https://key@glitchtip/1' }));
    assert.equal(levelFor(f, 'NEXT_PUBLIC_SENTRY_DSN'), undefined);
  });

  await t.test('SENTRY_DSN IS flagged where it would actually be live', () => {
    const f = checkEnv(base({ NEXT_PUBLIC_APP_ENV: 'qa', NEXT_PUBLIC_SENTRY_DSN: 'https://key@glitchtip/1' }));
    assert.equal(levelFor(f, 'NEXT_PUBLIC_SENTRY_DSN'), 'warn');
    assert.doesNotThrow(() => reportEnv(f));
  });

  /* Local development carries CRON_SECRET in .env.local so cron routes can be
     exercised. Telegram will not register a webhook against a non-public URL,
     so the hijack is not reachable from there. */
  await t.test('localhost is not flagged for CRON_SECRET', () => {
    for (const url of ['http://localhost:3000', 'http://127.0.0.1:3100']) {
      const f = checkEnv(base({ CRON_SECRET: 'x', NEXT_PUBLIC_APP_URL: url }));
      assert.equal(levelFor(f, 'CRON_SECRET'), undefined, `${url} should be quiet`);
    }
  });

  /* The rule is bot OWNERSHIP, not environment. A host that owns its bot can
     only re-point its own webhook, which is a no-op. dev has owned one since
     2026-08-04; staging got its own on 2026-08-08. qa still holds dev's token,
     which is why CRON_SECRET was removed from it. */
  await t.test('CRON_SECRET is allowed on hosts that own their bot', () => {
    for (const url of [
      'https://liquidity-hq-dev.onrender.com',
      'https://liquidity-hq-staging.onrender.com',
    ]) {
      const f = checkEnv(base({ CRON_SECRET: 'x', NEXT_PUBLIC_APP_URL: url }));
      assert.equal(levelFor(f, 'CRON_SECRET'), undefined, `${url} owns its bot — should be quiet`);
    }
  });

  await t.test('CRON_SECRET is still flagged on qa, which holds dev\'s token', () => {
    const f = checkEnv(base({
      CRON_SECRET: 'x', NEXT_PUBLIC_APP_URL: 'https://liquidity-hq-qa.onrender.com',
    }));
    assert.equal(levelFor(f, 'CRON_SECRET'), 'error');
  });

  /* The trailing dot in the pattern is load-bearing. Without it, a host whose
     name merely STARTS with an owning environment's name would be cleared -
     and `liquidity-hq-qa` is the one host that must never be. */
  await t.test('lookalike hostnames are not cleared by the owner match', () => {
    for (const url of [
      'https://liquidity-hq-qa.onrender.com',
      'https://liquidity-hq-staging-old.onrender.com',
      'https://liquidity-hq-devious.example.com',
    ]) {
      const f = checkEnv(base({ CRON_SECRET: 'x', NEXT_PUBLIC_APP_URL: url }));
      assert.equal(levelFor(f, 'CRON_SECRET'), 'error', `${url} should still be flagged`);
    }
  });

  await t.test('missing Supabase credentials are reported individually', () => {
    const f = checkEnv(base({
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    }));
    for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
      assert.ok(keys(f).includes(k), `${k} should be reported`);
    }
  });

  await t.test('reportEnv throws only on fatal, never on error or warn alone', () => {
    assert.doesNotThrow(() => reportEnv([{ level: 'error', key: 'K', message: 'm' }]));
    assert.doesNotThrow(() => reportEnv([{ level: 'warn', key: 'K', message: 'm' }]));
    assert.throws(() => reportEnv([{ level: 'fatal', key: 'K', message: 'm' }]));
  });
});
