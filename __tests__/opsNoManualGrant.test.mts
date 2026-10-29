/* #1630 GO-LIVE 4 (#1642): ops can no longer grant Pro by hand, Revoke Pro refuses an account that pays, and every ops number and badge reads the
 * plan the account is on NOW.
 *
 * WHAT THIS PINS: paidByProvider says "paid" for a recorded billing provider, a Lemon Squeezy subscription id or a paid period end, names the
 * processor when it can, and says "not paid" for a hand-set Pro; the ops route has no grant_pro action; revoke_pro reads the row, answers 400 for a
 * non-Pro and 409 for a paid account BEFORE any write, and then writes role only, on the existing row (no upsert that could create one); the
 * overview, the users list and the user detail all take the role from planKindOfRow; the detail page shows Revoke only for a hand-set Pro and has
 * no Grant button.
 *
 * WHAT IT CANNOT PROVE: what the owner sees on the deployed ops pages (the check on qa after promotion, #1630 spare-account test), or the audit log row. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paidByProvider } from '../lib/paidPeriod.ts';
import { appPath } from './_appPath.mts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

test('P1. a payment provider, a Lemon Squeezy subscription or a paid period end means "paid", and the processor is named when known', () => {
  assert.deepEqual(paidByProvider({ role: 'pro', billing_provider: 'whop' }), { paid: true, provider: 'whop' });
  assert.deepEqual(paidByProvider({ role: 'pro', ls_subscription_id: 'sub_123' }), { paid: true, provider: 'lemonsqueezy' });
  assert.deepEqual(paidByProvider({ role: 'pro', current_period_end: '2026-11-21T00:00:00Z' }), { paid: true, provider: null });
  assert.deepEqual(paidByProvider({ role: 'pro', billing_provider: 'whop', ls_subscription_id: 'sub_1' }), { paid: true, provider: 'whop' }, 'the recorded provider wins over a legacy LS id');
});

test('P2. a hand-set Pro (no provider, no LS id, no period end) is "not paid", the only kind Revoke may end; empty strings do not count as payment', () => {
  assert.deepEqual(paidByProvider({ role: 'pro' }), { paid: false, provider: null });
  assert.deepEqual(paidByProvider({ role: 'pro', billing_provider: '', ls_subscription_id: '', current_period_end: null }), { paid: false, provider: null });
  assert.deepEqual(paidByProvider(null), { paid: false, provider: null });
  assert.deepEqual(paidByProvider(undefined), { paid: false, provider: null });
});

test('O1. the ops user route has no grant_pro action; revoke_pro refuses a non-Pro (400) and a paid account (409) before writing role only', () => {
  const src = stripTsComments(read(appPath('app/api/ops/users/[id]/route.ts')));
  assert.ok(!/grant_pro/.test(src), 'grant_pro is back in the ops route');
  assert.ok(/const VALID_ACTIONS: UserAction\[\] = \['revoke_pro', 'ban', 'unban', 'reset_ai_limit'\];/.test(src), 'the action list changed');
  const i400 = src.search(/if \(row\?\.role !== 'pro'\) return NextResponse\.json\(\{ error: 'This account is not on Pro\.' \}, \{ status: 400 \}\);/);
  const i409 = src.search(/const paid = paidByProvider\(row\);\s*if \(paid\.paid\) \{[\s\S]{0,260}\{ status: 409 \}\);/);
  const iWrite = src.search(/\.update\(\{ role: 'free', updated_at: new Date\(\)\.toISOString\(\) \}\)\s*\.eq\('user_id', id\);/);
  assert.ok(i400 > 0 && i409 > 0 && iWrite > 0, `revoke_pro pieces not found (400 @${i400}, 409 @${i409}, write @${iWrite})`);
  assert.ok(i400 < i409 && i409 < iWrite, 'a refusal comes after the write');
  const revoke = src.slice(src.indexOf("case 'revoke_pro':"), src.indexOf("case 'ban':"));
  assert.ok(!/\.upsert\(/.test(revoke), 'revoke_pro upserts again: it could create a subscription row');
});

test('O2. overview, users list and user detail take the role from planKindOfRow; detail reports manualGrant = Pro with no payment', () => {
  const overview = stripTsComments(read(appPath('app/api/ops/overview/route.ts')));
  assert.ok(/const proNow = \(proRows \?\? \[\]\)\.filter\(r => planKindOfRow\(r, now\) === 'pro'\);/.test(overview), 'the Pro count is not planKindOfRow');
  assert.ok(/const activePaying = proNow\.filter\(r => paidByProvider\(r\)\.paid\)\.length;/.test(overview), 'the paying count is not Pro-now plus a provider');
  assert.ok(!/count: 'exact', head: true \}\)\s*\.eq\('role', 'pro'\)/.test(overview), 'a stored-role head count is back');
  const list = stripTsComments(read(appPath('app/api/ops/users/route.ts')));
  assert.ok(/role: planKindOfRow\(s, now\) === 'pro' \? 'pro' : 'free'/.test(list), 'the users list badges the stored role');
  const detail = stripTsComments(read(appPath('app/api/ops/users/[id]/route.ts')));
  assert.ok(/const role = planKindOfRow\(sub\.data, Date\.now\(\)\) === 'pro' \? 'pro' : 'free';/.test(detail));
  assert.ok(/manualGrant: role === 'pro' && !paid\.paid,/.test(detail));
});

test('O3. the ops user page shows Revoke Pro only for a hand-set Pro and has no Grant Pro button', () => {
  const page = stripTsComments(read(appPath('app/ops/users/[id]/page.tsx')));
  assert.ok(/\{data\.subscription\.role === 'pro' && data\.subscription\.manualGrant && \(/.test(page), 'Revoke is not limited to a hand-set Pro');
  assert.ok(!/doAction\('grant_pro'\)|OPS_USER_DETAIL_GRANT_PRO/.test(page), 'a Grant Pro button is back on the page');
});
