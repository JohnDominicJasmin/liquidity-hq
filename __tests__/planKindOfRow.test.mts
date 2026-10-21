/* #1630 GO-LIVE 1 (#1638) and GO-LIVE 2 (#1639): which plan a user_subscriptions row is on NOW, and the places that must ask that one rule.
 *
 * WHAT THIS PINS: planKindOfRow's order (paid Pro unless period end + 48 h has passed; a null or unparseable end never lapses; then trial while the
 * signup window is open; else free), both sides of the exact 48 h boundary and of the trial end. Source pins: every reader that used to decide Pro from
 * role === 'pro' alone now asks planKindOfRow (AuthProvider, the Telegram alert cron, the macro-alert cron, /api/subscription); the #1639 trial ladder
 * in the alert cron runs after the stored mutes are read and before the cost pre-filter, and the preview route applies it; user price alerts do not
 * go through the mute path the ladder uses (a trial user's own XRP price alert still fires); the Free list is exactly BTC, ETH, SOL.
 *
 * WHAT IT CANNOT PROVE: a real lapsed account end to end (needs the seeded lapsed accounts on the dev DB, #1630), a cron delivery to a real chat,
 * or that Whop writes current_period_end on every renewal. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planKindOfRow, PAID_GRACE_MS } from '../lib/paidPeriod.ts';
import { FREE_SIGNAL_COINS } from '../lib/signalCoinGate.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const NOW = Date.parse('2026-10-21T12:00:00Z');
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const pro = (end: string | null | undefined, trialEnd: string | null = null) => ({ role: 'pro', current_period_end: end, trial_ends_at: trialEnd });

test('K1. paid Pro with the period still running is pro', () => {
  assert.equal(planKindOfRow(pro(iso(NOW + 10 * 24 * H)), NOW), 'pro');
});

test('K2. inside the 48 h grace it is still pro: 1 h and 47 h 59 m past the period end', () => {
  assert.equal(PAID_GRACE_MS, 48 * H, 'the grace is 48 h');
  assert.equal(planKindOfRow(pro(iso(NOW - H)), NOW), 'pro');
  assert.equal(planKindOfRow(pro(iso(NOW - 48 * H + 60_000)), NOW), 'pro');
});

test('K3. the exact boundary: 48 h past the end is still pro, 48 h + 1 ms past is free', () => {
  assert.equal(planKindOfRow(pro(iso(NOW - 48 * H)), NOW), 'pro', 'end + 48 h == now');
  assert.equal(planKindOfRow(pro(iso(NOW - 48 * H - 1)), NOW), 'free', 'end + 48 h < now by 1 ms');
  assert.equal(planKindOfRow(pro(iso(NOW - 49 * H)), NOW), 'free', 'the #1630 lapsed case, now - 49 h');
});

test('K4. a null, missing, empty or unparseable period end never lapses (lifetime, admin-set Pro, rows from before the column)', () => {
  for (const end of [null, undefined, '', 'not a date']) assert.equal(planKindOfRow(pro(end), NOW), 'pro', `period end ${JSON.stringify(end)}`);
});

test('K5. a lapsed paid account with its signup trial still open reads trial; with the trial over it reads free', () => {
  assert.equal(planKindOfRow(pro(iso(NOW - 60 * H), iso(NOW + 24 * H)), NOW), 'trial');
  assert.equal(planKindOfRow(pro(iso(NOW - 60 * H), iso(NOW - 24 * H)), NOW), 'free');
});

test('K6. paid Pro outranks an open trial window: a paying account inside its trial is pro, not trial', () => {
  assert.equal(planKindOfRow(pro(iso(NOW + 24 * H), iso(NOW + 24 * H)), NOW), 'pro');
  assert.equal(planKindOfRow(pro(null, iso(NOW + 24 * H)), NOW), 'pro');
});

test('K7. free role: trial while the window is open, free once it ends; the trial end itself is already over (strictly after now)', () => {
  assert.equal(planKindOfRow({ role: 'free', trial_ends_at: iso(NOW + 1) }, NOW), 'trial');
  assert.equal(planKindOfRow({ role: 'free', trial_ends_at: iso(NOW) }, NOW), 'free', 'trial_ends_at == now');
  assert.equal(planKindOfRow({ role: 'free', trial_ends_at: iso(NOW - 1) }, NOW), 'free');
  assert.equal(planKindOfRow({ role: 'free', trial_ends_at: null }, NOW), 'free');
  assert.equal(planKindOfRow({ role: 'free', trial_ends_at: 'garbage' }, NOW), 'free', 'an unparseable trial end grants nothing');
});

test('K8. a period end alone never grants Pro: role free with a future period end is free', () => {
  assert.equal(planKindOfRow({ role: 'free', current_period_end: iso(NOW + 30 * 24 * H), trial_ends_at: null }, NOW), 'free');
});

test('K9. no row, or a row with no role, is free', () => {
  assert.equal(planKindOfRow(null, NOW), 'free');
  assert.equal(planKindOfRow(undefined, NOW), 'free');
  assert.equal(planKindOfRow({}, NOW), 'free');
});

test('K10. without an explicit now it uses the clock: a period ending next year is pro, one that ended last year is free', () => {
  assert.equal(planKindOfRow(pro(iso(Date.now() + 365 * 24 * H))), 'pro');
  assert.equal(planKindOfRow(pro(iso(Date.now() - 365 * 24 * H))), 'free');
});

test('S1. AuthProvider reads the period end and sets the role from planKindOfRow, not from the stored role alone', () => {
  const src = stripTsComments(read('components/AuthProvider.tsx'));
  assert.ok(/from\(T\.user_subscriptions\)\s*\.select\('role, trial_ends_at, current_period_end'\)/.test(src), 'the subscription read does not select current_period_end');
  assert.ok(/setRole\(planKindOfRow\(data, Date\.now\(\)\) === 'pro' \? 'pro' : 'free'\)/.test(src), 'the role is not set from planKindOfRow');
  assert.ok(!/setRole\(data\?\.role === 'pro'/.test(src), 'a stored-role-only setRole is back');
});

test('S2. the Telegram alert cron builds its recipient sets from planKindOfRow (paid Pro and trial in, lapsed out; trial collected for the ladder)', () => {
  const src = stripTsComments(read('app/api/telegram/alert/route.ts'));
  assert.ok(/from\(T\.user_subscriptions\)\.select\('user_id, role, trial_ends_at, current_period_end'\)/.test(src), 'the recipient read does not select current_period_end');
  assert.ok(/const kind = planKindOfRow\(row, now\);\s*if \(kind !== 'free'\) proUserIds\.add\(row\.user_id as string\);\s*if \(kind === 'trial'\) trialUserIds\.add\(row\.user_id as string\);/.test(src), 'proUserIds / trialUserIds are not filled from planKindOfRow');
  assert.ok(!/row\.role === 'pro'/.test(src), 'a stored-role-only check is back in the alert cron');
});

test('S3. the macro-alert cron uses the same rule', () => {
  const src = stripTsComments(read('app/api/macro-alert/route.ts'));
  assert.ok(/select\('user_id, role, trial_ends_at, current_period_end'\)/.test(src), 'the macro-alert read does not select current_period_end');
  assert.ok(/if \(planKindOfRow\(row, now\) !== 'free'\) proUserIds\.add\(row\.user_id as string\);/.test(src), 'macro-alert recipients are not from planKindOfRow');
  assert.ok(!/row\.role === 'pro'/.test(src), 'a stored-role-only check is back in macro-alert');
});

test('S4. /api/subscription reports the role the account is on now (a lapsed Pro reports free, so Cancel and the Settings panel follow)', () => {
  const src = stripTsComments(read('app/api/subscription/route.ts'));
  assert.ok(/\.select\('role, trial_ends_at, ls_status, ls_subscription_id, current_period_end'\)/.test(src), 'the read does not select the columns the rule needs');
  assert.ok(/const role = planKindOfRow\(data, Date\.now\(\)\) === 'pro' \? 'pro' : 'free';/.test(src), 'the reported role is not from planKindOfRow');
});

test('S5. #1639 ladder in the alert cron: every coin outside the Free list is muted for each trial user, after the stored mutes are read and before the cost pre-filter', () => {
  const src = stripTsComments(read('app/api/telegram/alert/route.ts'));
  const readMutes = src.indexOf('fetchMutedKeysByUser(), fetchThresholdsByUser()');
  const ladder = src.search(/for \(const uid of trialUserIds\) \{\s*const set = new Set\(mutedByUser\.get\(uid\) \?\? \[\]\);\s*for \(const c of COINS\) if \(!\(FREE_SIGNAL_COINS as readonly string\[\]\)\.includes\(c\)\) set\.add\(`coin:\$\{c\}`\);\s*mutedByUser\.set\(uid, set\);\s*\}/);
  const preFilter = src.indexOf('COINS.filter(coin => recipients.every(r => mutedByUser.get(r.userId)?.has(`coin:${coin}`)))');
  assert.ok(readMutes > 0, 'the stored mute read was not found');
  assert.ok(ladder > 0, 'the trial ladder loop was not found');
  assert.ok(preFilter > 0, 'the cost pre-filter was not found');
  assert.ok(readMutes < ladder && ladder < preFilter, `order is wrong: mutes read @${readMutes}, ladder @${ladder}, pre-filter @${preFilter}`);
});

test('S6. #1639 preview route: a trial previews the Free list only, paid Pro everything, Free is still refused', () => {
  const src = stripTsComments(read('app/api/alerts/preview/route.ts'));
  assert.ok(/if \(!entitlement\.proFeatures\) \{\s*return NextResponse\.json\(\s*\{ error: 'PRO_REQUIRED'/.test(src), 'Free is no longer refused with PRO_REQUIRED');
  assert.ok(/const trialOnly = entitlement\.role !== 'pro';/.test(src), 'trialOnly is not derived from the paid role');
  assert.ok(/const coins = COINS\.filter\(c => !keys\.has\(`coin:\$\{c\}`\) && \(!trialOnly \|\| \(FREE_SIGNAL_COINS as readonly string\[\]\)\.includes\(c\)\)\);/.test(src), 'the preview coin list does not apply the Free list for a trial');
});

test('S7. user price alerts are not laddered: checkPriceAlerts neither takes nor reads the mute map', () => {
  const src = stripTsComments(read('app/api/telegram/alert/route.ts'));
  const start = src.indexOf('async function checkPriceAlerts(');
  assert.ok(start > 0, 'checkPriceAlerts not found');
  const rest = src.slice(start + 10); const next = rest.search(/\n(async )?function /);
  const body = next > 0 ? rest.slice(0, next) : rest;
  assert.ok(!/mutedByUser/.test(body), 'checkPriceAlerts reads the mute map, so a trial user\'s own price alert on a non-Free coin would be silenced');
});

test('S8. the Free signal list the trial ladder uses is exactly BTC, ETH, SOL (owner rule #1596, scope confirmed on #1639)', () => {
  assert.deepEqual([...FREE_SIGNAL_COINS], ['btc', 'eth', 'sol']);
});
