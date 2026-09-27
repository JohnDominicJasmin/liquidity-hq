/* AI dollar caps per account (#1399 part 2, PR #1437).
 *
 * The owner's limits, chosen 2026-09-26: Pro $1.00 a day AND $10.00 a month; free and trial $0.15 a day; a whole-site
 * fuse at $10.00 a day. The cap is checked BEFORE an AI call, at the single choke point (`incrementUsageColumn`) all 14
 * routes go through, and it reads the ledger's measured `cost_usd`.
 *
 * THIS FILE, first part: what does not depend on how the ledger is summed. The constants as recorded DECISIONS, the UTC
 * window boundaries, the owner's four messages and their mapping to the four block reasons. The decision tests
 * (`spendCapBlock`, `incrementUsageColumn`) follow the fix for the finding on #1437: the sums were read with plain selects,
 * and this project's PostgREST caps every read at 1000 rows, so a heavy account or a busy site is summed over a TRUNCATED
 * set and the monthly cap and the fuse can under-count and never trip.
 *
 * Expectations are written from the owner's numbers and the approved copy, as literals. Nothing is computed from the code
 * under test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRO_DAILY_CAP_USD, PRO_MONTHLY_CAP_USD, FREE_DAILY_CAP_USD, SITE_FUSE_DAILY_USD,
  dayStartIsoUtc, monthStartIsoUtc, spendCapLabelKey, type SpendReason,
} from '../lib/aiSpendCap.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;

/* ══ The owner's numbers, pinned as decisions ═══════════════════════════════════════════════ */

test('C1. the owner\'s four limits (2026-09-26): Pro $1.00/day and $10.00/month, free and trial $0.15/day, site fuse $10.00/day', () => {
  assert.equal(PRO_DAILY_CAP_USD, 1.00);
  assert.equal(PRO_MONTHLY_CAP_USD, 10.00);
  assert.equal(FREE_DAILY_CAP_USD, 0.15);
  assert.equal(SITE_FUSE_DAILY_USD, 10.00);
});

test('C2. the caps are ordered the way the product needs them: a Pro day fits inside a Pro month, and a free day is cheaper than a Pro day', () => {
  assert.ok(PRO_DAILY_CAP_USD < PRO_MONTHLY_CAP_USD, 'a single day may spend more than the whole month allows, so the daily cap can never be the binding one');
  assert.ok(FREE_DAILY_CAP_USD < PRO_DAILY_CAP_USD, 'free would be allowed to spend more than Pro');
});

/* ══ UTC windows ═══════════════════════════════════════════════════════════════════════════ */

const ms = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, milli = 0) => Date.UTC(y, mo - 1, d, h, mi, s, milli);

const DAY_CASES: [string, number, string][] = [
  ['mid-afternoon', ms(2026, 9, 27, 15, 42, 7, 123), '2026-09-27T00:00:00.000Z'],
  ['one millisecond before midnight', ms(2026, 9, 27, 23, 59, 59, 999), '2026-09-27T00:00:00.000Z'],
  ['exactly midnight starts the NEW day', ms(2026, 9, 28, 0, 0, 0, 0), '2026-09-28T00:00:00.000Z'],
  ['one millisecond after midnight', ms(2026, 9, 28, 0, 0, 0, 1), '2026-09-28T00:00:00.000Z'],
  ['the last day of a month', ms(2026, 9, 30, 12), '2026-09-30T00:00:00.000Z'],
  ['a leap day', ms(2028, 2, 29, 6), '2028-02-29T00:00:00.000Z'],
  ['New Year\'s Day', ms(2027, 1, 1, 0, 0, 0, 0), '2027-01-01T00:00:00.000Z'],
];
for (const [name, now, want] of DAY_CASES) {
  test(`W1. dayStartIsoUtc: ${name}`, () => assert.equal(dayStartIsoUtc(now), want));
}

const MONTH_CASES: [string, number, string][] = [
  ['mid-month', ms(2026, 9, 27, 15), '2026-09-01T00:00:00.000Z'],
  ['the 30th', ms(2026, 9, 30, 23, 59, 59, 999), '2026-09-01T00:00:00.000Z'],
  ['the 1st at exactly midnight starts the NEW month', ms(2026, 10, 1, 0, 0, 0, 0), '2026-10-01T00:00:00.000Z'],
  ['one millisecond before the new month is still the old one', ms(2026, 9, 30, 23, 59, 59, 999), '2026-09-01T00:00:00.000Z'],
  ['a single-digit month keeps its leading zero', ms(2026, 3, 15), '2026-03-01T00:00:00.000Z'],
  ['December', ms(2026, 12, 31, 23, 59), '2026-12-01T00:00:00.000Z'],
  ['January of the next year', ms(2027, 1, 1), '2027-01-01T00:00:00.000Z'],
  ['a leap-day February', ms(2028, 2, 29, 12), '2028-02-01T00:00:00.000Z'],
];
for (const [name, now, want] of MONTH_CASES) {
  test(`W2. monthStartIsoUtc: ${name}`, () => assert.equal(monthStartIsoUtc(now), want));
}

test('W3. the day start is never after the month start plus the month, and never before the month start', () => {
  for (let day = 1; day <= 28; day++) {
    const now = ms(2026, 9, day, 13, 30);
    assert.ok(monthStartIsoUtc(now) <= dayStartIsoUtc(now), `day ${day}: the month starts after the day does`);
    assert.equal(monthStartIsoUtc(now), '2026-09-01T00:00:00.000Z');
  }
});

test('W4. the windows are UTC, not the machine\'s time zone: an instant late on the 27th in Manila is still the 27th UTC-side', () => {
  // 2026-09-28T02:00 in Manila (UTC+8) is 2026-09-27T18:00Z: the UTC day is the 27th.
  assert.equal(dayStartIsoUtc(Date.parse('2026-09-28T02:00:00+08:00')), '2026-09-27T00:00:00.000Z');
  // 2026-10-01T05:00 in Manila is 2026-09-30T21:00Z: the UTC month is still September.
  assert.equal(monthStartIsoUtc(Date.parse('2026-10-01T05:00:00+08:00')), '2026-09-01T00:00:00.000Z');
});

/* ══ The four reasons and the owner's four messages ═════════════════════════════════════════ */

const REASONS: SpendReason[] = ['pro_daily', 'pro_monthly', 'free_daily', 'fuse'];

test('L1. each reason maps to its own owner-approved label key', () => {
  assert.deepEqual(REASONS.map(spendCapLabelKey), ['AI_CAP_PRO_DAILY', 'AI_CAP_PRO_MONTHLY', 'AI_CAP_FREE_DAILY', 'AI_CAP_FUSE']);
});

test('L2. the four keys are distinct, so two reasons can never be told the same thing', () => {
  assert.equal(new Set(REASONS.map(spendCapLabelKey)).size, 4);
});

test('L3. each key has a non-empty English default, and the four messages are distinct', () => {
  const texts = REASONS.map((r) => defaults[spendCapLabelKey(r)]);
  for (const [i, t] of texts.entries()) assert.ok(typeof t === 'string' && t.trim().length > 20, `${REASONS[i]} has no real default message`);
  assert.equal(new Set(texts).size, 4, 'two reasons show the same words');
});

test('L4. each message says the thing its reason means (a swapped key would tell a Pro user they are a free user)', () => {
  const t = (r: SpendReason) => defaults[spendCapLabelKey(r)];
  assert.match(t('pro_daily'), /today/i);
  assert.match(t('pro_daily'), /midnight UTC/);
  assert.doesNotMatch(t('pro_daily'), /free|upgrade/i, 'a Pro user is told to upgrade');
  assert.match(t('pro_monthly'), /month/i);
  assert.match(t('pro_monthly'), /1st/);
  assert.doesNotMatch(t('pro_monthly'), /free|upgrade/i, 'a Pro user is told to upgrade');
  assert.match(t('free_daily'), /free/i);
  assert.match(t('free_daily'), /upgrade/i);
  assert.match(t('fuse'), /paused/i);
  assert.match(t('fuse'), /free accounts/i);
});

test('L5. no message shows a dollar amount or a cost: the owner chose not to tell users what a call costs', () => {
  for (const r of REASONS) assert.doesNotMatch(defaults[spendCapLabelKey(r)], /\$|USD|cents?|dollars?/i, `${r} prints money`);
});

test('L6. the label keys are registered where the label system looks for them', () => {
  const keys = read('lib/labelKeys.ts');
  for (const r of REASONS) assert.ok(keys.includes(`'${spendCapLabelKey(r)}'`), `${spendCapLabelKey(r)} is not in lib/labelKeys.ts`);
});

/* The migration's English rows must equal the defaults shipped in the build (the migration's own header says so, and the
   server answers the 429 from the DEFAULTS, so a difference means the client and the server tell users different things). */
function migrationEnglish(): Record<string, string> {
  const sql = read('supabase/migrations/20260927a_labels_ai_spend_caps.sql');
  const out: Record<string, string> = {};
  for (const line of sql.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("('")) continue;
    const parts = t.replace(/^\('/, '').replace(/'\)[,;]?\s*$/, '').split("','");
    if (parts.length === 3 && parts[1] === 'en') out[parts[0]] = parts[2].split("''").join("'");
  }
  return out;
}

test('L7. the migration\'s English rows equal the shipped defaults, exactly', () => {
  const mig = migrationEnglish();
  assert.deepEqual(Object.keys(mig).sort(), REASONS.map(spendCapLabelKey).sort(), 'the migration seeds a different set of keys than the code uses');
  for (const r of REASONS) assert.equal(mig[spendCapLabelKey(r)], defaults[spendCapLabelKey(r)], `${spendCapLabelKey(r)}: migration and default differ`);
});
