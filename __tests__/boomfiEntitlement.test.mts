/* #861 Phase 1b: what a BoomFi event means for an account's plan (25800d4d).
 *
 * `decideBoomfiEntitlement` is a PURE function that nothing calls yet. It takes
 * facts already read out of a verified event and returns one of four actions:
 * apply (with a patch), unmatched, report, ignore. This is the code that will
 * one day decide who is Pro from a crypto payment, so the direction of every
 * mistake matters:
 *
 *   - granting Pro to the wrong account, or to nobody's account, or for ever;
 *   - taking away time somebody paid for;
 *   - letting one subscription's event disturb another's.
 *
 * Every test below calls the real function. Nothing is stubbed; there is nothing
 * to stub.
 *
 * WHAT THIS CANNOT SHOW: that the facts will be right. They come from an
 * "extractor" that does not exist, because nobody has seen a BoomFi payload. A
 * correct decision on wrong facts is still a wrong plan.
 *
 * TWO RULINGS BY PM/DevOps on #861 (2026-09-30 16:14Z, the owner's to overrule),
 * asserted here:
 *   1. The payer's email differs from the account the link named: credit the
 *      account the link named and record the difference (M1-M3).
 *   2. "Overdue" must not end access on the word alone: it grants nothing,
 *      extends nothing, takes nothing away, and is reported (V1). The code at
 *      25800d4d predates this ruling and still ends access at once, so V1 is a
 *      `todo` until Dev changes it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decideBoomfiEntitlement, looksLikeAccountId,
  type BoomfiFacts, type BoomfiAccount, type StoredPlan, type BoomfiState, type BoomfiDecision,
} from '../lib/boomfiEntitlement.ts';
import { PAID_GRACE_MS } from '../lib/paidPeriod.ts';

const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const FUTURE = iso(NOW + 7 * DAY);
const PAST = iso(NOW - 7 * DAY);

const UID = '11111111-2222-4333-8444-555555555555';
const OTHER_UID = '99999999-9999-4999-8999-999999999999';
const SUB = 'sub_fixture_new';
const OLD_SUB = 'sub_fixture_old';
const STATES: BoomfiState[] = ['active', 'cancelled', 'overdue', 'ended'];

const ACCOUNT: BoomfiAccount = { id: UID, email: 'owner@example.test' };
const facts = (over: Partial<BoomfiFacts> = {}): BoomfiFacts => ({
  state: 'active', accountId: UID, payerEmail: 'owner@example.test', subscriptionId: SUB, customerId: 'cus_fixture', paidThrough: FUTURE, ...over,
});
const stored = (over: Partial<StoredPlan> = {}): StoredPlan => ({
  role: 'pro', provider: 'boomfi', subscriptionId: OLD_SUB, status: 'active', currentPeriodEnd: FUTURE, ...over,
});
const decide = (f: BoomfiFacts, a: BoomfiAccount | null = ACCOUNT, s: StoredPlan | null = null) => decideBoomfiEntitlement(f, a, s, NOW);
const patchOf = (d: BoomfiDecision) => { assert.equal(d.action, 'apply', `expected apply, got ${d.action}: ${'reason' in d ? d.reason : ''}`); return (d as Extract<BoomfiDecision, { action: 'apply' }>).patch; };
const UNREADABLE_DATES: Array<string | null> = [null, '', 'garbage', 'Invalid Date', '2026-13-45', '1790000000', '{}'];

/* ══ CONTROL ══ */

test('A0. CONTROL: a clean active event for a known account with a future paid-through date is applied as Pro until that date', () => {
  const d = decide(facts());
  assert.deepEqual(d, { action: 'apply', patch: { provider: 'boomfi', status: 'active', subscriptionId: SUB, customerId: 'cus_fixture', role: 'pro', currentPeriodEnd: FUTURE } });
});

/* ══ Rule 1: no account, no grant ══ */

test('N1. no account id on the event: unmatched, for every state - a payment is never dropped silently and never credited to a guess', () => {
  for (const state of STATES) for (const accountId of [null, '', '   ']) {
    const d = decide(facts({ state, accountId }));
    assert.equal(d.action, 'unmatched', `state=${state} accountId=${JSON.stringify(accountId)} -> ${d.action}`);
  }
});

test('N2. an id that is not shaped like one of ours is unmatched before anything else - an email, a number, a near-UUID, an injection attempt', () => {
  const bad = ['owner@example.test', '12345', 'cus_fixture', UID.slice(0, -1), UID + 'a', UID.replace(/-/g, ''), `${UID}' or '1'='1`, 'undefined', 'null', '00000000-0000-0000-0000-000000000000'];
  for (const accountId of bad) {
    // Hand it an account anyway: even if a lookup somehow returned one, the shape check must refuse first.
    const d = decide(facts({ accountId }), { id: accountId, email: null });
    assert.equal(d.action, 'unmatched', `accountId=${JSON.stringify(accountId)} -> ${d.action}`);
    assert.equal(looksLikeAccountId(accountId), false, `looksLikeAccountId accepted ${JSON.stringify(accountId)}`);
  }
});

test('N3. a well-formed id that names no account, or a lookup that returned a DIFFERENT account, is unmatched', () => {
  assert.equal(decide(facts(), null).action, 'unmatched');
  assert.equal(decide(facts(), { id: OTHER_UID, email: 'owner@example.test' }).action, 'unmatched', 'the account handed in is not the one the event names - crediting it would credit the wrong person');
  assert.equal(decide(facts({ accountId: OTHER_UID }), ACCOUNT).action, 'unmatched');
});

test('N4. case and surrounding whitespace on the id do not stop a match (ids are compared trimmed, case-insensitively)', () => {
  assert.equal(decide(facts({ accountId: UID.toUpperCase() })).action, 'apply');
  assert.equal(decide(facts({ accountId: `  ${UID}\n` })).action, 'apply');
  assert.equal(looksLikeAccountId(UID), true);
  assert.equal(looksLikeAccountId(null), false);
  assert.equal(looksLikeAccountId(undefined), false);
});

test('N5. no subscription id on the event: reported, never written - it cannot be weighed against the stored subscription', () => {
  for (const state of STATES) for (const subscriptionId of [null, '']) {
    const d = decide(facts({ state, subscriptionId }), ACCOUNT, stored());
    assert.equal(d.action, 'report', `state=${state} -> ${d.action}`);
  }
});

/* ══ Rule 3: a grant needs an end date ══ */

test('G1. active with a missing or unreadable paid-through date is REPORTED, never applied - Pro with no end date never lapses', () => {
  for (const paidThrough of UNREADABLE_DATES) {
    const d = decide(facts({ paidThrough }));
    assert.equal(d.action, 'report', `paidThrough=${JSON.stringify(paidThrough)} -> ${d.action}`);
  }
});

test('G2. active with a paid-through date already past, or exactly now, is reported, not granted', () => {
  for (const paidThrough of [PAST, iso(NOW), iso(NOW - 1), '2001-01-01']) {
    assert.equal(decide(facts({ paidThrough })).action, 'report', `paidThrough=${paidThrough}`);
  }
  assert.equal(decide(facts({ paidThrough: iso(NOW + 1) })).action, 'apply', 'CONTROL: one millisecond in the future is a grant');
});

/* ══ Rule 4: cancelled keeps what was paid for ══ */

test('C1. cancelled with time left: still Pro, until the paid-through date', () => {
  const p = patchOf(decide(facts({ state: 'cancelled' }), ACCOUNT, stored({ subscriptionId: SUB })));
  assert.equal(p.role, 'pro');
  assert.equal(p.currentPeriodEnd, FUTURE);
  assert.equal(p.status, 'cancelled');
});

test('C2. cancelled with the paid period already over: Free', () => {
  const p = patchOf(decide(facts({ state: 'cancelled', paidThrough: PAST }), ACCOUNT, stored({ subscriptionId: SUB })));
  assert.equal(p.role, 'free');
  assert.equal(p.currentPeriodEnd, PAST);
});

test('C3. cancelled with NO readable date: the cancellation is recorded and role and period end are left exactly as stored - never revoked on a guess, never extended on one', () => {
  for (const paidThrough of UNREADABLE_DATES) {
    const p = patchOf(decide(facts({ state: 'cancelled', paidThrough }), ACCOUNT, stored({ subscriptionId: SUB })));
    assert.equal('role' in p, false, `paidThrough=${JSON.stringify(paidThrough)}: the patch writes a role (${p.role})`);
    assert.equal('currentPeriodEnd' in p, false, `paidThrough=${JSON.stringify(paidThrough)}: the patch writes a period end`);
    assert.equal(p.status, 'cancelled');
  }
});

/* ══ Rule 5 and the overdue ruling ══ */

test('V1. RULING: "overdue" grants nothing, extends nothing and takes nothing away - access ends at the paid-through date already stored', { todo: '25800d4d ends access at once on overdue (role: free). PM ruled otherwise on #861 at 16:14Z, after that commit. Flip when Dev changes it.' }, () => {
  for (const paidThrough of [FUTURE, PAST, null]) for (const s of [stored({ subscriptionId: SUB }), null]) {
    const d = decide(facts({ state: 'overdue', paidThrough }), ACCOUNT, s);
    if (d.action === 'apply') {
      assert.equal('role' in d.patch, false, `overdue wrote role=${d.patch.role} (paidThrough=${paidThrough}) - the word alone must not change access`);
      assert.equal('currentPeriodEnd' in d.patch, false, 'overdue wrote a period end - it must not extend or cut the paid period');
    } else {
      assert.equal(d.action, 'report', `overdue was ${d.action}; the ruling says it is reported`);
    }
  }
});

test('V2. "ended" sets the account to Free and writes no period end', () => {
  const p = patchOf(decide(facts({ state: 'ended', paidThrough: PAST }), ACCOUNT, stored({ subscriptionId: SUB })));
  assert.equal(p.role, 'free');
  assert.equal('currentPeriodEnd' in p, false);
  assert.equal(p.status, 'ended');
});

test('V3. QUESTION FOR PM: "ended" arriving while paid time is left should not take that time away', { todo: 'at 25800d4d an ended event with a FUTURE paid-through date sets role free at once. The owner\'s 2026-09-26 rule is that paid time is never removed. Nobody knows whether BoomFi sends "ended" before the period is over; asked on #861.' }, () => {
  const d = decide(facts({ state: 'ended', paidThrough: FUTURE }), ACCOUNT, stored({ subscriptionId: SUB }));
  assert.notEqual(d.action === 'apply' ? d.patch.role : undefined, 'free');
});

test('V4. an unrecognised state is reported, not acted on', () => {
  const d = decide(facts({ state: 'paused' as BoomfiState }));
  assert.equal(d.action, 'report');
});

/* ══ Rule 6: one active plan per account ══ */

test('O1. a second ACTIVE subscription while a different one is live is reported and not written - BoomFi or Lemon Squeezy', () => {
  assert.equal(decide(facts(), ACCOUNT, stored()).action, 'report');
  assert.equal(decide(facts(), ACCOUNT, stored({ provider: 'lemonsqueezy', subscriptionId: '12345' })).action, 'report');
  assert.equal(decide(facts(), ACCOUNT, stored({ provider: null, subscriptionId: '12345' })).action, 'report', 'a row older than the provider column still holds a live subscription');
  assert.equal(decide(facts(), ACCOUNT, stored({ provider: 'lemonsqueezy', subscriptionId: SUB })).action, 'report', 'the same id string under a DIFFERENT provider is a different subscription');
  assert.equal(decide(facts(), ACCOUNT, stored({ currentPeriodEnd: null })).action, 'report', 'a live plan with no end date is still live');
  assert.equal(decide(facts(), ACCOUNT, stored({ currentPeriodEnd: iso(NOW - PAID_GRACE_MS + 60_000) })).action, 'report', 'inside the grace window the stored plan has not lapsed yet');
});

test('O2. a NON-active event for a different subscription is ignored - an old subscription ending must not disturb the live one (#1429)', () => {
  for (const state of ['cancelled', 'overdue', 'ended'] as const) for (const paidThrough of [FUTURE, PAST, null]) {
    const d = decide(facts({ state, paidThrough }), ACCOUNT, stored());
    assert.equal(d.action, 'ignore', `state=${state} paidThrough=${paidThrough} -> ${d.action}`);
  }
});

test('O3. a new active subscription takes over when the stored one is cancelled and running out its paid time', () => {
  const p = patchOf(decide(facts(), ACCOUNT, stored({ status: 'cancelled' })));
  assert.equal(p.subscriptionId, SUB);
  assert.equal(p.role, 'pro');
});

test('O4. the SAME subscription is never blocked by rule 6: a renewal applies, its cancellation applies', () => {
  const same = stored({ subscriptionId: SUB });
  assert.equal(decide(facts({ paidThrough: iso(NOW + 14 * DAY) }), ACCOUNT, same).action, 'apply');
  assert.equal(decide(facts({ state: 'cancelled' }), ACCOUNT, same).action, 'apply');
});

test('O5. a stored plan that is not live does not block a new one: Free, lapsed past the grace window, no row, or an admin grant with no subscription', () => {
  const lapsed = iso(NOW - PAID_GRACE_MS - 60_000);
  for (const [what, s] of [
    ['free row', stored({ role: 'free' })],
    ['lapsed beyond grace', stored({ currentPeriodEnd: lapsed })],
    ['no row', null],
    ['admin grant (no subscription id)', stored({ subscriptionId: null, provider: null, currentPeriodEnd: null })],
    ['admin grant (empty subscription id)', stored({ subscriptionId: '', provider: null, currentPeriodEnd: null })],
  ] as const) {
    assert.equal(decide(facts(), ACCOUNT, s).action, 'apply', `${what} blocked a new subscription`);
  }
});

/* ══ Ruling 1: the payer's email ══ */

test('M1. RULING: a payer whose checkout email differs is still credited to the account the link named, and the difference is recorded', () => {
  const d = decide(facts({ payerEmail: 'someone-else@example.test' }));
  assert.equal(d.action, 'apply');
  assert.equal((d as { note?: string }).note, 'payer_email_differs');
  assert.deepEqual(patchOf(d), patchOf(decide(facts())), 'the note changed what is written - it must only be a note');
});

test('M2. the same email in another case or with spaces is not a difference; a missing email on either side is not one either', () => {
  for (const payerEmail of ['OWNER@Example.Test', '  owner@example.test ', null, '']) {
    assert.equal('note' in decide(facts({ payerEmail })), false, `payerEmail=${JSON.stringify(payerEmail)} produced a note`);
  }
  assert.equal('note' in decide(facts({ payerEmail: 'someone-else@example.test' }), { id: UID, email: null }), false);
});

test('M3. the note rides along on every state that is applied, and never appears on a decision that is not', () => {
  const differs = { payerEmail: 'someone-else@example.test' };
  assert.equal((decide(facts({ ...differs, state: 'cancelled' }), ACCOUNT, stored({ subscriptionId: SUB })) as { note?: string }).note, 'payer_email_differs');
  for (const d of [decide(facts({ ...differs, accountId: null })), decide(facts({ ...differs, paidThrough: null })), decide(facts({ ...differs, state: 'ended' }), ACCOUNT, stored())]) {
    assert.notEqual(d.action, 'apply');
    assert.equal('note' in d, false);
  }
});

/* ══ Properties over the whole grid ══ */

const ACCOUNT_IDS = [UID, UID.toUpperCase(), null, '', 'not-an-id', OTHER_UID];
const ACCOUNTS: Array<BoomfiAccount | null> = [ACCOUNT, null, { id: OTHER_UID, email: 'x@example.test' }];
const STORED: Array<StoredPlan | null> = [
  null, stored(), stored({ subscriptionId: SUB }), stored({ status: 'cancelled' }), stored({ role: 'free' }),
  stored({ provider: 'lemonsqueezy', subscriptionId: '777' }), stored({ subscriptionId: null, provider: null, currentPeriodEnd: null }),
  stored({ currentPeriodEnd: PAST }), stored({ currentPeriodEnd: 'garbage' }),
];
const DATES = [FUTURE, PAST, iso(NOW), null, '', 'garbage'];
const SUBS = [SUB, OLD_SUB, null, ''];
const EMAILS = ['owner@example.test', 'someone-else@example.test', null];

function* grid() {
  for (const state of STATES) for (const accountId of ACCOUNT_IDS) for (const account of ACCOUNTS) for (const s of STORED)
    for (const paidThrough of DATES) for (const subscriptionId of SUBS) for (const payerEmail of EMAILS)
      yield { f: facts({ state, accountId, paidThrough, subscriptionId, payerEmail }), account, s };
}

test('X1. over every combination: it never throws, never mutates its inputs, and only ever returns one of the four actions', () => {
  let n = 0;
  for (const { f, account, s } of grid()) {
    const before = JSON.stringify([f, account, s]);
    let d: BoomfiDecision;
    assert.doesNotThrow(() => { d = decideBoomfiEntitlement(f, account, s, NOW); });
    assert.ok(['apply', 'unmatched', 'report', 'ignore'].includes(d!.action));
    assert.equal(JSON.stringify([f, account, s]), before, 'an input was mutated');
    n++;
  }
  assert.ok(n > 10_000, `the grid is smaller than expected (${n}) - the sweep is not covering what it claims`);
});

test('X2. over every combination: Pro is granted ONLY to the account the event names, that exists, with a readable FUTURE end date written beside it', () => {
  let grants = 0;
  for (const { f, account, s } of grid()) {
    const d = decideBoomfiEntitlement(f, account, s, NOW);
    if (d.action !== 'apply') continue;
    assert.ok(account && f.accountId && account.id.toLowerCase() === f.accountId.trim().toLowerCase(), `applied with no matching account: ${JSON.stringify(f)}`);
    assert.equal(d.patch.provider, 'boomfi');
    assert.equal(d.patch.subscriptionId, f.subscriptionId);
    assert.ok(d.patch.subscriptionId, 'applied with no subscription id');
    assert.equal(d.patch.status, f.state);
    if (d.patch.role === 'pro') {
      grants++;
      assert.ok(f.state === 'active' || f.state === 'cancelled', `Pro written on state ${f.state}`);
      const end = Date.parse(String(d.patch.currentPeriodEnd));
      assert.ok(Number.isFinite(end) && end > NOW, `Pro written with no future end date: ${JSON.stringify(d.patch)}`);
      assert.equal(d.patch.currentPeriodEnd, f.paidThrough, 'the end date written is not the one on the event');
    }
  }
  assert.ok(grants > 0, 'CONTROL: the grid never produced a single grant - X2 would pass on nothing');
});

test('X3. over every combination: a live plan on a different subscription is never overwritten, except by a new active one taking over a cancelled one', () => {
  let protectedCases = 0;
  for (const { f, account, s } of grid()) {
    if (!s || s.role !== 'pro' || !s.subscriptionId) continue;
    const end = s.currentPeriodEnd ? Date.parse(s.currentPeriodEnd) : NaN;
    const lapsed = Number.isFinite(end) && end + PAID_GRACE_MS < NOW;
    const same = s.provider === 'boomfi' && s.subscriptionId === f.subscriptionId;
    if (lapsed || same) continue;
    protectedCases++;
    const d = decideBoomfiEntitlement(f, account, s, NOW);
    if (d.action === 'apply') {
      assert.ok(f.state === 'active' && s.status === 'cancelled', `a live plan on another subscription was overwritten: event ${f.state}/${f.subscriptionId}, stored ${s.status}/${s.subscriptionId}`);
    }
  }
  assert.ok(protectedCases > 0, 'CONTROL: no protected case was exercised');
});

test('X4. without an explicit clock the real one is used', () => {
  assert.equal(decideBoomfiEntitlement(facts({ paidThrough: iso(Date.now() + DAY) }), ACCOUNT, null).action, 'apply');
  assert.equal(decideBoomfiEntitlement(facts({ paidThrough: iso(Date.now() - DAY) }), ACCOUNT, null).action, 'report');
});

test('X5. the module is pure: it imports only the paid-period helper - no database, no network, no environment', () => {
  const src = readFileSync(new URL('../lib/boomfiEntitlement.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.deepEqual([...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]), ['./paidPeriod.ts']);
  assert.equal(/process\.env|fetch\(|supabase|await /i.test(src), false, 'the decision reaches outside itself');
});
