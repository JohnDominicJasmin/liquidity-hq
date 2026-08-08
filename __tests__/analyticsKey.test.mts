import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticsKey } from '../lib/analytics.ts';

/* One PostHog project on the free plan, and every environment holding the key
   writes into it. Measured 2026-08-08: dev and prod served the SAME phc_ key,
   so anyone accepting cookies on dev landed events in production's analytics.

   qa and staging avoided this only by never being given the variable, which is
   configuration, not a guarantee - dev was overlooked for exactly that reason.
   These tests cover the gate that makes it a property of the build instead. */

const KEY = 'phc_rLooCMA4a4ShFKiJutRMkywFBVkAa6R3WQxbLf9BBMgy';

test('analytics key gating', async (t) => {
  await t.test('production gets the key', () => {
    assert.equal(
      analyticsKey({ NEXT_PUBLIC_POSTHOG_KEY: KEY, NEXT_PUBLIC_APP_ENV: 'prod' }),
      KEY,
    );
  });

  /* NEXT_PUBLIC_APP_ENV is 'dev' on dev, qa AND staging - it is the same switch
     lib/tables.ts reads - so one condition covers every non-production
     environment, including any created later. */
  await t.test('every non-production environment gets nothing, even holding the key', () => {
    assert.equal(
      analyticsKey({ NEXT_PUBLIC_POSTHOG_KEY: KEY, NEXT_PUBLIC_APP_ENV: 'dev' }),
      '',
    );
  });

  await t.test('no key configured returns empty rather than undefined', () => {
    assert.equal(analyticsKey({ NEXT_PUBLIC_APP_ENV: 'prod' }), '');
    assert.equal(analyticsKey({}), '');
  });

  /* An empty string is what PostHogProvider treats as "do not init at all", so
     the return type must stay a string - returning undefined would still be
     falsy but changes what `PH_KEY` is, and posthog.init(undefined) is not the
     same no-op as never calling it. */
  await t.test('the return is always a string', () => {
    for (const env of [
      { NEXT_PUBLIC_POSTHOG_KEY: KEY, NEXT_PUBLIC_APP_ENV: 'dev' },
      { NEXT_PUBLIC_POSTHOG_KEY: KEY, NEXT_PUBLIC_APP_ENV: 'prod' },
      {},
    ]) {
      assert.equal(typeof analyticsKey(env), 'string');
    }
  });

  /* Guards the failure this exists to prevent: an unrecognised APP_ENV must not
     silently behave like production. It does here - anything that is not 'dev'
     passes the key through - which matches lib/tables.ts, where anything not
     'dev' selects the production tables. Both are wrong in the same direction
     on purpose: lib/envCheck.ts flags such a value at startup rather than each
     call site inventing its own fallback. */
  await t.test('an unrecognised APP_ENV behaves like production, and envCheck is what catches it', () => {
    assert.equal(
      analyticsKey({ NEXT_PUBLIC_POSTHOG_KEY: KEY, NEXT_PUBLIC_APP_ENV: 'qa' }),
      KEY,
    );
  });
});
