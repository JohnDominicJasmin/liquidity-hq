import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredFlags } from '../lib/configured.ts';

/* /api/version's `configured` block must never leak a value (#282).
 *
 * The block exists because staging was created missing most of its integrations
 * and nobody noticed for eleven days - silence was the defect. Making a host
 * declare itself is only acceptable while the answer is BOOLEANS: no value, no
 * prefix, no length. That is a property nobody can eyeball on review forever, so
 * it is asserted here.
 *
 * The sentinels below are deliberately distinctive. If the block ever grows a
 * `...process.env` spread, a "first 4 chars" debugging hint, or a length, the
 * serialized output contains one of them and this fails.
 *
 * Tests lib/configured.ts rather than the route: the route imports
 * `next/server`, which this runner cannot resolve, and its only remaining job is
 * to call this function - a line a reviewer can check by eye.
 *
 * WHAT THIS CANNOT PROVE: that a flag matches what the FEATURE does. A flag
 * derived from a parallel read would still be a boolean and still pass. That is
 * why the module derives from the app's own reads (isCheckoutConfigured,
 * analyticsKey) - a property of the code, not of this test.
 */

const SENTINELS: Record<string, string> = {
  LEMONSQUEEZY_WEBHOOK_SECRET:  'SENTINELlswh1111111111',
  ADMIN_EMAILS:                 'SENTINELadmin@example.com',
  VAPID_PRIVATE_KEY:            'SENTINELvapidpriv2222222222',
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'SENTINELvapidpub3333333333',
  VAPID_EMAIL:                  'mailto:SENTINELvapid@example.com',
  TELEGRAM_BOT_TOKEN:           'SENTINELtgtoken4444444444',
  TELEGRAM_CHAT_ID:             'SENTINELtgchat5555555555',
  TELEGRAM_WEBHOOK_SECRET:      'SENTINELtgwh6666666666',
  BREVO_API_KEY:                'SENTINELbrevo7777777777',
  BREVO_SENDER_EMAIL:           'SENTINELsender@example.com',
  NEXT_PUBLIC_SENTRY_DSN:       'https://SENTINELdsn@o0.ingest.sentry.io/0',
  COINGLASS_API_KEY:            'SENTINELcg8888888888',
  GROK_API_KEY:                 'SENTINELgrok9999999999',
  FINNHUB_KEY:                  'SENTINELfh1010101010',
  CMC_API_KEY:                  'SENTINELcmc1212121212',
  CRON_SECRET:                  'SENTINELcron1313131313',
  NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL: 'https://SENTINELstore.example.com/checkout/buy/abc',
  NEXT_PUBLIC_POSTHOG_KEY:      'phc_SENTINEL1414141414',
};

const flags = () => configuredFlags(process.env as Record<string, string | undefined>);

test('every flag is a boolean, and no value reaches the output', () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, SENTINELS);
    process.env.NEXT_PUBLIC_APP_ENV = 'prod';  // else analyticsKey blanks posthog

    const configured = flags();
    const serialized = JSON.stringify(configured);

    for (const [key, value] of Object.entries(configured)) {
      assert.equal(typeof value, 'boolean',
        `configured.${key} is ${typeof value}, not boolean - only booleans may be exposed`);
    }

    for (const [name, secret] of Object.entries(SENTINELS)) {
      assert.ok(!serialized.includes(secret),
        `the value of ${name} appeared in the output. Booleans only.`);
      assert.ok(!serialized.includes(secret.slice(0, 8)),
        `a fragment of ${name} appeared in the output - a prefix is a leak too.`);
    }
  } finally {
    for (const k of Object.keys(SENTINELS)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('a flag is false when unset and true when set', () => {
  const saved = { ...process.env };
  try {
    delete process.env.ADMIN_EMAILS;
    delete process.env.COINGLASS_API_KEY;
    let c = flags();
    assert.equal(c.adminEmails, false, 'unset ADMIN_EMAILS should read false');
    assert.equal(c.coinglass, false, 'unset COINGLASS_API_KEY should read false');

    process.env.ADMIN_EMAILS = 'someone@example.com';
    process.env.COINGLASS_API_KEY = 'k';
    c = flags();
    assert.equal(c.adminEmails, true, 'set ADMIN_EMAILS should read true');
    assert.equal(c.coinglass, true, 'set COINGLASS_API_KEY should read true');
  } finally {
    Object.assign(process.env, saved);
  }
});

test('whitespace is not configuration', () => {
  const saved = { ...process.env };
  try {
    // An empty string or a stray space is the commonest way a dashboard entry
    // looks present and behaves absent.
    process.env.ADMIN_EMAILS = '   ';
    assert.equal(flags().adminEmails, false,
      'a whitespace-only value must not count as configured');
  } finally {
    Object.assign(process.env, saved);
  }
});

test('a partial setup reports false, not true', () => {
  const saved = { ...process.env };
  try {
    // Two of three. Push fails when a notification is SENT, not at boot, so
    // reporting true here would be the exact drift this block must not have.
    process.env.VAPID_PRIVATE_KEY = 'priv';
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'pub';
    delete process.env.VAPID_EMAIL;
    assert.equal(flags().vapid, false, 'two of the three VAPID vars is not configured');

    process.env.VAPID_EMAIL = 'mailto:a@example.com';
    assert.equal(flags().vapid, true, 'all three should read true');
  } finally {
    Object.assign(process.env, saved);
  }
});

test('posthog follows analyticsKey, not the raw variable', () => {
  const saved = { ...process.env };
  try {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_something';
    process.env.NEXT_PUBLIC_APP_ENV = 'dev';
    /* The key IS set, and analyticsKey() blanks it on any non-prod host, so no
       event is ever sent. Reporting true would describe the variable rather than
       the behaviour. */
    assert.equal(flags().posthog, false,
      'a dev host must report posthog false even with the key set');

    process.env.NEXT_PUBLIC_APP_ENV = 'prod';
    assert.equal(flags().posthog, true, 'a prod host with the key set should read true');
  } finally {
    Object.assign(process.env, saved);
  }
});

test('checkout treats the "#" placeholder as unset', () => {
  const saved = { ...process.env };
  try {
    process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL = '#';
    assert.equal(flags().checkout, false,
      '"#" is the not-live-yet placeholder and must not count as a store');
  } finally {
    Object.assign(process.env, saved);
  }
});
