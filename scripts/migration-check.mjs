#!/usr/bin/env node
// Answers one question before a release: is every object our migration files
// create actually present in the database?
//
// Why it exists. On this project a migration FILE can be merged while the
// migration itself is never applied. Its first full run, on 2026-09-12, found
// that 20260629_onboarding_profile_fields.sql had never been applied to either
// database. So every onboarding save since June had failed on missing columns
// (#1113). A merged file reads as "done" when it isn't. See CLAUDE.md,
// "Migrations": apply a migration before the deploy that needs it.
//
// What it does. It reads supabase/migrations/*.sql in filename order (all files,
// only the files changed in a git range, or only those from a filename prefix
// on) and replays the schema statements it understands:
//   - creates:    tables, indexes, columns (every ADD COLUMN in a statement),
//                 policies, functions, triggers, row-level security
//   - drops:      policy, index, function, table, trigger, DROP COLUMN
//   - renames:    table and function RENAME TO
// Then it prints ONE read-only SQL query that returns, per surviving object,
// whether it's present. Run that query through the Supabase tool's execute_sql
// on each project.
//
// This script never connects to a database and never writes anything. It also
// never generates migrations: a generated diff can contain DROPs, and production
// has no backups (docs/OWNER-BLOCKERS.md row 1).
//
// Usage:
//   node scripts/migration-check.mjs [--range origin/main..origin/staging]
//                                    [--since 20260626] [--env prod|dev] [--absent-only]
//
// --env dev   Rewrites `lhq_` names to `lhq_dev_`, the dev project's naming
//             (lib/tables.ts). Names already starting `lhq_dev_` come from dev-only
//             statements: they're kept for dev and skipped for prod.
// --since     Skips files whose name sorts before the prefix. Files before
//             20260626 create unprefixed tables that were later renamed outside
//             any migration, so a full audit flags them as noise.
// --absent-only  Returns only the missing objects, plus one totals row.
//
// Every table an object hangs off is also checked as a CONTROL row. If a control
// row comes back absent, the name mapping is wrong, and the object rows for that
// table mean nothing.
//
// Not checked: data seeds (`insert into`), comments, and statements it doesn't
// recognise. They're counted in the summary so nothing is silently assumed.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const DIR = 'supabase/migrations';
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const range = opt('--range');
const since = opt('--since');
const env = opt('--env') ?? 'prod';
const absentOnly = args.includes('--absent-only');
if (!['prod', 'dev'].includes(env)) {
  console.error('--env must be prod or dev');
  process.exit(1);
}

let files = range
  ? execFileSync('git', ['diff', '--name-only', '--diff-filter=AM', range, '--', DIR], { encoding: 'utf8' })
      .split('\n').filter(f => f.endsWith('.sql'))
  : readdirSync(DIR).filter(f => f.endsWith('.sql')).map(f => join(DIR, f));
if (since) files = files.filter(f => basename(f) >= since);
files.sort((a, b) => basename(a).localeCompare(basename(b)));

// With --range, read each file as it stands at the range's END commit, not from
// the working tree. A release or PR migration usually doesn't exist on whatever
// branch happens to be checked out, and reading from disk crashed on exactly
// the files this check exists for (first seen on #1301, 2026-09-13).
const rangeHead = range ? range.split(/\.{2,3}/).pop() : null;
const readSource = f => (rangeHead
  ? execFileSync('git', ['show', `${rangeHead}:${f}`], { encoding: 'utf8' })
  : readFileSync(f, 'utf8'));

// Unquoted identifiers fold to lower case; quoted ones keep their spelling.
const ident = raw => (raw == null ? raw : raw.startsWith('"') ? raw.slice(1, -1) : raw.toLowerCase());
const N = String.raw`("[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;       // one name
const Q = String.raw`(?:${N}\.)?${N}`;                           // [schema.]name: two groups
const re = src => new RegExp(src, 'i');

const toEnv = n => (env === 'dev' && n && n.startsWith('lhq_') && !n.startsWith('lhq_dev_') ? 'lhq_dev_' + n.slice(4) : n);
const isDevOnly = (...names) => env === 'prod' && names.some(n => n && n.startsWith('lhq_dev_'));

const expected = new Map();
const keyOf = o => [o.kind, o.schema, o.name ?? '', o.tbl ?? ''].join('|');
const counts = { seed: 0, comment: 0, other: 0, devOnlySkipped: 0 };

function add(file, kind, schema, name, tbl) {
  if (isDevOnly(name, tbl)) { counts.devOnlySkipped++; return; }
  // Policy names are free text, not table-derived, so they keep their spelling.
  const o = { file, kind, schema: schema ?? 'public', name: kind === 'policy' ? name : toEnv(name), tbl: toEnv(tbl) };
  const k = keyOf(o);
  if (!expected.has(k)) expected.set(k, o);
}
function remove(pred) {
  for (const [k, o] of expected) if (pred(o)) expected.delete(k);
}

for (const file of files) {
  const sql = readSource(file)
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")   // function bodies can contain ';'
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
  const name = basename(file);

  for (const stmt of sql.split(';').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    let m;
    if ((m = stmt.match(re(`^create table (?:if not exists )?${Q}`)))) {
      add(name, 'table', ident(m[1]), ident(m[2]));
    } else if ((m = stmt.match(re(`^create (?:unique )?index (?:concurrently )?(?:if not exists )?${N} on (?:only )?${Q}`)))) {
      add(name, 'index', ident(m[2]), ident(m[1]), ident(m[3]));
    } else if ((m = stmt.match(re(`^alter table (?:if exists )?(?:only )?${Q} (.*)$`)))) {
      const schema = ident(m[1]) ?? 'public';
      const tbl = ident(m[2]);
      const rest = m[3];
      const renamed = rest.match(re(`^rename to ${N}$`));
      if (renamed) {
        const from = toEnv(tbl), to = toEnv(ident(renamed[1]));
        for (const o of expected.values()) {
          if (o.tbl === from) o.tbl = to;
          if (o.kind === 'table' && o.name === from) o.name = to;
        }
        continue;
      }
      let matched = false;
      for (const c of rest.matchAll(new RegExp(String.raw`add column (?:if not exists )?${N}`, 'gi'))) {
        add(name, 'column', schema, ident(c[1]), tbl); matched = true;
      }
      for (const c of rest.matchAll(new RegExp(String.raw`drop column (?:if exists )?${N}`, 'gi'))) {
        const col = ident(c[1]), t = toEnv(tbl);
        remove(o => o.kind === 'column' && o.tbl === t && o.name === col); matched = true;
      }
      if (/enable row level security/i.test(rest)) { add(name, 'rls', schema, null, tbl); matched = true; }
      if (!matched) counts.other++;
    } else if ((m = stmt.match(re(`^create policy ${N} on ${Q}`)))) {
      add(name, 'policy', ident(m[2]), ident(m[1]), ident(m[3]));
    } else if ((m = stmt.match(re(`^drop policy (?:if exists )?${N} on ${Q}`)))) {
      const pol = ident(m[1]), t = toEnv(ident(m[3]));
      remove(o => o.kind === 'policy' && o.name === pol && o.tbl === t);
    } else if ((m = stmt.match(re(`^create (?:or replace )?function ${Q}\\s*\\(`)))) {
      add(name, 'function', ident(m[1]), ident(m[2]));
    } else if ((m = stmt.match(re(`^alter function ${Q}\\s*(?:\\([^)]*\\))? rename to ${N}`)))) {
      const from = toEnv(ident(m[2])), to = toEnv(ident(m[3]));
      for (const o of expected.values()) if (o.kind === 'function' && o.name === from) o.name = to;
    } else if ((m = stmt.match(re(`^drop function (?:if exists )?${Q}`)))) {
      const fn = toEnv(ident(m[2]));
      remove(o => o.kind === 'function' && o.name === fn);
    } else if ((m = stmt.match(re(`^create (?:or replace )?trigger ${N}[\\s\\S]*? on ${Q}`)))) {
      add(name, 'trigger', ident(m[2]), ident(m[1]), ident(m[3]));
    } else if ((m = stmt.match(re(`^drop trigger (?:if exists )?${N} on ${Q}`)))) {
      const trg = ident(m[1]), t = toEnv(ident(m[3]));
      remove(o => o.kind === 'trigger' && o.name === trg && o.tbl === t);
    } else if ((m = stmt.match(re(`^drop index (?:concurrently )?(?:if exists )?${Q}`)))) {
      const idx = toEnv(ident(m[2]));
      remove(o => o.kind === 'index' && o.name === idx);
    } else if ((m = stmt.match(re(`^drop table (?:if exists )?${Q}`)))) {
      const t = toEnv(ident(m[2]));
      remove(o => (o.kind === 'table' && o.name === t) || o.tbl === t);
    } else if (/^insert into/i.test(stmt)) {
      counts.seed++;
    } else if (/^comment on/i.test(stmt)) {
      counts.comment++;
    } else {
      counts.other++;
    }
  }
}

const rowsList = [...expected.values()];
// Control rows: every table an object hangs off must itself exist.
const tables = new Set(rowsList.filter(o => o.kind === 'table').map(o => `${o.schema}.${o.name}`));
for (const o of [...rowsList]) {
  if (!o.tbl || tables.has(`${o.schema}.${o.tbl}`)) continue;
  tables.add(`${o.schema}.${o.tbl}`);
  rowsList.push({ file: '(control)', kind: 'table', schema: o.schema, name: o.tbl, tbl: null });
}

const summary =
  `-- migration-check: ${files.length} file(s)${range ? ` changed in ${range}` : ''}${since ? ` from ${since}` : ''}, env=${env}\n` +
  `-- objects to check: ${rowsList.length}. Not checked: ${counts.seed} seed(s), ${counts.comment} comment(s), ` +
  `${counts.other} unrecognised statement(s), ${counts.devOnlySkipped} dev-only object(s) skipped.\n`;

if (rowsList.length === 0) {
  process.stdout.write(summary + '-- Nothing to check.\n');
  process.exit(0);
}

const q = s => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const values = rowsList.map(o => `  (${q(o.file)}, ${q(o.kind)}, ${q(o.schema)}, ${q(o.name)}, ${q(o.tbl)})`).join(',\n');

process.stdout.write(`${summary}with expected(file, kind, sch, name, tbl) as (values
${values}
), checked as (
select e.file, e.kind, e.sch as schema, coalesce(e.name, '') as name, coalesce(e.tbl, '') as tbl,
  case e.kind
    when 'table'    then exists (select 1 from information_schema.tables t where t.table_schema = e.sch and t.table_name = e.name)
    when 'index'    then exists (select 1 from pg_indexes i where i.schemaname = e.sch and i.indexname = e.name)
    when 'column'   then exists (select 1 from information_schema.columns c where c.table_schema = e.sch and c.table_name = e.tbl and c.column_name = e.name)
    when 'policy'   then exists (select 1 from pg_policies p where p.schemaname = e.sch and p.tablename = e.tbl and p.policyname = e.name)
    when 'function' then exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace where n.nspname = e.sch and f.proname = e.name)
    when 'trigger'  then exists (select 1 from pg_trigger g join pg_class r on r.oid = g.tgrelid join pg_namespace n on n.oid = r.relnamespace where n.nspname = e.sch and r.relname = e.tbl and g.tgname = e.name and not g.tgisinternal)
    when 'rls'      then exists (select 1 from pg_class r join pg_namespace n on n.oid = r.relnamespace where n.nspname = e.sch and r.relname = e.tbl and r.relrowsecurity)
  end as present
from expected e
)
${absentOnly
  ? `select * from checked where present is not true
union all
select '(totals)', 'absent ' || count(*) filter (where present is not true) || ' of ' || count(*), '', '', '', null
from checked
order by present nulls first, file, kind, name;`
  : `select * from checked
order by present, file, kind, name;`}
`);
