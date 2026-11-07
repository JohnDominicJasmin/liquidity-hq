/* EVERY COLUMN THE APP CAN REFUND MUST BE ON THE SQL FUNCTION'S ALLOWLIST, AND NOTHING ELSE.
 *
 * NO AI REFUND HAD EVER SUCCEEDED, and this is the cell that would have said so. Dev Team found it
 * on #1977; PM/DevOps had reported it as one missing column. It was twelve, plus a phantom.
 *
 * `refund_ai_usage_impl` guards its dynamic `format(%I)` with a literal allowlist, which is the
 * right shape - a `%I` fed an arbitrary caller string is an injection seam, so the list has to
 * exist. What it must not be is a list that DRIFTS from the columns the app actually passes:
 *
 *     20261023a as written allowed:  deep_count quick_count chat_count search_count briefing_count
 *     the app can pass:              those four (NOT search_count) plus the TWELVE in
 *                                    EXTRA_TOOL_COLUMN, plus chat_search_count
 *
 * So `refundUsageColumn` raised `22023` for every extra tool, `refundUsageColumn` swallowed it,
 * logged, and returned null - and the user kept the charge. Invisible from outside, because a
 * failed refund and a refund that was never attempted look identical to the person who paid.
 *
 * `search_count` is the other half and the more interesting one: it is on the allowlist and is NOT
 * a column in either project, while the real one, `chat_search_count`, was locked out. A list can
 * be wrong in both directions at once, so this cell asserts BOTH.
 *
 * ── DERIVED FROM SOURCE ON BOTH SIDES, WHICH IS THE WHOLE POINT ─────────────────────────────────
 *
 * A hand-written expected list would rot exactly as the allowlist did, and the rot would be
 * invisible for the same reason. So both sides are extracted: the app's columns from
 * `lib/aiUsage.ts` and the routes that call it, the allowlist from the migration. Dev Team asked
 * for it this way and it is the right call - this cell has no opinion of its own about which
 * columns exist.
 *
 * NO DATABASE AND NO NETWORK: this reads files. The three behavioural assertions Dev specified -
 * that a tool refund restores `tool_pool_count`, that refunding `deep_count` does NOT touch the
 * pool, and that an unknown column still raises 22023 - need the function to exist and are a
 * separate, DB-backed spec. They cannot run until the migration is applied; dev has no refund
 * function at all today. This one runs now, and it is the one that catches the drift.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Comments stripped, so a column named only in prose never counts as a call argument. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const USAGE = stripComments(read('lib/aiUsage.ts'));

/* ── side A: the columns the app can hand to the refund function ────────────────────────────── */

/** The twelve one-shot tools, from the map `refundToolUsage` indexes. */
function extraToolColumns(): string[] {
  const block = /EXTRA_TOOL_COLUMN:\s*Record<ExtraTool,\s*string>\s*=\s*\{([\s\S]*?)\}/.exec(USAGE);
  assert.ok(block, 'EXTRA_TOOL_COLUMN could not be located in lib/aiUsage.ts - the map was renamed '
    + 'or reshaped, so re-derive this extraction rather than re-pointing it');
  return [...block[1].matchAll(/'([a-z_]+_count)'/g)].map((m) => m[1]);
}

/* NOT REFUNDABLE TARGETS, and asserted rather than assumed.
 *
 *   tool_pool_count  the SHARED budget. `increment` charges an extra tool TWICE - the named column
 *                    and this one - and the refund has to give back both, but no caller ever passes
 *                    this as `p_column`. The function decrements it itself.
 *   refund_count     the per-day refund counter the function maintains, not a usage column.
 *
 * If a third `*_count` literal appears in a file that calls increment or refund, this cell FAILS
 * and asks for a decision. Widening the exclusion set silently is how the allowlist rotted in the
 * first place. */
const NOT_A_COLUMN_ARG = new Set(['tool_pool_count', 'refund_count']);

/** Files that actually call the usage helpers - the only places a column argument can originate. */
function callerFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.ts$/.test(entry.name)) continue;
      const src = stripComments(read(rel));
      if (/\b(incrementUsageColumn|refundUsageColumn|incrementToolUsage|refundToolUsage)\s*\(/.test(src)) out.push(rel);
    }
  };
  walk('app');
  out.push('lib/aiUsage.ts');
  return out;
}

/** Every `'*_count'` literal in a caller file, minus the two that are not column arguments. */
function appColumns(): { columns: string[]; excluded: string[]; files: string[] } {
  const files = callerFiles();
  const found = new Set<string>();
  const excluded = new Set<string>();
  for (const f of files) {
    for (const m of stripComments(read(f)).matchAll(/'([a-z_]+_count)'/g)) {
      if (NOT_A_COLUMN_ARG.has(m[1])) { excluded.add(m[1]); continue; }
      found.add(m[1]);
    }
  }
  for (const c of extraToolColumns()) found.add(c);
  return { columns: [...found].sort(), excluded: [...excluded].sort(), files };
}

/* ── side B: the allowlist inside the SQL function ──────────────────────────────────────────── */

function allowlist(): { columns: string[]; file: string } {
  const dir = 'supabase/migrations';
  /* The LATEST migration that defines the function wins, because a later one supersedes an
     earlier. Sorted by filename, which is this project's date-ordered convention. */
  const defining = readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => /refund_ai_usage_impl/.test(read(`${dir}/${f}`)));
  assert.ok(defining.length > 0,
    'no migration defines refund_ai_usage_impl - if the function was removed, delete this cell and '
    + 'say so rather than leaving it passing on an empty set');
  const file = `${dir}/${defining[defining.length - 1]}`;
  /* SQL COMMENTS STRIPPED FIRST, and this was a live bug in this cell rather than a precaution.
     20261106a documents the OLD allowlist in a `--` comment, verbatim, including the phantom
     `search_count`. Without stripping, the regex matched the comment - the first occurrence in the
     file - and R3 reported `search_count` as still present on a migration that removes it, along
     with `public` and `refund_ai_usage_impl` swept up by the lazy match running past the comment.
     I strip comments on the TypeScript side and had not here, which is the whole error: a cell
     that reads documentation as code will confidently describe the state of a previous version. */
  const sql = read(file).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*--.*$/gm, ' ');
  const guard = /p_column\s+not\s+in\s*\(([\s\S]*?)\)\s*then/.exec(sql);
  assert.ok(guard, `${file} defines refund_ai_usage_impl but its "p_column not in (...)" guard could `
    + 'not be parsed. If the guard changed shape, this extraction needs re-deriving - do NOT delete '
    + 'the assertion, because an unparsed guard reads as an empty allowlist and would pass.');
  return { columns: [...guard[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort(), file };
}

/* ── the cells ──────────────────────────────────────────────────────────────────────────────── */

test('R1. PREMISE: both sides extracted something, and the exclusions are only the two known ones', () => {
  const app = appColumns();
  const allow = allowlist();

  assert.ok(extraToolColumns().length >= 10,
    `only ${extraToolColumns().length} entries read out of EXTRA_TOOL_COLUMN - the extraction broke, `
    + 'so every comparison below would pass on a short list');
  assert.ok(app.columns.length >= 15, `only ${app.columns.length} app columns found across ${app.files.length} caller file(s)`);
  assert.ok(allow.columns.length >= 5, `only ${allow.columns.length} columns read out of ${allow.file}`);

  /* THE EXCLUSION SET IS EMPTY TODAY, AND THAT IS CORRECT RATHER THAN A BROKEN FILTER.
   *
   * `tool_pool_count` does appear in a caller - `app/api/grok/route.ts` selects it - but inside a
   * COMMA-JOINED string: `.select('deep_count, quick_count, ..., tool_pool_count')`. The pattern
   * here matches a literal that is ENTIRELY one column name, so a multi-column select string is
   * not a column argument and is correctly not seen. `refund_count` is named only in the SQL.
   *
   * I asserted `['refund_count','tool_pool_count']` here first and it failed on an empty set -
   * the exclusion branch had never run. Asserting a precondition that does not hold would have
   * made this cell red for a reason unrelated to the allowlist, which is worse than not asserting
   * it: a premise cell that cries wolf gets deleted, and R2 and R3 go with it. */
  assert.deepEqual(app.excluded, [],
    `${JSON.stringify(app.excluded)} was filtered out as a non-column *_count literal. That branch has `
    + 'never fired before, so a hit means a caller now passes one of these as a column - decide '
    + 'whether it belongs in the comparison rather than leaving it filtered.');

  /* THE ONE THAT WOULD MATTER. `increment` charges an extra tool TWICE - the named column and the
     shared `tool_pool_count` - and the SQL function gives both back itself. A caller passing the
     pool as `p_column` would decrement it a second time, refunding more than was taken. */
  for (const forbidden of ['tool_pool_count', 'refund_count']) {
    assert.ok(!app.columns.includes(forbidden),
      `${forbidden} is being passed as a refund column by the app. It is the function's own `
      + 'bookkeeping, not a usage column: refunding it directly double-credits the shared budget.');
  }
});

test('R2. every column the app can refund is on the allowlist - the defect that cost every refund', () => {
  const app = appColumns();
  const allow = allowlist();
  const missing = app.columns.filter((c) => !allow.columns.includes(c));

  assert.deepEqual(missing, [],
    `${missing.length} column(s) the app passes to refundUsageColumn are NOT on ${allow.file}'s allowlist:\n`
    + `  ${missing.join('\n  ')}\n\n`
    + 'Each one raises 22023, which refundUsageColumn catches and logs, so the refund silently does '
    + 'not happen and the user keeps the charge. This is exactly how twelve columns were missing for '
    + 'the whole life of the feature - a failed refund and a refund never attempted look identical '
    + 'from outside. Add them to the allowlist in a NEW migration.');
});

test('R3. the allowlist names no column the app cannot pass - a phantom entry locks out the real one', () => {
  const app = appColumns();
  const allow = allowlist();
  const phantom = allow.columns.filter((c) => !app.columns.includes(c));

  assert.deepEqual(phantom, [],
    `${phantom.length} column(s) on ${allow.file}'s allowlist are passed by nothing in the app:\n`
    + `  ${phantom.join('\n  ')}\n\n`
    + 'A phantom is not harmless. `search_count` sat on the original allowlist and is not a column in '
    + 'either project, while the real one - chat_search_count - was locked out; the wrong name on the '
    + 'list is what made the right name look accounted for. Either the entry is dead and should go, or '
    + 'a caller that should be passing it is not.');
});
