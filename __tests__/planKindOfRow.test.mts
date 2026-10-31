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

/* ══ #1630 Step 1: NO 48 h GRACE ONCE CANCELLED (PM's ruling 2026-10-28) ════════════════════════════════════════
 *
 * The matrix is the CROSS of the cancel flag and the period end, four cases, because a two-sided test passes on the
 * regression that matters most. K12 is that case: the grace must survive untouched for everyone who has NOT cancelled.
 * Losing it silently would demote every account whose renewal is a few hours late - a far larger failure than the
 * two days of unpaid Pro this rule exists to remove. */
const cancelled = (end: string | null | undefined) => ({ ...pro(end), cancel_at_period_end: true });

test('K11. cancelled with the period end in the FUTURE is still pro: cancelling never takes away time already paid for', () => {
  assert.equal(planKindOfRow(cancelled(iso(NOW + 10 * 24 * H)), NOW), 'pro');
  assert.equal(planKindOfRow(cancelled(iso(NOW + 60_000)), NOW), 'pro', 'one minute of paid time left is still paid time');
});

test('K12. NOT cancelled, past the end by under 48 h, is still pro - the grace is untouched for everyone else', () => {
  assert.equal(planKindOfRow(pro(iso(NOW - H)), NOW), 'pro', 'one hour past, no cancel flag');
  assert.equal(planKindOfRow({ ...pro(iso(NOW - H)), cancel_at_period_end: false }, NOW), 'pro', 'an explicit false is not a cancellation');
  assert.equal(planKindOfRow({ ...pro(iso(NOW - H)), cancel_at_period_end: null }, NOW), 'pro', 'null is not a cancellation');
});

test('K13. cancelled and past the end is free IMMEDIATELY: 1 ms past, not 48 h past', () => {
  assert.equal(planKindOfRow(cancelled(iso(NOW)), NOW), 'pro', 'the end itself is not yet past');
  assert.equal(planKindOfRow(cancelled(iso(NOW - 1)), NOW), 'free', '1 ms past the end, cancelled');
  assert.equal(planKindOfRow(cancelled(iso(NOW - H)), NOW), 'free', 'one hour past, cancelled');
  assert.equal(planKindOfRow(cancelled(iso(NOW - 47 * H)), NOW), 'free', 'inside what would have been the grace');
});

test('K14. the column is ABSENT in production until the migration is applied, and absent must read exactly like not cancelled', () => {
  /* The cancel-state column ships unapplied (a migration is a write to the shared database), so `undefined` is the live case
   * and the branch below is the one every real row takes today. A test that only exercised the column-present case would be
   * green on a build where every user is mis-read. */
  const absent = pro(iso(NOW - H));
  assert.equal('cancel_at_period_end' in absent, false, 'the fixture must not carry the column at all');
  assert.equal(planKindOfRow(absent, NOW), 'pro', 'absent must keep the grace');
  assert.equal(planKindOfRow(absent, NOW), planKindOfRow({ ...absent, cancel_at_period_end: false }, NOW), 'absent and false must agree');
  assert.equal(planKindOfRow(cancelled(iso(NOW - H)), NOW), 'free', 'and the flag must still be able to change the answer');
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
  /* EACH required column must appear in the select, rather than the whole literal matching. The cancel-state work
   * appends billing_provider so the panel knows which processor the row is on, and a test whose job is catching a
   * REMOVAL must not fail on an ADDITION. A dropped column still fails, which is what S4 is for. */
  const sel = /from\(T\.user_subscriptions\)\s*\.select\('([^']+)'\)/.exec(src);
  if (!sel) assert.fail('the subscription read does not select from T.user_subscriptions');
  const cols = (sel[1] ?? '').split(',').map((c) => c.trim());
  for (const col of ['role', 'trial_ends_at', 'ls_status', 'ls_subscription_id', 'current_period_end']) {
    assert.ok(cols.includes(col), `the read does not select ${col}, which the rule needs`);
  }
  assert.ok(/const role = planKindOfRow\(data, Date\.now\(\)\) === 'pro' \? 'pro' : 'free';/.test(src), 'the reported role is not from planKindOfRow');
});

/* ── THE COIN SET IS MATCHED BY SHAPE AND NAMED BY S9, NOT PINNED AS LITERAL TEXT ─────────────
 *
 * S5 and S6 used to contain the identifier `COINS` inside their patterns. On 2026-10-31 that cost
 * #1850 - the owner's top-priority PR - six CI runs and most of a day: dev renamed the cron's two
 * call sites to `SCANNED_COINS`, the array was LITERALLY THE SAME ARRAY (`SCANNED_COINS = COINS`),
 * and these cells reported "the trial ladder loop was not found" about a loop sitting at line 2397
 * with nothing wrong with it. Dev reverted a correct rename to get past a stale pin of mine.
 *
 * A PIN THAT CANNOT TELL A RENAME FROM A DELETION IS A BAD PIN. The shape is the thing worth
 * pinning; the name is worth checking separately, where a failure can say which it was.
 *
 * WHAT IS NOT LOOSENED, because this is where a well-meant fix would go wrong. Accepting ANY
 * identifier would accept `UNIVERSE_COINS` - all 463 instruments - in a cron that fetches 300
 * klines per coin per run. That is a 9x cost change and it would pass silently. S9 resolves the
 * captured name through `lib/coins.ts` and requires it to reach the RENDERED list, so a rename
 * passes and a widening does not. */
const IDENT_SHAPE = 'any SCREAMING_SNAKE identifier';
const COIN_SET = '([A-Z][A-Z0-9_]*)';

const LADDER_RE = new RegExp(
  'for \\(const uid of trialUserIds\\) \\{\\s*const set = new Set\\(mutedByUser\\.get\\(uid\\) \\?\\? \\[\\]\\);' +
  `\\s*for \\(const c of ${COIN_SET}\\) if \\(!\\(FREE_SIGNAL_COINS as readonly string\\[\\]\\)\\.includes\\(c\\)\\)` +
  ' set\\.add\\(`coin:\\$\\{c\\}`\\);\\s*mutedByUser\\.set\\(uid, set\\);\\s*\\}',
);
const PRE_FILTER_RE = new RegExp(
  `${COIN_SET}\\.filter\\(coin => recipients\\.every\\(r => mutedByUser\\.get\\(r\\.userId\\)\\?\\.has\\(\`coin:\\$\\{coin\\}\`\\)\\)\\)`,
);
const PREVIEW_RE = new RegExp(
  `const coins = ${COIN_SET}\\.filter\\(c => !keys\\.has\\(\`coin:\\$\\{c\\}\`\\) && \\(!trialOnly \\|\\|` +
  ' \\(FREE_SIGNAL_COINS as readonly string\\[\\]\\)\\.includes\\(c\\)\\)\\);',
);

/** Follows `export const <name>: CoinId[] = <rhs>;` in lib/coins.ts until it reaches a declaration
 *  that is not a bare alias, and reports what that declaration is built from. */
const resolveCoinSet = (name: string): { hops: string[]; rhs: string } => {
  const src = read('lib/coins.ts');
  const hops: string[] = [];
  let at = name;
  for (let i = 0; i < 6; i += 1) {
    hops.push(at);
    const decl = new RegExp(`^export const ${at}(?:\\s*:[^=]*)?= *(.+);$`, 'm').exec(src);
    if (!decl) return { hops, rhs: `NOT EXPORTED from lib/coins.ts` };
    const rhs = (decl[1] ?? '').trim();
    /* ONLY a bare identifier counts as an alias to follow. `[...RENDERED_IDS]` is NOT unwrapped
       on purpose - that spread IS the rendered list's declaration, and it is what S9 reads. */
    const alias = /^([A-Z][A-Z0-9_]*)$/.exec(rhs);
    if (!alias) return { hops, rhs };
    at = alias[1] ?? '';
    if (hops.includes(at)) return { hops, rhs };
  }
  return { hops, rhs: 'alias chain longer than 6 hops' };
};

test('S5. #1639 ladder in the alert cron: every coin outside the Free list is muted for each trial user, after the stored mutes are read and before the cost pre-filter', () => {
  const src = stripTsComments(read('app/api/telegram/alert/route.ts'));
  const readMutes = src.indexOf('fetchMutedKeysByUser(), fetchThresholdsByUser()');
  const ladder = LADDER_RE.exec(src);
  const preFilter = PRE_FILTER_RE.exec(src);
  assert.ok(readMutes > 0, 'the stored mute read was not found');
  assert.ok(ladder, 'the trial ladder loop was not found. The coin set it iterates may be called anything ' +
    `(${IDENT_SHAPE}); what must not change is the shape - a per-trial-user loop that adds coin:<id> for ` +
    'every coin OUTSIDE FREE_SIGNAL_COINS. If only the name moved, S9 is the cell that checks the name.');
  assert.ok(preFilter, 'the cost pre-filter was not found');
  const at = { mutes: readMutes, ladder: ladder.index, pre: preFilter.index };
  assert.ok(at.mutes < at.ladder && at.ladder < at.pre,
    `order is wrong: mutes read @${at.mutes}, ladder @${at.ladder}, pre-filter @${at.pre}`);
  /* The ladder and the pre-filter must walk the SAME set. Muting the rendered list and then
     costing the scan set would ladder one list and bill for another. */
  assert.equal(ladder[1], preFilter[1],
    `the ladder iterates ${ladder[1]} and the cost pre-filter iterates ${preFilter[1]}. A trial user is ` +
    'laddered against one coin list while the cron prices another, so coins can be charged for and never muted.');
});

test('S6. #1639 preview route: a trial previews the Free list only, paid Pro everything, Free is still refused', () => {
  const src = stripTsComments(read('app/api/alerts/preview/route.ts'));
  assert.ok(/if \(!entitlement\.proFeatures\) \{\s*return NextResponse\.json\(\s*\{ error: 'PRO_REQUIRED'/.test(src), 'Free is no longer refused with PRO_REQUIRED');
  assert.ok(/const trialOnly = entitlement\.role !== 'pro';/.test(src), 'trialOnly is not derived from the paid role');
  const preview = PREVIEW_RE.exec(src);
  assert.ok(preview, 'the preview coin list does not apply the Free list for a trial');
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

test('S9. the cron and the preview read the SAME coin set, and it resolves to the rendered list rather than the 463-coin universe', () => {
  /* THIS CELL IS THE REASON S5 AND S6 CAN STOP PINNING THE NAME, and it covers a hazard neither of
     them did. `lib/coins.ts:119` names it in the source: the cron in app/api/telegram/alert and the
     preview in app/api/alerts/preview MUST move together, because
     "if the preview keeps reading the rendered list while the cron reads the scan set, the preview
     advertises coins nothing is watching and nothing fails". Nothing failed. Now something does. */
  const cron = PRE_FILTER_RE.exec(stripTsComments(read('app/api/telegram/alert/route.ts')));
  const preview = PREVIEW_RE.exec(stripTsComments(read('app/api/alerts/preview/route.ts')));
  assert.ok(cron, 'the cron cost pre-filter was not found - S5 says more about why');
  assert.ok(preview, 'the preview coin list was not found - S6 says more about why');
  assert.equal(
    cron[1], preview[1],
    `the cron scans ${cron[1]} and the preview advertises ${preview[1]}. The user is shown alerts for ` +
    'coins the cron may never look at, and no error is raised when that happens - this is the exact ' +
    'silent divergence lib/coins.ts:119 warns about. Move both call sites in one change.',
  );

  /* AND IT MUST BE THE RENDERED LIST. A rename is free; a widening is not. `UNIVERSE_COINS` is 463
     instruments and the cron fetches 300 klines per coin per run, twice. */
  const set = resolveCoinSet(cron[1] ?? '');
  const chain = set.hops.join(' -> ');
  assert.ok(
    /RENDERED_IDS/.test(set.rhs),
    `the cron's coin set resolves ${chain} = ${set.rhs}, which does not reach RENDERED_IDS. The alert ` +
    'cron must scan what the app renders. If this is a deliberate change of scan set, change this ' +
    'cell in the same commit and say what the new cost is.',
  );
  assert.ok(
    !/COIN_UNIVERSE/.test(set.rhs),
    `the cron's coin set resolves ${chain} = ${set.rhs}, which is built from COIN_UNIVERSE - all 463 ` +
    'instruments. app/api/telegram/alert/route.ts fetches 300 klines PER COIN and runs checkRSI over ' +
    'the whole list, so this is roughly a 9x increase in the cron\'s cost and in the exchanges\' rate ' +
    'budget. Nothing else in the suite would have said so.',
  );

  /* The positive control for both: the identifier actually came from the source, not from a default. */
  assert.match(cron[1] ?? '', /^[A-Z][A-Z0-9_]*$/, 'no identifier was captured from the cron, so the assertions above are vacuous');
});
