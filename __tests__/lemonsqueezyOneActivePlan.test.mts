/* One active plan per account (#1429 cells B and C, Fix B = #1432).
 *
 * Fix A (#1430) stopped a cancel from flipping `role`. It did not stop the OVERWRITE:
 * the webhook keeps ONE row per user and upserts on `user_id`, so an event for ANY of a
 * user's subscriptions replaced the id, status and period end of the one they hold.
 * Observed on `qa` 2026-09-25 (step 4): cancelling an OLD subscription wrote its cancelled
 * id, status and 8 October period end over a live annual that ran to 2027. Fix B adds a
 * gate: `incomingSubscriptionId` says WHICH subscription an event is about,
 * `resolveSubscriptionWrite` says whether it may write the row.
 *
 * THREE LAYERS, because the pure functions cannot catch the failure that matters most:
 *
 *   B    incomingSubscriptionId - where each event keeps its subscription id.
 *   C    resolveSubscriptionWrite - the full matrix, `nowMs` injected.
 *   ROUTE  the REAL route handler, run against a stand-in for the database. A pure test
 *        proves the resolver decides right; only this proves the route ASKS it, passes it
 *        the right arguments, and obeys the answer. The stand-in sits at the network
 *        boundary (`fetch`), so the route and supabase-js run unmodified: the column
 *        list the route selects is honoured (a column it forgets to select comes back
 *        undefined, as it would from PostgREST) and the upsert MERGES like
 *        `resolution=merge-duplicates` does.
 *
 * EVERY EXPECTATION BELOW IS WRITTEN FROM THE OWNER'S RULE (#1396) AND THE PR'S MATRIX,
 * as literal tables. None is computed by calling the code under test.
 *
 * WHAT IS OBSERVED AND WHAT IS ONLY REASONED - the two are not the same and the names say
 * which:
 *   OBSERVED on a real delivery (2026-09-25): a foreign cancel must not disturb a live
 *     subscription; a plan change keeps the SAME id; invoice events carry the
 *     subscription in `attributes.subscription_id`, not `data.id`.
 *   RULE-BASED, never seen on a real delivery: two active subscriptions; resubscribing
 *     during grace. They follow from the owner's rule; no real dual-subscription
 *     delivery was captured.
 *   NOT KNOWN: where `order_refunded` keeps its subscription id. It was never captured, so
 *     it is unmatched BY DESIGN and these tests pin that - they are meant to change the
 *     day a real one is captured.
 *
 * ROUTE-LEVEL CLOCK: the route calls the resolver with the real clock, so its fixtures
 * use dates far from any real "now" (2099 live, 2001 lapsed). The boundary cases are in
 * the pure layer, where `nowMs` is injected.
 *
 * Ids are synthetic; nothing here is a real purchase identifier. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { register } from 'node:module';
import {
  incomingSubscriptionId,
  resolveSubscriptionWrite,
  patchForEvent,
  type StoredSubscription,
} from '../lib/lemonsqueezy.ts';
import { PAID_GRACE_MS } from '../lib/paidPeriod.ts';

/* ══ B — incomingSubscriptionId ═════════════════════════════════════════════════ */

const IN_DATA = ['subscription_created', 'subscription_updated', 'subscription_cancelled', 'subscription_expired'];
const IN_ATTRS = ['subscription_payment_failed', 'subscription_payment_refunded'];

for (const ev of IN_DATA) {
  test(`B1. ${ev}: the subscription id is data.id`, () => {
    assert.equal(incomingSubscriptionId(ev, { subscription_id: 'SHOULD_NOT_WIN' }, 'SUB_1'), 'SUB_1');
  });
  test(`B1b. ${ev}: no data.id is unmatched, never a guess`, () => {
    assert.equal(incomingSubscriptionId(ev, { subscription_id: 'SUB_2' }, ''), null);
    assert.equal(incomingSubscriptionId(ev, {}, undefined), null);
  });
}

for (const ev of IN_ATTRS) {
  test(`B2. ${ev}: the subscription id is attributes.subscription_id, NOT data.id (that is the invoice)`, () => {
    /* data.id is an INVOICE id on these events (real delivery, 2026-09-25). Returning it
       would compare an invoice id against a subscription id: never equal, so every
       payment_failed on the account's OWN subscription would look foreign and be ignored. */
    assert.equal(incomingSubscriptionId(ev, { subscription_id: 'SUB_1' }, 'INVOICE_9'), 'SUB_1');
  });
  test(`B2b. ${ev}: a numeric attributes.subscription_id is normalised to a string`, () => {
    assert.equal(incomingSubscriptionId(ev, { subscription_id: 2552637 }, 'INVOICE_9'), '2552637');
  });
  test(`B2c. ${ev}: missing, empty or non-finite attributes.subscription_id is unmatched, NEVER data.id`, () => {
    assert.equal(incomingSubscriptionId(ev, {}, 'INVOICE_9'), null);
    assert.equal(incomingSubscriptionId(ev, { subscription_id: '' }, 'INVOICE_9'), null);
    assert.equal(incomingSubscriptionId(ev, { subscription_id: Number.NaN }, 'INVOICE_9'), null);
    assert.equal(incomingSubscriptionId(ev, { subscription_id: {} }, 'INVOICE_9'), null);
  });
}

test('B3. order_refunded is UNMATCHED by design, even when both fields are present', () => {
  /* Its subscription link was never captured (the simulate dropdown would not fire), so
     the code refuses to guess. When a real one is captured this test SHOULD change: add
     the event to the id set, then assert the location it really uses. */
  assert.equal(incomingSubscriptionId('order_refunded', { subscription_id: 'SUB_1' }, 'SUB_1'), null);
  assert.equal(incomingSubscriptionId('order_refunded', {}, 'ORDER_5'), null);
});

test('B4. events that never reach the guard, and unknown ones, are unmatched', () => {
  for (const ev of ['subscription_payment_success', 'subscription_payment_recovered', 'subscription_resumed', 'order_created', '']) {
    assert.equal(incomingSubscriptionId(ev, { subscription_id: 'SUB_1' }, 'SUB_1'), null, ev);
  }
});

test('B5. DRIFT: every event patchForEvent acts on has a known subscription-id location, or is order_refunded', () => {
  /* Adding a handled event to patchForEvent without teaching incomingSubscriptionId
     makes it UNMATCHED, so the route reports it and never acts - it fails closed, but
     loudly and forever. This makes that a build-time fact instead of a production one.
     "Handled" is measured through patchForEvent itself (non-null), from the events
     Lemon Squeezy documents, so a new one is caught when it is added to a set there. */
  const candidates = [
    'order_created', 'order_refunded',
    'subscription_created', 'subscription_updated', 'subscription_cancelled', 'subscription_resumed',
    'subscription_expired', 'subscription_paused', 'subscription_unpaused',
    'subscription_payment_success', 'subscription_payment_failed', 'subscription_payment_recovered',
    'subscription_payment_refunded',
    'license_key_created', 'license_key_updated', 'affiliate_activated',
  ];
  const handled = candidates.filter((ev) => patchForEvent(ev, { status: 'active' }, 'X') !== null);
  assert.ok(handled.length >= 5, `only ${handled.length} events measured as handled - the probe is broken: ${handled.join(', ')}`);
  const unlocated = handled.filter(
    (ev) => ev !== 'order_refunded' && incomingSubscriptionId(ev, { subscription_id: 'S' }, 'S') === null,
  );
  assert.deepEqual(unlocated, [], `handled events with no known subscription-id location: ${unlocated.join(', ')}`);
  for (const ev of [...IN_DATA, ...IN_ATTRS, 'order_refunded']) {
    assert.ok(handled.includes(ev), `${ev} is no longer handled by patchForEvent - update this test or the id sets`);
  }
});

/* ══ C — resolveSubscriptionWrite: the matrix ═══════════════════════════════════ */

const NOW = Date.UTC(2030, 5, 1);
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const row = (over: Partial<StoredSubscription> = {}): StoredSubscription => ({
  ls_subscription_id: 'SUB_A', role: 'pro', ls_status: 'active', current_period_end: iso(NOW + 30 * DAY), ...over,
});

type Action = 'apply' | 'ignore' | 'report';
const STATUSES = ['active', 'cancelled', 'expired', 'past_due', 'paused', 'on_trial', ''] as const;
const ALL = (a: Action): Record<string, Action> => Object.fromEntries(STATUSES.map((s) => [s, a]));

/* stored liveness -> the row, and what a DIFFERENT incoming subscription may do, by its status.
   Written from the PR's matrix, not from the code. */
const DIFFERENT: { name: string; stored: StoredSubscription | null; want: Record<string, Action> }[] = [
  { name: 'no row at all', stored: null, want: ALL('apply') },
  { name: 'free, never paid', stored: row({ role: 'free', ls_subscription_id: null, ls_status: '', current_period_end: null }), want: ALL('apply') },
  { name: 'free, an old subscription expired', stored: row({ role: 'free', ls_status: 'expired', current_period_end: iso(NOW - 90 * DAY) }), want: ALL('apply') },
  { name: 'free, access ended by a failed payment (the id and a FUTURE period end are kept)', stored: row({ role: 'free', ls_status: 'past_due', current_period_end: iso(NOW + 10 * DAY) }), want: ALL('apply') },
  { name: 'pro, cancelled and PAST its end by more than the backstop', stored: row({ ls_status: 'cancelled', current_period_end: iso(NOW - PAID_GRACE_MS - 1) }), want: ALL('apply') },
  { name: 'pro, active, period in the future', stored: row(), want: { ...ALL('ignore'), active: 'report' } },
  { name: 'pro, active, period ended but still inside the backstop', stored: row({ current_period_end: iso(NOW - DAY) }), want: { ...ALL('ignore'), active: 'report' } },
  { name: 'pro, cancelled but IN GRACE (paid through a future date)', stored: row({ ls_status: 'cancelled', current_period_end: iso(NOW + 10 * DAY) }), want: { ...ALL('ignore'), active: 'apply' } },
];

for (const { name, stored, want } of DIFFERENT) {
  test(`C1. a DIFFERENT subscription, stored row = ${name}`, () => {
    for (const status of STATUSES) {
      const d = resolveSubscriptionWrite(stored, 'SUB_B', status, NOW);
      assert.equal(d.action, want[status], `incoming status "${status}" -> ${d.action}, wanted ${want[status]}`);
    }
  });
}

test('C2. the SAME subscription always applies - plan changes and renewals keep the id (observed 2026-09-25)', () => {
  for (const { name, stored } of DIFFERENT) {
    if (!stored?.ls_subscription_id) continue; // no stored id means there is nothing for it to be the same as
    for (const status of STATUSES) {
      const d = resolveSubscriptionWrite(stored, stored.ls_subscription_id, status, NOW);
      assert.equal(d.action, 'apply', `${name} / ${status}`);
    }
  }
});

test('C3. an event with no subscription id is REPORTED against every stored row, and never applied', () => {
  for (const { name, stored } of DIFFERENT) {
    for (const id of [null, '']) {
      for (const status of STATUSES) {
        const d = resolveSubscriptionWrite(stored, id, status, NOW);
        assert.equal(d.action, 'report', `${name} / id ${JSON.stringify(id)} / ${status}`);
      }
    }
  }
});

test('C4. BOUNDARY: the row is live for exactly the backstop after its period end, and takeable one millisecond later', () => {
  const at = (msPastEnd: number) => row({ current_period_end: iso(NOW - msPastEnd) });
  // exactly PAID_GRACE_MS past the end: still live, so a foreign cancel is ignored
  assert.equal(resolveSubscriptionWrite(at(PAID_GRACE_MS), 'SUB_B', 'cancelled', NOW).action, 'ignore');
  assert.equal(resolveSubscriptionWrite(at(PAID_GRACE_MS), 'SUB_B', 'active', NOW).action, 'report');
  // one millisecond further: lapsed, so anything takes over
  assert.equal(resolveSubscriptionWrite(at(PAID_GRACE_MS + 1), 'SUB_B', 'cancelled', NOW).action, 'apply');
  assert.equal(resolveSubscriptionWrite(at(PAID_GRACE_MS + 1), 'SUB_B', 'active', NOW).action, 'apply');
});

test('C5. the injected clock is honoured, not the real one', () => {
  const stored = row({ current_period_end: '2099-01-01T00:00:00.000Z' });
  assert.equal(resolveSubscriptionWrite(stored, 'SUB_B', 'cancelled', Date.UTC(2050, 0, 1)).action, 'ignore');
  assert.equal(resolveSubscriptionWrite(stored, 'SUB_B', 'cancelled', Date.UTC(2100, 0, 1)).action, 'apply');
});

test('C6. ignore and report carry a reason a human can act on; apply carries none', () => {
  const ignore = resolveSubscriptionWrite(row(), 'SUB_B', 'cancelled', NOW);
  const report = resolveSubscriptionWrite(row(), 'SUB_B', 'active', NOW);
  assert.ok(ignore.action === 'ignore' && ignore.reason.length > 20, JSON.stringify(ignore));
  assert.ok(report.action === 'report' && report.reason.length > 20, JSON.stringify(report));
  assert.deepEqual(resolveSubscriptionWrite(null, 'SUB_B', 'active', NOW), { action: 'apply' });
});

test('C7. the resolver does not touch the row it is given', () => {
  const frozen = Object.freeze(row());
  assert.doesNotThrow(() => resolveSubscriptionWrite(frozen, 'SUB_B', 'cancelled', NOW));
  assert.doesNotThrow(() => resolveSubscriptionWrite(frozen, 'SUB_A', 'active', NOW));
});

test('C8. THE PROVEN CASE, pure: the step-4 before-row and a foreign cancel is ignored', () => {
  // pro / active / the Monthly's id / 2027 - and the old subscription's `cancelled`
  const before = row({ ls_subscription_id: 'SUB_MONTHLY', current_period_end: '2099-09-25T20:39:41.000Z' });
  assert.equal(resolveSubscriptionWrite(before, 'SUB_OLD_TWO_WEEK', 'cancelled', NOW).action, 'ignore');
});

/* ── A pro row with NO subscription on record (found in the #1432 review, fixed in 3359e2a9) ─
 * Admin grants and rows written before the column existed have `role = pro` and no
 * subscription id. There is no stored subscription for the guard to protect, so an event
 * applies: "no stored subscription id = no stored subscription = apply" (Dev's rule, and
 * the one I proposed). As first shipped such a row counted as "live", so the account's
 * first real purchase was reported and dropped, and every later event for it was too.
 * NOTE what the rule does not do: a first event that is NOT active (a purchase whose first
 * delivery is a failure) also applies, so it can demote an admin grant. Reasoned, not
 * observed; nothing here asserts otherwise. */
const NO_SUB_PRO = row({ ls_subscription_id: null, ls_status: '', current_period_end: null });
test('C9. a pro row with no subscription id (admin grant / pre-column row) lets a first purchase take over', () => {
  for (const status of STATUSES) {
    assert.equal(resolveSubscriptionWrite(NO_SUB_PRO, 'SUB_FIRST', status, NOW).action, 'apply', `incoming "${status}"`);
  }
});

test('C10. the rule turns on the subscription ID alone: the same row WITH an id is still protected, and an empty id counts as none', () => {
  const same = { role: 'pro', ls_status: 'active', current_period_end: iso(NOW + 30 * DAY) } as const;
  for (const id of [null, '']) {
    const r = { ...same, ls_subscription_id: id };
    assert.equal(resolveSubscriptionWrite(r, 'SUB_B', 'cancelled', NOW).action, 'apply', `id ${JSON.stringify(id)} / cancelled`);
    assert.equal(resolveSubscriptionWrite(r, 'SUB_B', 'active', NOW).action, 'apply', `id ${JSON.stringify(id)} / active`);
  }
  const held = { ...same, ls_subscription_id: 'SUB_A' };
  assert.equal(resolveSubscriptionWrite(held, 'SUB_B', 'cancelled', NOW).action, 'ignore');
  assert.equal(resolveSubscriptionWrite(held, 'SUB_B', 'active', NOW).action, 'report');
});

test('C11. an event with no subscription id is still REPORTED against an id-less row (unmatched comes before "nothing to protect")', () => {
  for (const id of [null, '']) {
    assert.equal(resolveSubscriptionWrite(NO_SUB_PRO, id, 'active', NOW).action, 'report');
  }
});

/* ══ ROUTE — the real handler against a stand-in database ═══════════════════════ */

const UID = '00000000-0000-4000-8000-0000000000a1';
const SECRET = 'route_test_secret_not_a_real_one';
const EMAIL = 'buyer@example.com';

process.env.NEXT_PUBLIC_APP_ENV = 'dev';               // dev tables, and test_mode events are accepted
process.env.LEMONSQUEEZY_WEBHOOK_SECRET = SECRET;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://stand-in.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stand_in_key';

/* `apiError` (the report path) calls `Sentry.captureException` through a namespace import.
   Loaded straight by Node, `@sentry/nextjs` exposes no named `captureException` to that
   import (CJS/ESM interop; Next's bundler resolves it fine), so the first REPORT would
   crash the route here and prove nothing about the guard. Stubbed for this file only.
   What is asserted instead is the line `apiError` logs before it reports. */
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (specifier === '@sentry/nextjs') {
      return { url: 'data:text/javascript,export function captureException(){}', shortCircuit: true };
    }
    return next(specifier, context);
  }`));

type Row = Record<string, unknown>;
const db = {
  rows: new Map<string, Row>(),
  hashes: new Set<string>(),
  upserts: [] as Row[],
  failStoredRead: false,
};
const resetDb = () => { db.rows.clear(); db.hashes.clear(); db.upserts.length = 0; db.failStoredRead = false; };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = (async (input: unknown, init: { method?: string; body?: string } = {}) => {
  const url = new URL(String((input as { url?: string })?.url ?? input));
  const method = init.method ?? 'GET';
  if (url.pathname.startsWith('/auth/v1/admin/users/')) return json({ id: UID, email: EMAIL });
  if (url.pathname.endsWith('_ls_webhook_events')) {
    const { payload_hash } = JSON.parse(init.body ?? '{}');
    if (db.hashes.has(payload_hash)) return json({ code: '23505', message: 'duplicate key value', details: '', hint: '' }, 409);
    db.hashes.add(payload_hash);
    return json([{ payload_hash }], 201);
  }
  if (url.pathname.endsWith('_user_subscriptions')) {
    if (method === 'GET') {
      if (db.failStoredRead) return json({ code: 'XX000', message: 'stand-in: read failed', details: '', hint: '' }, 500);
      const uid = (url.searchParams.get('user_id') ?? '').replace(/^eq\./, '');
      const stored = db.rows.get(uid);
      if (!stored) return json([]);
      const cols = (url.searchParams.get('select') ?? '*').split(',');
      return json([cols[0] === '*' ? stored : Object.fromEntries(cols.map((c) => [c, stored[c]]))]);
    }
    const body = JSON.parse(init.body ?? '{}') as Row; // POST with merge-duplicates: only the columns sent change
    db.upserts.push(structuredClone(body));
    db.rows.set(String(body.user_id), { ...(db.rows.get(String(body.user_id)) ?? {}), ...body });
    return new Response(null, { status: 201 });
  }
  throw new Error(`stand-in database got an unexpected request: ${method} ${url}`);
}) as typeof fetch;

let nonce = 0;
async function deliver(
  event: string,
  dataId: string,
  attributes: Record<string, unknown>,
  opts: { repeat?: boolean } = {},
) {
  const body = JSON.stringify({
    meta: { event_name: event, custom_data: { user_id: UID } },
    // the nonce keeps two otherwise-identical deliveries distinct, as the replay guard hashes the body
    data: { id: dataId, attributes: { user_email: EMAIL, test_mode: true, nonce: opts.repeat ? 0 : ++nonce, ...attributes } },
  });
  const signature = crypto.createHmac('sha256', SECRET).update(body).digest('hex'); // independent of the code under test
  const { POST } = await import('../app/api/lemonsqueezy/webhook/route.ts');
  const res = await POST(new Request('http://x/api/lemonsqueezy/webhook', { method: 'POST', headers: { 'x-signature': signature }, body }) as never);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const MONTHLY: Row = {
  user_id: UID, role: 'pro', ls_status: 'active', ls_subscription_id: 'SUB_MONTHLY',
  ls_customer_id: 'CUST_1', current_period_end: '2099-09-25T20:39:41.000Z', updated_at: '2026-09-25T20:39:48.108Z',
};
const seed = (over: Row = {}) => { db.rows.set(UID, { ...MONTHLY, ...over }); return structuredClone(db.rows.get(UID)!); };
const now = () => structuredClone(db.rows.get(UID));
const OLD_CANCELLED = { status: 'cancelled', renews_at: '2098-10-08T05:26:55.000000Z', ends_at: '2098-10-08T05:26:55.000000Z' };

test('R1. THE PROVEN CASE (#1429 step 4): a foreign cancel leaves a live plan-changed annual untouched', async () => {
  resetDb();
  const before = seed();
  const res = await deliver('subscription_updated', 'SUB_OLD_TWO_WEEK', OLD_CANCELLED);
  assert.deepEqual(res.body, { received: true, ignored: 'different_subscription' });
  assert.deepEqual(now(), before, 'the live row changed');
  assert.equal(db.upserts.length, 0, 'the row was written');
});

test('R1b. the OBSERVED step-4 sequence (updated, cancelled, updated) leaves the row untouched, and every delivery is still recorded', async () => {
  resetDb();
  const before = seed();
  for (const ev of ['subscription_updated', 'subscription_cancelled', 'subscription_updated']) {
    const res = await deliver(ev, 'SUB_OLD_TWO_WEEK', OLD_CANCELLED);
    assert.equal(res.body.ignored, 'different_subscription', ev);
  }
  assert.deepEqual(now(), before);
  assert.equal(db.upserts.length, 0);
  // the PR's claim: an ignored delivery is not lost, the replay guard already wrote it
  assert.equal(db.hashes.size, 3, 'ignored deliveries were not recorded');
});

test('R2. CONTROL: the account\'s OWN subscription still writes (a renewal / plan change keeps the id)', async () => {
  resetDb();
  seed();
  const res = await deliver('subscription_updated', 'SUB_MONTHLY', { status: 'active', renews_at: '2100-09-25T20:39:41.000000Z' });
  assert.deepEqual(res.body, { received: true });
  const r = now()!;
  assert.equal(r.ls_subscription_id, 'SUB_MONTHLY');
  assert.equal(r.role, 'pro');
  assert.equal(r.current_period_end, '2100-09-25T20:39:41.000000Z', 'the new period end was not written');
  assert.equal(db.upserts.length, 1);
});

test('R3. CONTROL: a first subscription on an account with no row writes one', async () => {
  resetDb();
  const res = await deliver('subscription_created', 'SUB_FIRST', { status: 'active', renews_at: '2099-01-01T00:00:00.000000Z' });
  assert.deepEqual(res.body, { received: true });
  assert.equal(now()?.ls_subscription_id, 'SUB_FIRST');
  assert.equal(now()?.role, 'pro');
});

test('R4. a new subscription TAKES OVER a row whose old subscription is over', async () => {
  resetDb();
  seed({ role: 'free', ls_status: 'expired', current_period_end: '2001-01-01T00:00:00.000Z' });
  const res = await deliver('subscription_created', 'SUB_NEW', { status: 'active', renews_at: '2099-01-01T00:00:00.000000Z' });
  assert.deepEqual(res.body, { received: true });
  assert.equal(now()?.ls_subscription_id, 'SUB_NEW');
  assert.equal(now()?.role, 'pro');
});

test('R4b. a new subscription takes over a PRO row whose period ended beyond the backstop (it has not been demoted yet)', async () => {
  /* Only reachable if the route SELECTS current_period_end - a column it forgets to ask
     for comes back undefined, the period never looks lapsed, and the row looks live. */
  resetDb();
  seed({ ls_status: 'active', current_period_end: '2001-01-01T00:00:00.000Z' }); // ACTIVE, not cancelled: a cancelled row would take over by the grace rule and pass for the wrong reason
  const res = await deliver('subscription_created', 'SUB_NEW', { status: 'active', renews_at: '2099-01-01T00:00:00.000000Z' });
  assert.deepEqual(res.body, { received: true });
  assert.equal(now()?.ls_subscription_id, 'SUB_NEW');
});

test('R15. after a FAILED PAYMENT ended access (role free, id and period end kept), a new subscription takes over', async () => {
  /* The natural sequence: the card fails, then the customer subscribes again. payment_failed
     writes only role and status, so the row keeps the old id and a period end in the FUTURE.
     Treated as "live" that row would refuse the re-subscription: the customer pays and the
     purchase is reported and dropped. Only the role check tells the two apart. */
  resetDb();
  seed();
  const failed = await deliver('subscription_payment_failed', 'INVOICE_7', { subscription_id: 'SUB_MONTHLY', status: 'paid' });
  assert.deepEqual(failed.body, { received: true });
  assert.equal(now()?.role, 'free', 'precondition: the failed payment ended access');
  assert.equal(now()?.current_period_end, MONTHLY.current_period_end, 'precondition: the period end is still in the future');
  const res = await deliver('subscription_created', 'SUB_RESUBSCRIBED', { status: 'active', renews_at: '2100-01-01T00:00:00.000000Z' });
  assert.deepEqual(res.body, { received: true });
  const r = now()!;
  assert.equal(r.ls_subscription_id, 'SUB_RESUBSCRIBED');
  assert.equal(r.role, 'pro');
});

test('R5. RULE-BASED, never observed: a second ACTIVE subscription is reported and does not overwrite', async (t) => {
  resetDb();
  const before = seed();
  const err = t.mock.method(console, 'error', () => {});
  const res = await deliver('subscription_created', 'SUB_SECOND', { status: 'active', renews_at: '2099-01-01T00:00:00.000000Z' });
  assert.deepEqual(res.body, { received: true, ignored: 'subscription_mismatch_reported' });
  assert.deepEqual(now(), before);
  assert.equal(db.upserts.length, 0);
  const logged = err.mock.calls.map((c) => String(c.arguments[0])).join('\n');
  assert.match(logged, /subscription-identity guard/, 'a reported event must reach GlitchTip, not just be dropped');
});

test('R6. RULE-BASED, never observed: resubscribing during grace TAKES OVER the cancelled subscription', async () => {
  resetDb();
  seed({ ls_status: 'cancelled', ls_subscription_id: 'SUB_CANCELLED_IN_GRACE', current_period_end: '2099-10-08T00:00:00.000Z' });
  const res = await deliver('subscription_created', 'SUB_RESUBSCRIBED', { status: 'active', renews_at: '2100-01-01T00:00:00.000000Z' });
  assert.deepEqual(res.body, { received: true });
  const r = now()!;
  assert.equal(r.ls_subscription_id, 'SUB_RESUBSCRIBED', 'a customer who resubscribed in grace pays and gets nothing');
  assert.equal(r.ls_status, 'active');
  assert.equal(r.role, 'pro');
});

test('R7. order_refunded is REPORTED and downgrades nothing - even for the account\'s own subscription (id location uncaptured)', async (t) => {
  resetDb();
  const before = seed();
  const err = t.mock.method(console, 'error', () => {});
  // the fields a real one MIGHT carry are all present and all point at the live subscription: still unmatched
  const res = await deliver('order_refunded', 'SUB_MONTHLY', { status: 'refunded', subscription_id: 'SUB_MONTHLY' });
  assert.deepEqual(res.body, { received: true, ignored: 'subscription_mismatch_reported' });
  assert.deepEqual(now(), before);
  assert.match(err.mock.calls.map((c) => String(c.arguments[0])).join('\n'), /subscription-identity guard/);
});

for (const ev of ['subscription_payment_failed', 'subscription_payment_refunded']) {
  test(`R8. ${ev} on the account's OWN subscription ends access, matched through attributes.subscription_id`, async () => {
    resetDb();
    seed();
    // data.id is the INVOICE id, a different value from the stored subscription id
    const res = await deliver(ev, 'INVOICE_1', { subscription_id: 'SUB_MONTHLY', status: 'paid' });
    assert.deepEqual(res.body, { received: true });
    const r = now()!;
    assert.equal(r.role, 'free');
    /* Nothing is asserted about ls_status: the simulated payload re-uses a PAID invoice, so
       what it writes is a simulation artifact, not what a real failure writes. */
    assert.equal(r.ls_subscription_id, 'SUB_MONTHLY', 'ENDS_ACCESS must not rewrite the subscription id');
    assert.equal(r.current_period_end, MONTHLY.current_period_end, 'ENDS_ACCESS must not rewrite the period end');
  });

  test(`R8b. ${ev} for a DIFFERENT subscription is ignored and the live row survives`, async () => {
    resetDb();
    const before = seed();
    const res = await deliver(ev, 'INVOICE_2', { subscription_id: 'SUB_OLD_TWO_WEEK', status: 'paid' });
    assert.deepEqual(res.body, { received: true, ignored: 'different_subscription' });
    assert.deepEqual(now(), before);
  });

  test(`R8c. ${ev}: the invoice id happening to EQUAL the stored subscription id does not make it the account's own`, async () => {
    /* The trap in one test: read data.id and this event would match the live row and
       downgrade a paying customer for an invoice that belongs to somebody else's plan. */
    resetDb();
    const before = seed();
    const res = await deliver(ev, 'SUB_MONTHLY', { subscription_id: 'SUB_OLD_TWO_WEEK', status: 'paid' });
    assert.deepEqual(res.body, { received: true, ignored: 'different_subscription' });
    assert.deepEqual(now(), before);
  });
}

test('R9. CONTROL: payment_success for a foreign subscription is still ignored BEFORE the guard (#1422 path unchanged)', async () => {
  resetDb();
  const before = seed();
  const res = await deliver('subscription_payment_success', 'INVOICE_3', { subscription_id: 'SUB_OLD_TWO_WEEK', status: 'paid' });
  assert.deepEqual(res.body, { received: true, ignored: 'unhandled_event' });
  assert.deepEqual(now(), before);
});

test('R10. CONTROL: a byte-identical redelivery is still dropped as a replay', async () => {
  resetDb();
  seed();
  const a = await deliver('subscription_updated', 'SUB_MONTHLY', { status: 'active', renews_at: '2100-01-01T00:00:00.000000Z' }, { repeat: true });
  const b = await deliver('subscription_updated', 'SUB_MONTHLY', { status: 'active', renews_at: '2100-01-01T00:00:00.000000Z' }, { repeat: true });
  assert.deepEqual(a.body, { received: true });
  assert.deepEqual(b.body, { received: true, ignored: 'replay' });
  assert.equal(db.upserts.length, 1);
});

/* ── Two findings from the #1432 review, fixed in 3359e2a9 ─────────────────────────────────
 * They were `todo` tests (run, fail, never fail the suite) until the fix landed. */

/* A FAILED read of the stored row is a third state, "unknown", not "no row". Treated as "no
   row" the guard applied whatever arrived - the #1429 defect re-entered through the error
   path (found by running this against f543fe69). Fails closed: 200, nothing written, reported.
   200 rather than 5xx on purpose: the replay hash is already recorded, so a retry would be
   dropped. A consequence worth knowing, and NOT asserted as wanted: an event that arrives
   while the read is failing is not applied and is not retried. */
const READ_FAILS: { name: string; stored: boolean; event: string; id: string; attrs: Record<string, unknown> }[] = [
  { name: 'a foreign cancel on a live row', stored: true, event: 'subscription_updated', id: 'SUB_OLD_TWO_WEEK', attrs: OLD_CANCELLED },
  { name: "the account's own renewal", stored: true, event: 'subscription_updated', id: 'SUB_MONTHLY', attrs: { status: 'active', renews_at: '2100-01-01T00:00:00.000000Z' } },
  { name: 'a first subscription on an account with no row', stored: false, event: 'subscription_created', id: 'SUB_FIRST', attrs: { status: 'active', renews_at: '2099-01-01T00:00:00.000000Z' } },
];
for (const c of READ_FAILS) {
  test(`R11. a FAILED stored-row read fails closed - ${c.name}: nothing written, 200 not 5xx, reported`, async (t) => {
    resetDb();
    const before = c.stored ? seed() : undefined;
    const err = t.mock.method(console, 'error', () => {});
    db.failStoredRead = true;
    const res = await deliver(c.event, c.id, c.attrs);
    assert.equal(res.status, 200, 'a 5xx makes Lemon Squeezy retry, and the retry is dropped as a replay');
    assert.deepEqual(res.body, { received: true, ignored: 'stored_read_failed' });
    assert.equal(db.upserts.length, 0, 'the row was written while the read was failing');
    assert.deepEqual(now(), before, 'the row changed');
    assert.match(err.mock.calls.map((x) => String(x.arguments[0])).join('\n'), /stored-subscription read failed/, 'a failed read must reach GlitchTip');
  });
}

test('R12. a pro row with no subscription id (admin grant / pre-column row) records the customer\'s first purchase', async () => {
  resetDb();
  seed({ ls_subscription_id: null, ls_status: '', current_period_end: null });
  const res = await deliver('subscription_created', 'SUB_FIRST', { status: 'active', renews_at: '2099-01-01T00:00:00.000000Z' });
  assert.deepEqual(res.body, { received: true });
  const r = now()!;
  assert.equal(r.ls_subscription_id, 'SUB_FIRST');
  assert.equal(r.role, 'pro');
  assert.equal(r.current_period_end, '2099-01-01T00:00:00.000000Z');
});

test('R13. the same row WITH a subscription id is still protected from a foreign cancel (the id-less rule did not over-apply)', async () => {
  resetDb();
  const before = seed({ ls_subscription_id: 'SUB_HELD' });
  const res = await deliver('subscription_updated', 'SUB_OLD_TWO_WEEK', OLD_CANCELLED);
  assert.deepEqual(res.body, { received: true, ignored: 'different_subscription' });
  assert.deepEqual(now(), before);
});

test('R14. once the first purchase has recorded, the id-less rule no longer applies: a later foreign cancel is ignored', async () => {
  resetDb();
  seed({ ls_subscription_id: null, ls_status: '', current_period_end: null });
  await deliver('subscription_created', 'SUB_FIRST', { status: 'active', renews_at: '2099-01-01T00:00:00.000000Z' });
  const recorded = now();
  const res = await deliver('subscription_updated', 'SUB_OLD_TWO_WEEK', OLD_CANCELLED);
  assert.deepEqual(res.body, { received: true, ignored: 'different_subscription' });
  assert.deepEqual(now(), recorded);
});
