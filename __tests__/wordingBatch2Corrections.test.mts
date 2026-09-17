import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/* Antislop audit 001 (#1309) batch 2, PR A ("factual corrections" - items
 * 36, 37, 38, 39, 40, 41, 42, 43, 44, 54, 57). Contracts, independent of
 * the exact label keys Dev picks when writing the migration:
 *
 *  (a) every label key the batch's migration touches (locale 'en') has the
 *      SAME value in lib/labelDefaults.en.json - the two must never drift,
 *      since labelDefaults.en.json is the fallback served for any locale
 *      whose `lhq_labels` row hasn't been applied yet (per PM/DevOps on
 *      #1309: "labelDefaults.en.json must match the en rows exactly").
 *  (b) EVERY key named in the audit (AUDIT_KEYS below - not just whatever
 *      subset the migration happens to touch) has a row in the migration.
 *      Added after PR #1327 (23/42 keys) passed the original version of
 *      this test cleanly while leaving 19 audit-named keys untouched -
 *      PM/DevOps's review on #1327 found them by grepping labelDefaults.en
 *      .json directly, since (a) only ever checked what the migration
 *      itself listed, so a key the migration just doesn't mention was
 *      invisible to it. Per PM/DevOps: "extend it to the full key list...
 *      so a skipped key fails the test."
 *  (c) none of AUDIT_KEYS' CURRENT labelDefaults.en.json values (migrated
 *      or not - this runs whether or not (b) passes), and none of the raw
 *      Telegram message strings in app/api/telegram/alert/route.ts (items
 *      42/57 are partly CODE, not labels, so no migration touches these -
 *      per PM/DevOps: "Telegram strings ... are code, not labels, so no
 *      migration is needed for those"), contain any of the banned phrases
 *      the audit flagged: "real-time", "instant", "size up",
 *      "institutional", "smart money", an em dash, or all-caps "NOT".
 *
 * SKIPPED RIGHT NOW, on dev: PR A does not exist yet. This looks for its
 * migration by the naming convention every existing labels migration
 * follows (supabase/migrations/*_labels_*.sql) and skips - with the reason
 * printed in the skip message - until a file matches. Matches loosely:
 * anything containing "batch2" OR "audit_001_wording" (case-insensitive,
 * `_`/`-`/space interchangeable) so a reasonable naming choice on Dev's side
 * doesn't skip forever. Same `{skip}` shape as AS-D (#1323) and AS-E
 * (#1322), by PM/DevOps's call after a real conflict: a hard-failing test
 * here would fail `npm test`, which `.githooks/pre-push` runs under `set -e`
 * - that blocks `git push` outright for whoever's branch carries this file,
 * not just a CI status.
 *
 * PM/DevOps's condition for this being an acceptable substitute for a hard
 * red: on PR A's own branch, once the migration exists, EVERY subtest below
 * must actually RUN and pass - a skip there (e.g. from a filename that
 * doesn't match either pattern) counts as a fail at review, not a pass.
 * Match patterns, don't guess a single exact filename.
 *
 * Proposed filename (QA's proposal, not a requirement - adjust the pattern
 * below if Dev's actual name differs, the same way AS-D's proposed
 * lib/macroContext.ts got adjusted after Dev's real fix shape came in): a
 * file under supabase/migrations/ whose name contains "batch2" or
 * "audit_001_wording", e.g. `20260917a_labels_batch2_factual_corrections.sql`.
 *
 * Part (c) also covers app/api/telegram/alert/route.ts, which doesn't
 * depend on the migration at all - but it's gated behind the SAME skip as
 * the others, not run standalone, for the same pre-push reason above (a
 * hard-red assertion here blocks `git push` just as much as one in part (a)
 * would). Verified by running it manually, outside the pushed suite: it
 * already fails for real, on dev, right now - "institutional accumulation"
 * / "institutional distribution" (whale alert strings, ~line 831-869) and
 * one all-caps "Do NOT" (~line 1338, the funding-signal short-squeeze
 * action text). PM/DevOps confirmed items 42/57 cover these and will make
 * sure Dev's PR A fixes them - this subtest is what turns that into an
 * enforced check once PR A lands.
 *
 * AUDIT_KEYS below is transcribed from two sources, not invented: PR
 * #1327's own before/after wording table (the 23 keys it already
 * corrected) plus PM/DevOps's #1327 review comment (the 19 it grepped as
 * still unchanged - item 40's one leftover, 41 in full, 42 in full).
 * Every name was re-verified against the current lib/labelDefaults.en.json
 * before being added here. Code-only corrections named in either source
 * (app/api/telegram/alert/route.ts, app/api/telegram/test/route.ts,
 * lib/i18n/dictionaries.ts, app/layout.tsx, app/forgot-password/page.tsx,
 * app/global-error.tsx, LandingTerminal/LandingTicker/OnboardingFlow/
 * perpSpot/PlatformFooter, and the arena.tsx/GrokChat.tsx strings PM/DevOps
 * flagged as conditional) are deliberately NOT in this list - they aren't
 * `lhq_labels` rows, so a migration existence check doesn't apply to them;
 * the telegram route ones are still covered by part (c) below.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const TELEGRAM_ROUTE = path.join(REPO_ROOT, 'app', 'api', 'telegram', 'alert', 'route.ts');
const LABEL_DEFAULTS = path.join(REPO_ROOT, 'lib', 'labelDefaults.en.json');

// Item 36 (data sources), 37 (Whale Tracker), 38 (real-time/instant alerts),
// 39/41 (squeeze-score inputs, Best Hours), 40/57 (funding-signal odds and
// the all-caps overlap), 41 (help text contradicting the app), 42
// (institutional/smart money), 54 (vague error copy). Fixed by PR #1327:
const AUDIT_KEYS_FIXED = [
  'DISCLAIMER_SECTION_DATA_PROVIDERS_BODY', 'PRIVACY_SECTION_THIRD_PARTY_BODY',
  'FAQ_Q_DATA_SOURCES_A', 'ABOUT_DATA_SOURCE_BREAKING_NEWS_VALUE', 'ABOUT_DATA_SOURCE_CRYPTO_NEWS_VALUE',
  'ALERTS_PAGE_SUBTITLE', 'ALERTS_PRICE_LOCKED_DESC',
  'SPOTLIGHT_TOUR_STEP4_BODY',
  'HOURS_WIN_GOD_BADGE', 'HOURS_WIN_GOD_DESC', 'HOURS_WIN_MON_EVE_DESC', 'HOURS_WIN_LONDON_TIME', 'HOURS_WIN_PRIME_DESC',
  'FUNDING_SIG_LONGS_OVERCROWDED_DESC', 'FUNDING_SIG_SHORTS_CROWDED_ACTION',
  'FUNDING_SIG_SHORTS_OVERCROWDED_HINT', 'FUNDING_SIG_SHORTS_OVERCROWDED_ACTION',
  'ARENA_BREAKDOWN_SHOW',
  'SETTINGS_TEST_PUSH_FAILED', 'SETTINGS_STATUS_FAILED', 'ABSORPTION_DETECTOR_FAILED',
  'MARKET_STRUCTURE_FAILED', 'GLOBAL_MACRO_CONTEXT_FETCH_FAILED',
];
// Named in the audit but still unchanged as of PR #1327 (PM/DevOps's review):
const AUDIT_KEYS_STILL_OPEN = [
  // item 41 - help text that contradicts the app
  'LIQ_DISCLAIMER', 'BRIEFING_HINT_BODY', 'SIGNAL_ACCURACY_CACHE_NOTE', 'ARENA_ANTICHOP_TIP',
  'FUNDING_TIP_HEAVY_POS', 'FUNDING_TIP_HEAVY_NEG', 'DASH_EDGE_FUNDING_TIP',
  'COIN_MARKET_SNAPSHOT_FUNDING_TOOLTIP', 'FAQ_Q_BUYSELL_SIGNAL_A', 'FAQ_Q_ALERT_MISMATCH_A',
  'DASH_EDGE_SETUP_TIP',
  // item 42 - "institutional"/"smart money" with no basis
  'WHALE_TRADES_FEED_BIAS_NET_BUY', 'WHALE_TRADES_FEED_BIAS_NET_SELL', 'NEWS_WHALE_NOTE_BUY',
  'ABSORPTION_DETECTOR_MTF_TEXT', 'ARENA_NOTIF_CVD_BODY_BULL', 'ACCUMULATION_TRACKER_TOOLTIP',
  'WHALE_TRADES_FEED_TOOLTIP',
  // item 40 - one leftover unsourced-odds sentence
  'FUNDING_SIG_SHORTS_OVERCROWDED_DESC',
];
const AUDIT_KEYS = [...AUDIT_KEYS_FIXED, ...AUDIT_KEYS_STILL_OPEN];

const BANNED: Array<{ name: string; re: RegExp }> = [
  { name: '"real-time"', re: /real-time/i },
  { name: '"instant"', re: /\binstant\b/i },
  { name: '"size up"', re: /size up/i },
  { name: '"institutional"', re: /institutional/i },
  { name: '"smart money"', re: /smart money/i },
  { name: 'an em dash (—)', re: /—/ },
  { name: 'all-caps "NOT"', re: /\bNOT\b/ }, // no /i - "not" lowercase is fine, only shouting caps is banned
];

// Loose on purpose: "batch2"/"batch_2"/"batch-2" or "audit_001_wording" in
// any casing/separator, so a reasonable naming choice on Dev's side still
// matches - see this file's header for why a single exact name isn't used.
const MIGRATION_NAME_RE = /batch[_\- ]?2|audit[_\- ]?001[_\- ]?wording/i;

function findBatch2MigrationFiles(): string[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  // Sorted ascending by filename - readdirSync's own order is not
  // guaranteed (Node docs), and a later migration (e.g. a follow-up
  // correcting a key the first one already touched, `20260917b...` after
  // `20260917...`) must win, the same way applying them to a real database
  // in filename order would. loadMigrationRows() below relies on this
  // order: it Map.set()s per key per file, so processing files earliest-
  // first means the LAST (latest-named) file to touch a key is what
  // survives in the map.
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => MIGRATION_NAME_RE.test(f) && f.endsWith('.sql'))
    .sort()
    .map(f => path.join(MIGRATIONS_DIR, f));
}

/** Parses `insert into lhq_labels (key, locale, value) values (...)` tuples
 *  for locale 'en' out of a migration file's raw SQL text, unescaping SQL's
 *  '' (a literal single quote inside a quoted string). */
function parseEnLabelRows(sql: string): Map<string, string> {
  const out = new Map<string, string>();
  const tupleRe = /\(\s*'((?:[^']|'')*)'\s*,\s*'en'\s*,\s*'((?:[^']|'')*)'\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = tupleRe.exec(sql))) {
    out.set(m[1].replace(/''/g, "'"), m[2].replace(/''/g, "'"));
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function loadMigrationRows(files: string[]): Map<string, string> {
  const rows = new Map<string, string>();
  for (const file of files) {
    for (const [k, v] of parseEnLabelRows(readFileSync(file, 'utf8'))) rows.set(k, v);
  }
  return rows;
}

const migrationFiles = findBatch2MigrationFiles();
const SKIP = migrationFiles.length > 0 ? false :
  'no supabase/migrations/*.sql file matching /batch[_-]?2|audit[_-]?001[_-]?wording/i yet - PR A has not ' +
  "landed. See this test file's header for the naming convention.";

test('wording batch 2 (#1309 PR A, items 36-44/54/57): migration matches labelDefaults, banned phrases gone',
  { skip: SKIP }, async (t) => {
    await t.test('a batch 2 labels migration exists (supabase/migrations/, name matches the pattern above)', () => {
      assert.ok(migrationFiles.length > 0, 'unreachable if truly absent - skip would have fired first');
    });

    await t.test("labelDefaults.en.json matches the migration's en rows for every key it touches", () => {
      const defaults = JSON.parse(readFileSync(LABEL_DEFAULTS, 'utf8')) as Record<string, string>;
      const rows = loadMigrationRows(migrationFiles);
      assert.ok(rows.size > 0, `${migrationFiles.map(f => path.basename(f)).join(', ')} matched but no ` +
        '"insert into lhq_labels (...) values (...)" en rows were parsed out of it');
      for (const [key, migrationValue] of rows) {
        assert.equal(defaults[key], migrationValue,
          `labelDefaults.en.json["${key}"] does not match the migration's en value for this key - they must ` +
          'agree exactly, since labelDefaults.en.json is what gets served until the migration is applied');
      }
    });

    await t.test('every audit-named key (#1309 items 36-44/54/57) has a row in the batch migration', () => {
      const rows = loadMigrationRows(migrationFiles);
      const missing = AUDIT_KEYS.filter(k => !rows.has(k));
      assert.deepEqual(missing, [],
        `${missing.length} audit-named key(s) have no row in ${migrationFiles.map(f => path.basename(f)).join(', ')}: ` +
        missing.join(', '));
    });

    await t.test('none of the audit-named keys\' current labelDefaults.en.json values still contain a banned phrase', () => {
      const defaults = JSON.parse(readFileSync(LABEL_DEFAULTS, 'utf8')) as Record<string, string>;
      for (const key of AUDIT_KEYS) {
        const value = defaults[key];
        assert.ok(value !== undefined, `labelDefaults.en.json has no "${key}" key at all - has it been renamed or removed?`);
        for (const { name, re } of BANNED) {
          assert.ok(!re.test(value), `labelDefaults.en.json["${key}"] still contains ${name}: "${value}"`);
        }
      }
    });

    await t.test('app/api/telegram/alert/route.ts (items 42/57 - code, not labels) has no banned phrase in a message string', () => {
      assert.ok(existsSync(TELEGRAM_ROUTE), `${TELEGRAM_ROUTE} not found - has this file moved?`);
      const code = stripComments(readFileSync(TELEGRAM_ROUTE, 'utf8'));
      for (const { name, re } of BANNED) {
        assert.ok(!re.test(code), `app/api/telegram/alert/route.ts still contains ${name} outside a comment`);
      }
    });
  });
