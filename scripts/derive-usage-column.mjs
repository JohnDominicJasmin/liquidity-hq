#!/usr/bin/env node
// Generates the `create or replace` that adds one usage column's branches to
// `increment_ai_usage_impl`, by CLONING a sibling branch out of the function's own LIVE
// definition.
//
// ── WHY IT EXISTS ───────────────────────────────────────────────────────────────────────────────
//
// `supabase/migrations/20261031a_draw_structure_usage.sql` carries a hand-copied body for the dev
// project that was never applied. The hazard is not that the copy is wrong today - measured, it
// matches. It is that a transcribed function body records the function as of the day it was typed,
// two later migrations have already replaced that function, and **nothing in the file or the diff
// says which day that was.** The copy has no way of staying right and no way of announcing when it
// stops.
//
// That file's answer was four manual steps. This is the same four steps as a tool, so the
// derivation happens at apply time from the live artefact instead of being remembered.
//
// ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────────────────────────
//
// It never connects to a database, never writes anything, and never applies anything. GENERATING
// SQL IS NOT APPLYING IT - the apply stays a separate decision, and on prod it is the owner's.
// Same posture as `scripts/migration-check.mjs`, which prints a query for a human to run.
//
// **It never reads the migration file either, and that is deliberate.** That file cannot be parsed:
// its dev section is commented-out SQL and the prose explaining it is also comments, so the two are
// the same token. Strip `--` to read the SQL and every sentence of prose becomes code; leave it on
// and the SQL is invisible. Three attempts at counting one marker in it produced 4, 9 and 7. The
// live function is the only sound source.
//
// ── WHY CLONING, RATHER THAN SUBSTITUTING A PREFIX ──────────────────────────────────────────────
//
// The obvious approach is to take prod's body and swap `lhq_` for `lhq_dev_`. Cloning a sibling
// branch out of the TARGET's own definition is better for a reason worth stating: **the table name
// comes for free.** The template branch already says whatever that project calls the table, so
// there is no prefix rule to get wrong, and the same script works on either project with no flag.
//
// It also inherits the body's current shape rather than imposing a remembered one, so a function
// that has moved on since anyone last looked still gets a branch that matches its neighbours.
//
// ── USAGE ───────────────────────────────────────────────────────────────────────────────────────
//
//   1. In the session that will apply it, get the live definition from the TARGET project:
//
//        select pg_get_functiondef(p.oid)
//          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
//         where n.nspname = 'public' and p.proname = 'increment_ai_usage_impl';
//
//   2. Save it and run:
//
//        node scripts/derive-usage-column.mjs --def live.sql --column draw_structure_count
//        node scripts/derive-usage-column.mjs --column draw_structure_count < live.sql
//
//      Optional: --template smc_snapshot_count   (which sibling to clone; default below)
//                --sql-only                      (emit only the SQL, no report)
//
//   3. Read the report. It prints the branch set before and after, the marker counts, and what the
//      ALTER TABLE needs to be. Then apply both yourself, in that order.
//
// The report is the point. A generated statement nobody inspected is a transcription with extra
// steps.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const column = flag('column');
const template = flag('template', 'smc_snapshot_count');
const defPath = flag('def');
const sqlOnly = has('sql-only');

const die = (msg) => { console.error(`derive-usage-column: ${msg}`); process.exit(1); };

if (!column) die('--column is required, e.g. --column draw_structure_count');
if (!/^[a-z][a-z0-9_]*_count$/.test(column)) {
  die(`--column must look like a usage column (lower_snake_case ending _count); got ${column}`);
}

/* REFUSE RATHER THAN BLOCK ON AN INTERACTIVE STDIN (QA, on #2032). With `--column` but no `--def`
   this read stdin and waited - and at apply time a hang reads as a slow operation rather than as a
   mistake, which is the one failure shape worse than an error. Every other refusal here exits 1 at
   once; this one took 120 seconds and a kill.
   A positional path is refused explicitly too, because silently ignoring an argument someone typed
   is how they conclude the tool read it. */
const positional = args.filter((a, i) => !a.startsWith('--') && !String(args[i - 1] ?? '').startsWith('--'));
if (!defPath && positional.length) {
  die(`unexpected argument "${positional[0]}" - pass it as --def ${positional[0]}, or pipe the ` +
      'definition on stdin. It was NOT read.');
}
if (!defPath && process.stdin.isTTY) {
  die('no definition given. Pass --def <file>, or pipe the pg_get_functiondef output on stdin. ' +
      'Refusing to wait on an interactive terminal - see the usage header.');
}

const def = (defPath ? readFileSync(defPath, 'utf8') : readFileSync(0, 'utf8')).replace(/\r\n/g, '\n');
if (!def.includes('increment_ai_usage_impl')) {
  die('that does not look like increment_ai_usage_impl - pass the pg_get_functiondef output');
}

/* Branch sets BEFORE, read from the input rather than assumed. A value appearing in the increment
   chain but not the rollback chain (or the reverse) is a half-applied column, which is exactly what
   this file's own `mentions = 8` check exists to catch - so it is surfaced, not smoothed over. */
const branchValues = (text) =>
  [...text.matchAll(/p_column\s*=\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
const before = branchValues(def);
const beforeSet = [...new Set(before)].sort();

if (beforeSet.includes(column)) {
  die(`${column} is ALREADY a branch in this definition - nothing to add. ` +
      'If the column is missing from the TABLE, that is the ALTER TABLE half, not this one.');
}
if (!beforeSet.includes(template)) {
  die(`template column ${template} is not a branch in this definition. ` +
      `Pick one of: ${beforeSet.join(', ')}`);
}

/* THE TRANSFORM: find each occurrence of the template's branch and insert a copy of it, with the
   column name swapped, immediately after. Inserting AFTER the template rather than before a chain
   terminator means this works on both chains without having to locate `else`/`end if` - and `elsif`
   order carries no meaning here, because the tested values are distinct.
   Each chain's branch has its own shape, so the regex takes the template's `elsif` line plus every
   following line up to (not including) the next `elsif`/`else`/`end if` at the same depth. */
const branchRe = new RegExp(
  `^([ \\t]*)(elsif\\s+p_column\\s*=\\s*'${template}'\\s+then\\n(?:(?![ \\t]*(?:elsif|else|end if)\\b)[^\\n]*\\n)*)`,
  'gm',
);

const matches = [...def.matchAll(branchRe)];
if (matches.length === 0) {
  die(`could not locate a branch for the template ${template}. The body's shape may have changed; ` +
      'inspect it by hand rather than trusting this script.');
}
/* Two chains are expected on this function: the increment chain and the rollback chain. One means
   the body changed shape; more than two means the regex is over-matching. Either way, stop. */
if (matches.length !== 2) {
  die(`expected the template to appear in exactly 2 chains (increment and rollback), found ` +
      `${matches.length}. Not guessing - inspect the definition by hand.`);
}

let out = def;
for (const m of [...matches].reverse()) {          // reverse so earlier offsets stay valid
  const whole = m[0];
  const clone = whole.replaceAll(template, column);
  out = out.slice(0, m.index) + whole + clone + out.slice(m.index + whole.length);
}

const after = branchValues(out);
const afterSet = [...new Set(after)].sort();
const added = afterSet.filter((v) => !beforeSet.includes(v));
const removed = beforeSet.filter((v) => !afterSet.includes(v));

/* BOTH DIRECTIONS, because an equality test at the ends cannot tell an addition from a silent
   drop - the point 20261031a makes about comparing hashes. */
if (removed.length) die(`the transform REMOVED branches: ${removed.join(', ')} - refusing to emit`);
if (added.length !== 1 || added[0] !== column) {
  die(`expected to add exactly ${column}, added: ${added.join(', ') || '(nothing)'}`);
}

const mentions = (text, needle) => (text.match(new RegExp(needle, 'g')) ?? []).length;
const addedMentions = mentions(out, column);

if (sqlOnly) {
  process.stdout.write(out.trimEnd() + '\n');
  process.exit(0);
}

const table = (out.match(/update\s+([a-z0-9_]*grok_usage)\b/) ?? [, '<grok_usage table>'])[1];

const report = [
  '',
  `-- derive-usage-column: ${column}, cloned from ${template}`,
  `--`,
  `-- branches before : ${beforeSet.length}`,
  `-- branches after  : ${afterSet.length}`,
  `-- added            : ${added.join(', ')}`,
  `-- removed          : ${removed.length ? removed.join(', ') : 'none'}`,
  `-- ${column} mentions: ${addedMentions}   (20261031a expects 8: increment 5, rollback 3)`,
  `-- table in the body : ${table}   <- taken FROM the definition, not assumed`,
  '--',
  '-- Unchanged markers, which is the half an equality test cannot show:',
  ...['tool_pool', 'p_pool_limit', 'p_global_limit', 'v_pool'].map(
    (m) => `--   ${m.padEnd(16)} before ${String(mentions(def, m)).padStart(3)}   after ${String(mentions(out, m)).padStart(3)}`,
  ),
  '--',
  '-- RUN THE ALTER TABLE FIRST. It is additive and needs no derivation:',
  `--   alter table ${table} add column if not exists ${column} int not null default 0;`,
  '--',
  '-- Then the statement below. Read it before running it.',
  '',
].join('\n');

process.stdout.write(report);
process.stdout.write(out.trimEnd() + '\n');

if (addedMentions !== 8) {
  console.error(
    `\nderive-usage-column: WARNING - ${column} appears ${addedMentions} times, not the 8 that ` +
    `20261031a's check expects (increment 5, rollback 3). The body's branch shape differs from ` +
    `the one that expectation was written against. Do not apply this without reading it.`,
  );
  process.exit(2);
}
