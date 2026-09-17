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
 * SKIPPED RIGHT NOW, on dev: none of AUDIT_KEYS has a migration row yet.
 * This does NOT try to guess a filename - an earlier version filtered
 * `supabase/migrations/` to names matching "batch2"/"audit_001_wording",
 * and PR #1327's real follow-up migration (`20260917b_labels_funding_
 * longs_neutral_ending.sql`) proved that guess wrong: it corrects one of
 * AUDIT_KEYS but its name matches neither pattern, so the filtered
 * discovery never found it - the sort-by-filename fix (still correct,
 * still here) never got a chance to run on a file discovery excluded
 * outright. Dev caught this on PR #1330 before merging, with direct
 * evidence (the regex tested false against the real filename, and running
 * the sort-fixed test against Dev's actual branch reproduced the same
 * failure unchanged). Now scans EVERY `.sql` file under
 * `supabase/migrations/`, sorted by filename, with SQL line comments
 * (`-- ...`) stripped before parsing so a commented-out dev-section
 * duplicate never gets counted as a live row - and collects a row only
 * when its key is one of AUDIT_KEYS's 42, so this never has to reason
 * about the hundreds of unrelated keys the rest of this repo's migration
 * history touches. The reason is printed in the skip message. Same
 * `{skip}` shape as AS-D (#1323) and AS-E (#1322), by PM/DevOps's call
 * after a real conflict: a hard-failing test here would fail `npm test`,
 * which `.githooks/pre-push` runs under `set -e` - that blocks `git push`
 * outright for whoever's branch carries this file, not just a CI status.
 *
 * PM/DevOps's condition for this being an acceptable substitute for a hard
 * red: on PR A's own branch, once at least one audited key has a
 * migration row, EVERY subtest below must actually RUN and pass - a skip
 * there counts as a fail at review, not a pass.
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

function findAllMigrationFiles(): string[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  // Sorted ascending by filename - readdirSync's own order is not
  // guaranteed (Node docs; confirmed different from alphabetical on this
  // machine for these exact files), and a later migration (e.g. a
  // follow-up correcting a key the first one already touched) must win,
  // the same way applying them to a real database in filename order
  // would. loadAuditKeyRows() below relies on this order: it Map.set()s
  // per key per file, so processing files earliest-first means the LAST
  // (latest-named) file to touch a key is what survives in the map.
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => path.join(MIGRATIONS_DIR, f));
}

/** Strips SQL `-- ...` line comments before parsing, so a commented-out
 *  dev-section duplicate (`-- insert into lhq_dev_labels ...`, per this
 *  repo's 20260912b convention of keeping the prod insert live and the
 *  dev one commented out) never gets counted as a real row. Not a full
 *  SQL parser - a literal "--" inside a quoted value would also get cut
 *  here, but the audit this file enforces is itself removing "--"-style
 *  em dashes from label text, so that case shouldn't occur in practice. */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
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

function stripJsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Scans every migration file (sorted, latest wins per key - see
 *  findAllMigrationFiles' comment) and keeps only rows whose key is one
 *  of `keys`, so this never has to reason about the hundreds of unrelated
 *  keys the rest of this repo's migration history touches. */
function loadAuditKeyRows(files: string[], keys: readonly string[]): Map<string, string> {
  const keySet = new Set(keys);
  const rows = new Map<string, string>();
  for (const file of files) {
    const clean = stripSqlComments(readFileSync(file, 'utf8'));
    for (const [k, v] of parseEnLabelRows(clean)) {
      if (keySet.has(k)) rows.set(k, v);
    }
  }
  return rows;
}

const migrationFiles = findAllMigrationFiles();
const auditRows = loadAuditKeyRows(migrationFiles, AUDIT_KEYS);
const SKIP = auditRows.size > 0 ? false :
  'none of the 42 audit-named keys (#1309 items 36-44/54/57) has a row in any supabase/migrations/*.sql file yet - PR A has not landed.';

test('wording batch 2 (#1309 PR A, items 36-44/54/57): migration matches labelDefaults, banned phrases gone',
  { skip: SKIP }, async (t) => {
    await t.test('every audit-named key has a row in at least one migration', () => {
      const missing = AUDIT_KEYS.filter(k => !auditRows.has(k));
      assert.deepEqual(missing, [],
        `${missing.length} audit-named key(s) have no row in any supabase/migrations/*.sql file: ${missing.join(', ')}`);
    });

    await t.test("labelDefaults.en.json matches each audit-named key's latest migration row", () => {
      const defaults = JSON.parse(readFileSync(LABEL_DEFAULTS, 'utf8')) as Record<string, string>;
      for (const [key, migrationValue] of auditRows) {
        assert.equal(defaults[key], migrationValue,
          `labelDefaults.en.json["${key}"] does not match the latest migration's en value for this key - they ` +
          'must agree exactly, since labelDefaults.en.json is what gets served until the migration is applied');
      }
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
      const code = stripJsComments(readFileSync(TELEGRAM_ROUTE, 'utf8'));
      for (const { name, re } of BANNED) {
        assert.ok(!re.test(code), `app/api/telegram/alert/route.ts still contains ${name} outside a comment`);
      }
    });
  });
