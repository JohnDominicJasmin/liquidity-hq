import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { SUPABASE_URL } from './_auth';

/* Does the webhook's decision actually reach the database row?
 *
 * This is the third of the three halves, and the one that has never existed.
 * `payments-webhook.spec.ts` says so in its own header:
 *
 *   payments-webhook.spec.ts   -> is the caller allowed to reach the decision
 *   lemonsqueezyEvents.test    -> is the decision right
 *   THIS FILE                  -> does the decision reach the database
 *
 * The first two can both pass on a handler whose write silently no-ops: a
 * dropped `await`, a wrong table prefix, an RLS policy that refuses the service
 * role. Nothing in the suite would have noticed. That gap is #134 and #239.
 *
 * WHY IT NEEDED A THIRD ACCOUNT. A and B are pinned fixtures - A is `pro`, B is
 * `free` - and `entitlements.spec.ts` FAILS if either drifts, deliberately. This
 * spec's whole job is to flip an account back and forth, so it cannot use
 * either without breaking the guard on the Pro boundary. Account C exists for
 * this and is referenced by nothing else (#239, created by dev on the DEV
 * project `wdtjhrilakoitfcezxpx`, owner-authorised).
 *
 * WHAT THIS COSTS, stated plainly: it writes to a database shared with `dev`.
 * It only ever touches C's single row, resets it before and after, and never
 * reads or writes any other account.
 */

const SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const C_EMAIL = (process.env.E2E_USER_C_EMAIL ?? '').trim().toLowerCase();
const C_ID = process.env.E2E_USER_C_ID ?? '';
const ENDPOINT = '/api/lemonsqueezy/webhook';

/* Named individually so the skip says WHICH one is missing, for the reason
 * `_auth.ts` spells out at length: on 2026-08-10 a single absent variable
 * skipped all twenty authenticated tests and the only symptom was the word
 * `skipped` scrolling past. A skip that does not name its cause is a silent gap
 * with extra steps. */
const REQUIRED: ReadonlyArray<readonly [string, string]> = [
  ['NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY],
  ['LEMONSQUEEZY_WEBHOOK_SECRET', SECRET],
  ['E2E_USER_C_EMAIL', C_EMAIL],
  ['E2E_USER_C_ID', C_ID],
];
const MISSING = REQUIRED.filter(([, v]) => !v).map(([n]) => n);

const SKIP_REASON =
  `write-path fixtures absent - MISSING: ${MISSING.join(', ')}. ` +
  'Set them in `.env.e2e.local` (gitignored). E2E_USER_C_* are on #239. ' +
  'LEMONSQUEEZY_WEBHOOK_SECRET must be the value the TARGET service is running with, ' +
  'not a local invention - a mismatch produces 401 on every request and this file would ' +
  'then be asserting that a wrong secret is rejected, which is already covered elsewhere.\n\n' +
  'Skipping rather than passing: the write path is then verified by nothing, anywhere.';

/* ── The two things this file talks to ──────────────────────────────────────
 *
 * It POSTs to the deployed service and reads the row back from PostgREST with
 * the service role key. Those are two different systems and they must agree on
 * which database they mean, which is not guaranteed and is checked below.       */

interface SubRow {
  role: string;
  ls_status: string | null;
  ls_subscription_id: string | null;
  current_period_end: string | null;
  trial_ends_at?: string | null;
  updated_at: string;
}

/* WHICH TABLE. `lib/tables.ts` prefixes every table with `lhq_` or `lhq_dev_`
 * depending on NEXT_PUBLIC_APP_ENV, which is set per Render service. So the
 * table this spec must read is a property of the RUNNING SERVICE, not of the
 * local environment - and reading the wrong one would report "the write never
 * landed" for a write that landed perfectly.
 *
 * `/api/version` reports `appEnv` for exactly this reason ("the switch that has
 * silently pointed a test environment at production data before now"). Asking
 * the service is the only answer that cannot drift. */
let TABLE = '';

async function db(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

async function readRow(): Promise<SubRow | null> {
  const res = await db(
    `${TABLE}?user_id=eq.${C_ID}&select=role,ls_status,ls_subscription_id,current_period_end,updated_at`,
  );
  if (!res.ok) {
    throw new Error(`reading ${TABLE} failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const rows = (await res.json()) as SubRow[];
  return rows[0] ?? null;
}

/** Put C back to a known state. Not an assertion - the assertions read it back. */
async function resetTo(role: 'free' | 'pro'): Promise<void> {
  const res = await db(`${TABLE}?on_conflict=user_id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      user_id: C_ID,
      role,
      ls_status: 'qa_reset',
      ls_subscription_id: null,
      current_period_end: null,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    throw new Error(
      `resetting C to '${role}' failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}. ` +
      `Without a known starting state every assertion below is meaningless.`,
    );
  }
}

/* EVERY PAYLOAD CARRIES A NONCE, and it is load-bearing for the same reason it
 * is in `payments-webhook.spec.ts`: the route hashes the raw body into
 * `ls_webhook_events` BEFORE it writes anything (route.ts:51 vs :92). A
 * byte-identical payload takes the replay path on every run after the first, so
 * without the nonce this whole file would pass once and then assert nothing
 * forever while still reporting green. `custom_data` is read but not validated,
 * so it changes the hash without changing any behaviour under test. */
function payload(eventName: string, attrs: Record<string, unknown>, dataId: string) {
  return JSON.stringify({
    meta: {
      event_name: eventName,
      custom_data: { user_id: C_ID, qa_nonce: crypto.randomUUID() },
    },
    // NOTE: `test_mode` is deliberately ABSENT. The route ignores test-mode
    // events unless NEXT_PUBLIC_APP_ENV === 'dev' (route.ts:36), so setting it
    // true would make every test below pass as `ignored: test_mode` on any
    // service that is not the dev one - an absence reporting as normal.
    data: { id: dataId, attributes: { user_email: C_EMAIL, customer_id: 4242, ...attrs } },
  });
}

/* Post an event and REFUSE to continue unless it reached the write.
 *
 * This is the guard that makes the rest of the file mean something. The handler
 * returns 200 for `email_mismatch`, `replay`, `test_mode` and `unhandled_event`
 * alike - four different ways to not write, all of which look like success at
 * the HTTP level. Asserting the body carries no `ignored` key is what turns
 * "the role did not change" from an ambiguous result into a specific one. */
async function send(
  request: import('@playwright/test').APIRequestContext,
  eventName: string,
  attrs: Record<string, unknown>,
  dataId = 'sub_qa_writepath',
): Promise<void> {
  const body = payload(eventName, attrs, dataId);
  const res = await request.post(ENDPOINT, {
    headers: { 'Content-Type': 'application/json', 'x-signature': crypto.createHmac('sha256', SECRET).update(body).digest('hex') },
    data: body,
    failOnStatusCode: false,
  });

  const text = await res.text();
  expect(res.status(), `${eventName}: handler did not accept the payload - ${text.slice(0, 200)}`).toBe(200);
  expect(text, `${eventName}: the handler REFUSED to write and said so - ${text}. ` +
    `That is not a failing assertion about roles, it is the request never reaching the write. ` +
    `email_mismatch means E2E_USER_C_EMAIL does not match the account; replay means the nonce ` +
    `is not varying; test_mode means the payload set it; unhandled_event means patchForEvent ` +
    `returned null for this event name.`).not.toContain('ignored');
}

test.describe('LemonSqueezy write path (account C)', () => {
  /* SERIAL, and not for speed. Each test depends on the state the previous one
   * left - `subscription_cancelled` can only prove "role UNCHANGED" if the role
   * is `pro` when it arrives. Parallel workers would interleave writes to one
   * row and produce failures that are about scheduling rather than the app. */
  test.describe.configure({ mode: 'serial' });

  test.skip(MISSING.length > 0, SKIP_REASON);

  test.beforeAll(async ({ request }, testInfo) => {
    /* ONE PROJECT ONLY, and this is not the usual "viewport is irrelevant".
     *
     * This spec owns a single database row and drives it through a sequence.
     * Running desktop and mobile would put two workers on the same row, and the
     * failures would be about scheduling rather than about the app - the most
     * expensive kind of red, because it looks exactly like a real defect.
     *
     * Skipping here rather than in beforeEach on purpose: beforeEach runs AFTER
     * beforeAll, so a mobile worker would already have reset C's row - mid-way
     * through the desktop run - before skipping a single test. */
    test.skip(testInfo.project.name !== 'desktop',
      'single-row state machine, must not run in two projects at once');

    /* DOES THE TARGET HOLD THE SAME SECRET WE SIGN WITH?
     *
     * Having a secret locally means nothing when `E2E_BASE_URL` points at a
     * deployed service - it has its own, and if they differ every signed payload
     * gets a 401 and every test here fails on the environment rather than on the
     * write path.
     *
     * That is exactly what happened on the first full run against
     * `liquidity-hq-qa`: `subscription_created` failed with a 401 that read as a
     * broken write. I had added this guard to `payments-webhook.spec.ts` earlier
     * the same day and did not carry it to its sibling - so the fix was half
     * applied, which is worse than not applied, because one of the two files
     * then looks trustworthy.
     *
     * A probe first, and NOT a failure: a mismatched secret is a fact about two
     * environments, not a defect. */
    const probeBody = JSON.stringify({
      meta: { event_name: 'qa_secret_probe', custom_data: { qa_nonce: crypto.randomUUID() } },
      data: { id: 'qa_secret_probe', attributes: {} },
    });
    const probe = await request.post(ENDPOINT, {
      headers: {
        'Content-Type': 'application/json',
        'x-signature': crypto.createHmac('sha256', SECRET).update(probeBody).digest('hex'),
      },
      data: probeBody,
      failOnStatusCode: false,
    });
    test.skip(probe.status() === 401,
      'The target rejected a payload signed with our LEMONSQUEEZY_WEBHOOK_SECRET (401), so it holds ' +
      'a DIFFERENT secret - or none. Every test here would fail on that rather than on the write ' +
      'path. Set the same value locally as the target holds, or run against a service that shares ' +
      'it.\n\nThis is a skip and not a failure on purpose. But it IS a real gap: the write path is ' +
      'verified by nothing in this run, and that is the whole reason this file exists.');

    /* Ask the SERVICE which table set it is using, rather than deriving it from
     * this machine's environment. See the comment on TABLE. */
    const v = await request.get('/api/version', { failOnStatusCode: false });
    expect(v.status(), '/api/version was unreachable, so the target table cannot be resolved').toBe(200);
    const { appEnv, branch, commit } = await v.json();
    expect(appEnv, '/api/version reports appEnv `unset`, so which table set the service writes ' +
      'to is unknown. Guessing it would risk asserting against the wrong database.').not.toBe('unset');

    TABLE = `${appEnv === 'dev' ? 'lhq_dev_' : 'lhq_'}user_subscriptions`;
    // eslint-disable-next-line no-console
    console.log(`[write-path] target ${branch}@${commit} appEnv=${appEnv} table=${TABLE}`);

    /* PROD TABLE SET, HARD STOP. `lhq_` means this run would flip a role in the
     * production table. Nothing in this file is safe to point there. */
    expect(TABLE, 'REFUSING TO RUN: the target service reports a non-dev appEnv, so this spec ' +
      'would write to the PRODUCTION table set. Point E2E_BASE_URL at qa or staging.')
      .toBe('lhq_dev_user_subscriptions');

    /* The row must already exist. Creating it here would hide the case where
     * E2E_USER_C_ID is wrong - an insert against a bad uuid fails on the foreign
     * key, but an insert against a VALID uuid belonging to someone else would
     * quietly succeed and this spec would spend its life flipping a stranger. */
    const existing = await readRow();
    expect(existing, `no row in ${TABLE} for E2E_USER_C_ID=${C_ID}. Either the id is wrong or the ` +
      `account was never seeded with a subscription row (#239).`).not.toBeNull();

    await resetTo('free');
  });

  test.afterAll(async () => {
    // Leave C as it was found. A spec that leaves an account `pro` makes the
    // NEXT run's baseline control fail for a reason that has nothing to do with
    // the app.
    if (TABLE && MISSING.length === 0) await resetTo('free');
  });

  /* ── The control ────────────────────────────────────────────────────────────
   *
   * This runs FIRST and everything else depends on it. "C is `pro` after
   * subscription_created" passes on an account that was already `pro`, on a
   * handler that writes nothing at all. Five of 2026-08-10's defects were an
   * absence reporting as normal; this is the cheapest possible guard against
   * being the sixth. */
  test('control: C starts free, so a later `pro` cannot be pre-existing', async () => {
    const row = await readRow();
    expect(row!.role, 'C is not `free` at the start, so every grant assertion below would be vacuous').toBe('free');
    expect(row!.current_period_end, 'C carries a period end before any event was sent').toBeNull();
  });

  test('`subscription_created` with status active grants pro, and the write lands', async ({ request }) => {
    const before = await readRow();

    await send(request, 'subscription_created', {
      status: 'active',
      renews_at: '2099-01-01T00:00:00Z',
    }, 'sub_qa_created');

    const after = await readRow();
    expect(after!.role, 'the handler accepted the event but the role never changed - the DECISION is ' +
      'right (lemonsqueezyEvents.test.mts covers it) so this is the write itself failing').toBe('pro');
    expect(after!.ls_status).toBe('active');
    expect(after!.ls_subscription_id, 'the subscription id was not recorded, so the row cannot be ' +
      'linked back to LemonSqueezy').toBe('sub_qa_created');
    expect(after!.current_period_end, 'renews_at was not written as the period end').toContain('2099-01-01');

    /* The row must be OBSERVABLY newer. Without this, a handler that wrote
     * nothing would still pass every assertion above on a run where C happened
     * to be left `pro` - and `updated_at` is the only column that cannot be
     * satisfied by the previous state. */
    expect(new Date(after!.updated_at).getTime(),
      'updated_at did not advance, so nothing was written in this request')
      .toBeGreaterThan(new Date(before!.updated_at).getTime());
  });

  /* ── #134, and the reason this file is worth its cost ──────────────────────
   *
   * Cancelling in LemonSqueezy means auto-renew was turned off. The user has
   * PAID through `ends_at` and keeps access until then. The original handler
   * shared a branch with `subscription_expired` and downgraded immediately -
   * taking back a period the customer had already bought.
   *
   * `lib/lemonsqueezy.ts` returns a patch with NO `role` key for this event, and
   * relies on Supabase omitting absent columns from the ON CONFLICT update set.
   * That is a real assumption about upsert semantics, it is invisible in the
   * unit test - which only inspects the returned object - and it is precisely
   * the kind of thing that works until a client library version changes it.
   *
   * This is the only test anywhere that would notice. */
  test('`subscription_cancelled` records the cancellation but does NOT revoke pro', async ({ request }) => {
    expect((await readRow())!.role, 'precondition: C must be pro before cancelling').toBe('pro');

    await send(request, 'subscription_cancelled', {
      status: 'cancelled',
      ends_at: '2099-06-01T00:00:00Z',
    }, 'sub_qa_cancelled');

    const after = await readRow();
    expect(after!.role, 'REGRESSION OF #134: a cancelled subscription lost Pro immediately, ' +
      'taking back a period the customer already paid for. The patch omits `role` on purpose - ' +
      'if this fails, the upsert is no longer leaving absent columns alone.').toBe('pro');
    expect(after!.ls_status, 'the cancellation was not recorded, so support and /ops cannot tell a ' +
      'cancelled subscription from an active one').toBe('cancelled');
    expect(after!.current_period_end, 'ends_at was not written, so nothing knows when access stops')
      .toContain('2099-06-01');
  });

  test('`subscription_expired` is what finally revokes pro', async ({ request }) => {
    expect((await readRow())!.role, 'precondition: C must still be pro after cancellation').toBe('pro');

    await send(request, 'subscription_expired', { status: 'expired' }, 'sub_qa_expired');

    expect((await readRow())!.role, 'the paid period ended and Pro was not revoked - this is the ' +
      'other half of #134: removing cancelled from the revoke set only works if expired still revokes')
      .toBe('free');
  });

  test('`subscription_payment_failed` ends access immediately, with no grace period', async ({ request }) => {
    await resetTo('pro');

    await send(request, 'subscription_payment_failed', { status: 'failed' }, 'invoice_qa_failed');

    const after = await readRow();
    expect(after!.role, 'a failed renewal left Pro in place. Owner decision 2026-08-08: no grace ' +
      'period - they did not pay, so access ends on the FIRST failure').toBe('free');

    /* The payload for this event is an INVOICE, not a subscription, so its
     * `data.id` is an invoice id. Writing that into `ls_subscription_id` would
     * silently corrupt the link to the real subscription - which is why
     * `patchForEvent` omits the column here, and why this asserts it stayed at
     * the value the reset left rather than becoming the invoice id. */
    expect(after!.ls_subscription_id, 'an INVOICE id was written into ls_subscription_id, breaking ' +
      'the link to the real subscription').not.toBe('invoice_qa_failed');
  });

  test('`order_refunded` ends access', async ({ request }) => {
    await resetTo('pro');

    await send(request, 'order_refunded', { status: 'refunded' }, 'order_qa_refunded');

    const after = await readRow();
    /* STATED ASSUMPTION, not an owner decision - `lib/lemonsqueezy.ts` says so
     * in its own comment: the money has been returned, so the customer is not
     * one. One line to reverse, and this test is where it would be reversed. */
    expect(after!.role, 'a refunded order left Pro in place').toBe('free');
    expect(after!.ls_subscription_id, 'an ORDER id was written into ls_subscription_id').not.toBe('order_qa_refunded');
  });

  /* ── The second control ────────────────────────────────────────────────────
   *
   * Every assertion above is of the form "the role is X after event Y". A
   * handler that hardcoded `free`, or one that wrote nothing while C happened to
   * already be `free`, would pass several of them. This proves the file can
   * tell a write apart from a no-op: an event `patchForEvent` returns null for
   * must leave the row COMPLETELY untouched, updated_at included. */
  test('control: an event we do not handle changes nothing at all', async ({ request }) => {
    await resetTo('pro');
    const before = await readRow();

    const body = payload('subscription_plan_changed', { status: 'active' }, 'sub_qa_unhandled');
    const res = await request.post(ENDPOINT, {
      headers: { 'Content-Type': 'application/json', 'x-signature': crypto.createHmac('sha256', SECRET).update(body).digest('hex') },
      data: body,
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(200);
    // Here `ignored` is the CORRECT answer, so this one does not use send().
    expect(await res.text(), 'an unhandled event was acted on').toContain('unhandled_event');

    const after = await readRow();
    expect(after!.role, 'an unhandled event changed the role').toBe(before!.role);
    expect(after!.updated_at, 'an unhandled event wrote to the row - which also means this file ' +
      'cannot distinguish a real write from a no-op, and every assertion above is weaker than it looks')
      .toBe(before!.updated_at);
  });
});
