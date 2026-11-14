/* Parsing locale-'en' label rows out of a migration's raw SQL.
 *
 * ── WHY THIS IS A MODULE AND NOT A HELPER INSIDE THE TEST ───────────────────────────────────────
 *
 * It lived in `__tests__/wordingBatch2Corrections.test.mts` as two unexported functions, so the only
 * way to check its behaviour was to reimplement it — and Dev Team's first attempt at exactly that
 * reported "6 extra rows" from an old-parser copy that had dropped the insert branch. A parser whose
 * correctness is argued about needs to be importable, so a probe runs the SAME function the test
 * runs. Same reason `qa/wiringGuards.ts` exists.
 *
 * ── WHAT IT GETS RIGHT THAT THE PREVIOUS VERSION DID NOT ────────────────────────────────────────
 *
 * Comment stripping is now a single forward scan that TRACKS WHETHER IT IS INSIDE A STRING LITERAL,
 * and `parseEnLabelRows` runs it itself rather than trusting its caller to have done it. Two bugs
 * close together:
 *
 *   1. A blind `sql.replace` of "two dashes to end of line" cut a literal "--" INSIDE a quoted
 *      value, taking that value's closing quote with it. (The regex is deliberately described
 *      rather than quoted here: its `]` `*` `/` `g` tail contains a comment terminator, which ends
 *      this block early and turns the rest of the file into syntax errors. That cost a run.)
 *      The old comment admitted this case and waved it off because the audit was
 *      removing em dashes from label text anyway — a reason that expires the moment someone writes
 *      one. Now `--` inside a literal is text and is kept.
 *   2. Only `loadAuditKeyRows` stripped comments; all thirteen test cells called the parser on RAW
 *      SQL. So the function was wrong for its most common caller in the repo, which is its own test
 *      suite. Dev's mutant found it: a `-- don't` comment between the value and the `;` left the
 *      quotes unbalanced, the tail alternation swallowed the real `;` inside what it thought was a
 *      literal, and the NEXT statement's row vanished — silently, with no error and no row count
 *      change. A false FAIL is recoverable; a row that disappears is not.
 *
 * Stripping inside the parser rather than fixing thirteen call sites is deliberate: it makes the
 * invariant the tail regex depends on — balanced quotes — something this module ESTABLISHES rather
 * than something it assumes about its input.
 *
 * Nothing live tripped it: 138 migration files, 2829 rows, 0 diffs between old and new. That corpus
 * agreement is asserted in the test rather than written down here, so a future migration that DOES
 * trip it fails loudly instead of contradicting a comment.
 */

/** Strips SQL `-- ...` line comments, leaving `--` inside a string literal alone.
 *
 *  Newlines are preserved so line structure survives, which keeps error messages and any later
 *  line-based reasoning honest. SQL's `''` escape is handled: inside a literal, a doubled quote is
 *  two characters of content and does not end the string. */
export function stripSqlComments(sql: string): string {
  let out = '';
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];

    if (inString) {
      out += c;
      if (c === "'") {
        if (sql[i + 1] === "'") {        // '' is an escaped quote, still inside the literal
          out += sql[i + 1];
          i += 1;
          continue;
        }
        inString = false;                // a lone quote closes it
      }
      continue;
    }

    if (c === "'") {
      inString = true;
      out += c;
      continue;
    }

    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      out += '\n';                       // keep the line break the comment sat on
      continue;
    }

    out += c;
  }

  return out;
}

/** Parses locale-'en' label rows out of a migration's raw SQL, in BOTH forms this repo uses,
 *  unescaping SQL's `''`. Comments are stripped first, by this function, every time.
 *
 *  IT USED TO READ ONLY THE INSERT FORM, AND THAT MADE IT LIE RATHER THAN FAIL (#2075).
 *  A migration that CORRECTS existing copy is written as `update lhq_labels set value = ...`, not as
 *  an insert. The old regex found none of those, so "the latest migration's en value" silently
 *  resolved to whatever the last INSERT had said - for the /hours keys, the September text. The
 *  assertion then compared `labelDefaults.en.json` (correctly updated) against months-old SQL and
 *  reported a COPY defect. Measured on #2075's branch: three audit keys - HOURS_WIN_GOD_DESC,
 *  HOURS_WIN_PRIME_DESC, HOURS_WIN_MON_EVE_DESC - each resolved to its old text while the file's 25
 *  UPDATE statements were invisible. The dangerous part is that the row count never dropped: it
 *  returned a full map of stale values, so nothing looked broken.
 *
 *  THE SET VALUE, NEVER THE `where value =` GUARD. Several of these carry
 *  `and value = '<old text>'` as a concurrency guard, so the statement contains BOTH the new and the
 *  old string. Capturing the guard would compare the old text against itself and the assertion would
 *  pass on a migration that changed nothing - an inverted check that looks greener than a correct
 *  one. Hence the capture-group order below is deliberately value-then-key, the reverse of the
 *  INSERT form, and the only place here where those two are not in the same order.
 *
 *  POSITIONAL ORDER WITHIN A FILE. Rows from both forms are collected with their match offset and
 *  applied in that order, so a file that inserts a key and then updates it ends on the update - the
 *  same way the database would. Across files, the caller relies on filename order. */
export function parseEnLabelRows(rawSql: string): Map<string, string> {
  /* Comments go first, and this function does it rather than the caller - see the module header.
     Running it on already-stripped SQL is a no-op, so `loadAuditKeyRows` stripping too is harmless. */
  const sql = stripSqlComments(rawSql);

  const unescape = (s: string) => s.replace(/''/g, "'");
  const found: Array<{ at: number; key: string; value: string }> = [];

  /* insert into lhq_labels (key, locale, value) values ('KEY', 'en', 'VALUE') */
  const tupleRe = /\(\s*'((?:[^']|'')*)'\s*,\s*'en'\s*,\s*'((?:[^']|'')*)'\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = tupleRe.exec(sql))) found.push({ at: m.index, key: m[1], value: m[2] });

  /* update lhq_labels set value = 'NEW' [, updated_at = now()] where key = 'KEY' and locale = 'en'
     [and value = 'OLD'].

     MATCHED IN TWO STEPS RATHER THAN ONE PATTERN, and both reasons are failures the one-pattern
     version had (Dev Team's review of #2091):

     1. ORDER-INDEPENDENT. The first version required `key` to appear before `locale`, so
        `where locale = 'en' and key = 'K'` was SILENTLY SKIPPED - the same shape of invisible miss
        this whole function exists to remove, one level up. No migration writes that order today,
        which is exactly why it would have sat here unnoticed until one did.

     2. SEMICOLON-SAFE. The tail consumes either a non-quote-non-semicolon character OR a whole
        quoted string, so a quoted `;` is swallowed and only an unquoted one ends the statement.
        THAT IS ONLY TRUE WHILE QUOTES BALANCE, which is why comment stripping moved inside this
        function: an unbalanced quote made every later `'` pair one position off, and the tail then
        ate the statement's real `;` inside what it took for a literal. Dev's mutant is the proof,
        and C7/C8 below pin it. The balance is now established upstream, not assumed. */
  const updateRe = /update\s+lhq_labels\s+set\s+value\s*=\s*'((?:[^']|'')*)'((?:[^';]|'(?:[^']|'')*')*)/gi;
  while ((m = updateRe.exec(sql))) {
    const tail = m[2];
    /* `\bkey\s*=` and not a bare `key`, so `and value = ...` and column names ending in "key" cannot
       be mistaken for it. Both reads are scoped to this statement's own tail. */
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
