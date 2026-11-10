import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
/* The parser is QA-owned and importable on purpose: Dev Team's first independent check of it
   reimplemented the old version and dropped the insert branch, reporting 6 phantom rows. A probe
   must be able to run the SAME function this test runs. See qa/sqlLabelRows.ts. */
import { stripSqlComments, parseEnLabelRows } from '../qa/sqlLabelRows.ts';

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
  /* `HOURS_WIN_LONDON_TIME` WAS HERE AND THE KEY IS GONE, 2026-10-31. It is not a transcription
     error and the audit record is not being quietly edited: #1327 did fix its wording, and that
     history is why the name stays written down here in prose.
     The key itself was DELETED from lib/labelKeys.ts and lib/labelDefaults.en.json along with six
     other dead `HOURS_*` keys - nothing outside labelKeys.ts read any of them - because its value
     was the last remaining "3PM - 6PM PHT (7-10AM UTC)" in the defaults file and the owner's
     instruction was to remove every trace of the operator's location.
     IT HAD TO COME OUT OF THIS LIST FIRST. The cell below asserts `value !== undefined` for every
     AUDIT_KEYS entry, so deleting the key while it was still listed would have failed with
     "labelDefaults.en.json has no HOURS_WIN_LONDON_TIME key at all" - a true message about a
     deliberate deletion, blocking the purge on a test of mine. */
  'HOURS_WIN_GOD_BADGE', 'HOURS_WIN_GOD_DESC', 'HOURS_WIN_MON_EVE_DESC', 'HOURS_WIN_PRIME_DESC',
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

/* ── THE OLD IMPLEMENTATIONS, KEPT AS THE REFERENCE FOR THE CORPUS CELL ONLY ──────────────────
 *
 * These are the pre-2026-11-10 versions, verbatim. They are NOT used to parse anything the
 * assertions depend on - C9 runs them beside the real parser across every migration file and
 * requires the two to AGREE. That is Dev Team's corpus control, promoted from a number in a comment
 * to an assertion, so a future migration that starts tripping the old bug fails this cell instead
 * of contradicting a sentence nobody re-measures.
 *
 * `legacyStrip` is the bug: a blind regex that cuts a "--" inside a quoted value, taking the
 * closing quote with it. `legacyParse` is the bug's partner: it trusted its caller to have stripped,
 * and its tail alternation is only quote-safe while quotes balance. */
function legacyStrip(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

function legacyParse(sql: string): Map<string, string> {
  const unescape = (s: string) => s.replace(/''/g, "'");
  const found: Array<{ at: number; key: string; value: string }> = [];
  const tupleRe = /\(\s*'((?:[^']|'')*)'\s*,\s*'en'\s*,\s*'((?:[^']|'')*)'\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = tupleRe.exec(sql))) found.push({ at: m.index, key: m[1], value: m[2] });
  const updateRe = /update\s+lhq_labels\s+set\s+value\s*=\s*'((?:[^']|'')*)'((?:[^';]|'(?:[^']|'')*')*)/gi;
  while ((m = updateRe.exec(sql))) {
    const tail = m[2];
    const keyMatch = tail.match(/\bkey\s*=\s*'((?:[^']|'')*)'/i);
    if (keyMatch && /\blocale\s*=\s*'en'/i.test(tail)) {
      found.push({ at: m.index, key: keyMatch[1], value: m[1] });
    }
  }
  found.sort((a, b) => a.at - b.at);
  const out = new Map<string, string>();
  for (const row of found) out.set(unescape(row.key), unescape(row.value));
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

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
 * The PARSER's own cells (#2075). Fixture-driven on purpose: the corpus changes under this file every
 * time anyone adds a migration, so a cell that depends on it tests the corpus rather than the parser.
 *
 * WHY THESE EXIST AND WHAT THE OBVIOUS CONTROL WOULD NOT HAVE CAUGHT. The defect was that the parser
 * read only the INSERT form, so an UPDATE-style correction was invisible and each key resolved to its
 * last INSERT - months-old text. The natural guard, "the discovered files yielded more than 0 rows",
 * would NOT have fired: the broken parser returned a FULL map of 41 keys, every value stale. The row
 * count never dropped. A count check is still worth having for a total parse failure, which is what
 * P4 below is for, but it is not the guard for this bug and should not be mistaken for one.
 * ───────────────────────────────────────────────────────────────────────────────────────────────── */

test('P1. the parser reads the INSERT form', () => {
  const rows = parseEnLabelRows(
    "insert into lhq_labels (key, locale, value) values ('A_KEY', 'en', 'inserted text');",
  );
  assert.equal(rows.get('A_KEY'), 'inserted text');
});

test('P2. the parser reads the UPDATE form, and takes the SET value NEVER the `where value =` guard', () => {
  /* The inversion hazard, and the reason this cell is the important one: the statement contains BOTH
     strings. Capturing the guard would compare the old text against itself, so the assertion in this
     file would PASS on a migration that changed nothing - greener than a correct check. */
  const rows = parseEnLabelRows(
    "update lhq_labels set value = 'the new text', updated_at = now() "
    + "where key = 'A_KEY' and locale = 'en' and value = 'the old text';",
  );
  assert.equal(rows.get('A_KEY'), 'the new text');
  assert.notEqual(rows.get('A_KEY'), 'the old text');
});

test('P3. within one file the LAST statement to touch a key wins, whichever form it is', () => {
  /* Positional, not form-ordered: an insert followed by an update must end on the update, the way the
     database would, and an update followed by a re-insert must end on the insert. */
  const insertThenUpdate = parseEnLabelRows(
    "insert into lhq_labels (key, locale, value) values ('A_KEY', 'en', 'first');\n"
    + "update lhq_labels set value = 'second' where key = 'A_KEY' and locale = 'en';",
  );
  assert.equal(insertThenUpdate.get('A_KEY'), 'second');

  const updateThenInsert = parseEnLabelRows(
    "update lhq_labels set value = 'first' where key = 'A_KEY' and locale = 'en';\n"
    + "insert into lhq_labels (key, locale, value) values ('A_KEY', 'en', 'second');",
  );
  assert.equal(updateThenInsert.get('A_KEY'), 'second');
});

test('P4. CONTROL: a non-en locale is ignored, and the real corpus yields rows at all', () => {
  /* Locale discrimination: without it, a ko/zh/ar/ru UPDATE in the same migration would overwrite the
     en value with translated copy and every comparison below would fail for the wrong reason. */
  const other = parseEnLabelRows(
    "update lhq_labels set value = 'translated' where key = 'A_KEY' and locale = 'ko';",
  );
  assert.equal(other.has('A_KEY'), false, 'a ko row was read as en');

  /* The count check PM/DevOps asked for. It catches a TOTAL parse failure - a renamed table, a
     changed quoting convention - not the stale-value bug above, for the reason in the heading. */
  assert.ok(
    auditRows.size > 0,
    `the migration corpus yielded 0 rows for ${AUDIT_KEYS.length} audit keys, so every comparison in `
    + 'this file is vacuous - the parser or the migration convention has changed',
  );
});

/* P5 and P6 pin the two silent-skip shapes Dev Team found in #2091's first version. Both are cases
 * where the parser returned a row-free, error-free "nothing to see here" - the failure mode this
 * whole function exists to remove, reintroduced one level up in the pattern that removes it. Neither
 * occurs in any migration today, which is precisely why they needed cells rather than a comment: a
 * latent miss that nothing exercises is one someone discovers the hard way. */

test('P5. the WHERE clause order does not matter - locale before key must still be read', () => {
  /* The original pattern required key before locale, so this exact statement was skipped silently. */
  const rows = parseEnLabelRows(
    "update lhq_labels set value = 'reordered' where locale = 'en' and key = 'A_KEY';",
  );
  assert.equal(rows.get('A_KEY'), 'reordered', 'a `locale` before `key` WHERE clause was skipped');

  /* And the conventional order still works, so this is an addition rather than a swap. */
  const conventional = parseEnLabelRows(
    "update lhq_labels set value = 'conventional' where key = 'A_KEY' and locale = 'en';",
  );
  assert.equal(conventional.get('A_KEY'), 'conventional');
});

test('P6. a quoted semicolon BEFORE the key does not end the statement early', () => {
  /* NARROWER THAN I FIRST WROTE, and a mutation is what corrected me. My first version of this cell
     put the semicolon in the new value and in a trailing guard, and claimed a `[^;]*` tail broke on
     both. It does not:
       - in the NEW VALUE it is already safe, because the quote-aware value pattern consumes the
         whole literal including any `;` before the tail begins;
       - in a TRAILING guard it is also safe, because `key` and `locale` both appear before it.
     Restoring the naive tail left those two passing, so the cell was decoration. The shape that
     genuinely breaks is a quoted semicolon that comes BEFORE the key - which needs the guard written
     first, and therefore exercises order-independence and semicolon-safety together. That is the
     realistic worst case rather than the one that was easy to write. */
  const guardFirst = parseEnLabelRows(
    "update lhq_labels set value = 'clean new text' "
    + "where value = 'old; text with a semicolon' and key = 'A_KEY' and locale = 'en';",
  );
  assert.equal(guardFirst.get('A_KEY'), 'clean new text', 'a quoted semicolon before the key truncated the statement');

  /* The two shapes that were already safe, kept so a future narrowing of the tail cannot quietly
     reintroduce them. */
  const inNewValue = parseEnLabelRows(
    "update lhq_labels set value = 'first part; second part' where key = 'A_KEY' and locale = 'en';",
  );
  assert.equal(inNewValue.get('A_KEY'), 'first part; second part');

  /* CONTROL: an UNQUOTED semicolon still ends the statement, so the tail cannot run into the next
     one and pick up a foreign key. Without this, P6 would pass on a pattern that ignores `;`
     entirely - which would be a worse bug than the one it fixes. */
  const twoStatements = parseEnLabelRows(
    "update lhq_labels set value = 'first' where key = 'KEY_ONE' and locale = 'en';\n"
    + "update lhq_labels set value = 'second' where key = 'KEY_TWO' and locale = 'en';",
  );
  assert.equal(twoStatements.get('KEY_ONE'), 'first');
  assert.equal(twoStatements.get('KEY_TWO'), 'second');
  assert.equal(twoStatements.size, 2, 'the two statements bled into each other');
});


/* ── C7-C9: THE QUOTE-BALANCE BUG DEV TEAM FOUND BY MUTATION (#2091 follow-up) ───────────────
 *
 * The old parser trusted its caller to have stripped comments, and its statement-tail alternation
 * is only quote-aware WHILE QUOTES BALANCE. A '--' comment containing an apostrophe makes them odd, every
 * later quote pairs one position off, and the tail then swallows the statement's real semicolon
 * inside what it takes for a string literal - so the NEXT statement's row vanishes. No error, no
 * row-count change. A false FAIL is recoverable; a row that silently disappears is not.
 *
 * The fix was NOT to strip comments harder. parseEnLabelRows now strips them ITSELF, with a scan
 * that knows when it is inside a literal, so the balance the tail depends on is established rather
 * than assumed. C8c is the half that a blind stripper gets wrong in the other direction.
 *
 * Each cell runs the OLD implementation beside the new one, because 'the new parser is right' is
 * worth little without showing the old one was wrong on the same input. */
test('C7. an apostrophe in a -- comment must not swallow the next statement', () => {
  const sql = [
    "update lhq_labels set value = 'x' -- don't",
    "where key = 'K1' and locale = 'en';",
    "update lhq_labels set value = 'y' where key = 'K2' and locale = 'en';",
  ].join('\n');

  const rows = parseEnLabelRows(sql);
  assert.equal(rows.get('K1'), 'x', 'K1 should parse');
  assert.equal(rows.get('K2'), 'y', 'K2 is the row the unbalanced quote used to swallow');

  // The old parser on the same input, so this cell cannot pass vacuously.
  const legacy = legacyParse(sql);
  assert.equal(legacy.get('K2'), undefined,
    'CONTROL FAILED: the old parser did NOT drop K2 here, so this cell is not reproducing the bug');
});

test('C8. the same comment in a KEYLESS statement must not hand the next row the wrong value', () => {
  const sql = [
    "update lhq_labels set value = 'x' -- don't stop",
    "where locale = 'en';",
    "update lhq_labels set value = 'y' where key = 'FOREIGN' and locale = 'en';",
  ].join('\n');

  assert.equal(parseEnLabelRows(sql).get('FOREIGN'), 'y',
    "FOREIGN's value comes from its OWN statement, not from the keyless one above it");
  assert.equal(legacyParse(sql).get('FOREIGN'), 'x',
    'CONTROL FAILED: the old parser did not mis-assign here, so this cell proves nothing');
});

test('C8b. CONTROL: the same two statements with no apostrophe in the comment were always fine', () => {
  const sql = [
    "update lhq_labels set value = 'x' -- do not",
    "where key = 'K1' and locale = 'en';",
    "update lhq_labels set value = 'y' where key = 'K2' and locale = 'en';",
  ].join('\n');

  // Both parsers agree here. This is what ties C7 to the APOSTROPHE rather than to the comment.
  for (const [label, parse] of [['new', parseEnLabelRows], ['old', legacyParse]] as const) {
    const rows = parse(sql);
    assert.equal(rows.get('K1'), 'x', label + ' lost K1 on the apostrophe-free control');
    assert.equal(rows.get('K2'), 'y', label + ' lost K2 on the apostrophe-free control');
  }
});

test('C8c. a -- inside a quoted value is TEXT, and must survive comment stripping', () => {
  const sql = "update lhq_labels set value = 'before -- after' where key = 'K' and locale = 'en';";

  assert.equal(parseEnLabelRows(sql).get('K'), 'before -- after',
    'a literal -- inside the value must not be cut as a comment');

  /* The old stripper cut from -- to end of line regardless, taking the value's closing quote with
     it. That is the OTHER door onto the same unbalanced-quote bug, and the one my earlier attempts
     to measure with a regex got wrong twice - a predicate for this needs in-string tracking, which
     is exactly what the fix adds. */
  assert.notEqual(legacyStrip(sql).trim().slice(-1), ';',
    'CONTROL FAILED: the old stripper left this statement intact, so it is not the case being pinned');
});

test('C9. CORPUS: across every migration file, old and new parsers must agree', () => {
  /* Dev Team's control, promoted from a number in a prose comment to an assertion. It measured 138
     files / 2829 rows / 0 diffs, which is what makes C7-C8c latent-trap removal rather than a live
     fix - without it, the mutants alone would license the conclusion that migrations are currently
     being misread. As an assertion it also does a second job a comment cannot: the day a migration
     DOES start tripping the old bug, this cell fails and names the file, instead of a sentence
     nobody re-measures quietly going out of date. */
  const files = findAllMigrationFiles();
  assert.ok(files.length > 100, 'expected the full migration corpus, got ' + files.length + ' files');

  const diffs: string[] = [];
  let totalRows = 0;
  for (const f of files) {
    const raw = readFileSync(f, 'utf8');
    const fresh = parseEnLabelRows(raw);
    const old = legacyParse(legacyStrip(raw));
    totalRows += fresh.size;
    const keys = new Set([...fresh.keys(), ...old.keys()]);
    for (const k of keys) {
      if (fresh.get(k) !== old.get(k)) diffs.push(path.basename(f) + ' :: ' + k);
    }
  }

  assert.ok(totalRows > 1000, 'the corpus parsed only ' + totalRows + ' rows, so this cell is not reading it');
  assert.deepEqual(diffs, [],
    'a migration now parses differently under the two implementations, so the old bug has gone live: '
    + diffs.slice(0, 8).join(' | '));
});
