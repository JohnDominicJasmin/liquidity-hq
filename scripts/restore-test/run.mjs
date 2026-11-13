#!/usr/bin/env node
/* THE BACKUP RESTORE TEST (#1413). Restores a dump written by /api/backup into a THROWAWAY Postgres and
 * prints, for each of the 16 backed-up tables, the rows in the dump against the rows restored. Nothing else.
 *
 *   node scripts/restore-test/run.mjs --synthetic [--leaky-control] [--dup-control]
 *   node scripts/restore-test/run.mjs --file /tmp/dump.json
 *
 * ── THE LOG OF THIS SCRIPT IS PUBLIC (the repository is public), so THE OUTPUT CHANNEL IS ONE FUNCTION ──
 *
 * `report(table, expected, restored)` is the only place that prints a result, and it accepts a table name
 * from the BACKUP_TABLES allowlist and two integers, and nothing else. A failure is `die(CODE)` where CODE is a
 * fixed string literal chosen here, never an error message: Postgres error text can quote the value that failed
 * (`Key (email)=(...) already exists`, `invalid input syntax for type uuid: "..."`), so every child process runs
 * with its stderr discarded and this script never prints anything it received from one except integer counts it
 * parsed itself. No row, key, id, email, token or error text can reach the log because no path prints one.
 * `--leaky-control` is the single deliberate exception, to prove a grep for the planted sentinels CAN fail.
 *
 * ── WHAT THIS PROVES, AND WHAT IT DOES NOT ──
 *
 * It proves the dump is valid JSON of the expected shape, that every row loads into Postgres, that the row counts
 * match, and that no primary-key tuple repeats (the keys come from BACKUP_TABLES.orderBy, which is each table's
 * primary key). It does NOT prove the typed schema: the repository has no CREATE TABLE for five of the sixteen
 * tables (muted_alerts, price_alerts, hypotheses, hypothesis_evidence, app_config, by grep of supabase/), so rows
 * are loaded as jsonb. Restoring into the real column types is a separate gap, and this says so rather than hide it.
 *
 * Imports lib/backupTables.ts only (no node_modules, Node strips the types), and uses the `psql` client the
 * GitHub runner already has. Connection: the standard PG* variables, defaulting to the workflow's service container. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BACKUP_TABLES } from '../../lib/backupTables.ts';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const SYNTHETIC = has('--synthetic');
const LEAKY = has('--leaky-control');
const DUP = has('--dup-control');
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;

/** `lhq_labels` and `lhq_dev_labels` are both `labels`: the dump's keys carry the environment prefix. */
const base = (t) => String(t).replace(/^lhq_(dev_)?/, '');
const ORDER = new Map(BACKUP_TABLES.map((b) => [base(b.table), b.orderBy]));
const COLS_OK = /^[a-z_][a-z0-9_]*$/;

function die(code) { console.log('RESTORE_TEST_FAILED ' + code); process.exit(1); }

let failed = false;
/** THE ONE OUTPUT CHANNEL for a result: an allowlisted table name and integers. */
function report(table, expected, restored, uniqueOk) {
  if (!ORDER.has(table) || !Number.isInteger(expected) || !Number.isInteger(restored)) die('BAD_REPORT');
  const ok = expected === restored && uniqueOk === true;
  if (!ok) failed = true;
  console.log(`${table}: expected ${expected} restored ${restored} ${expected !== restored ? 'COUNT_MISMATCH' : uniqueOk ? 'OK' : 'DUPLICATE_KEYS'}`);
}

/** Run one psql command. stderr is discarded; stdout is returned only for the integer queries below. */
function psql(sql) {
  const r = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    env: { PGHOST: 'localhost', PGUSER: 'postgres', PGDATABASE: 'postgres', ...process.env },
    stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) die('PSQL_FAILED');
  return r.stdout ?? '';
}
const int = (s) => { const n = Number(String(s).trim()); if (!Number.isInteger(n)) die('NOT_AN_INTEGER'); return n; };

/* ── the dump: a real file, or a generated one full of planted sentinels ── */
function syntheticDump() {
  const tables = {};
  for (const [name, cols] of ORDER) {
    const rows = [];
    for (let i = 0; i < 5; i++) {
      const row = {};
      for (const c of cols) row[c] = c === 'id' ? i + 1 : `${name}-${c}-${i}`;
      row.email = `SENTINEL-EMAIL-${name}-${i}@example.invalid`;
      row.token = `SENTINEL-TOKEN-${name}-${i}-eyJhbGciOiJIUzI1NiJ9`;
      row.display_name = `SENTINEL-NAME-${name}-${i}`;
      /* Characters that break a naive COPY: a backslash, a tab, a newline, a quote, a unicode letter and an
         escaped NUL-adjacent sequence. They must round-trip and must not change a count. */
      row.note = `SENTINEL-NOTE back\\slash\ttab\nnewline "quote" 'apos' é中 ${i}`;
      rows.push(row);
    }
    if (DUP && name === 'labels') rows.push({ ...rows[0] });   // the negative control: a repeated primary key
    tables['lhq_' + name] = rows;
  }
  return { takenAt: '2026-11-13T00:00:00.000Z', tables };
}

let dump;
if (SYNTHETIC) dump = syntheticDump();
else {
  if (!fileArg) die('NO_FILE_ARGUMENT');
  try { dump = JSON.parse(readFileSync(fileArg, 'utf8')); } catch { die('DUMP_NOT_JSON'); }
}
if (!dump || typeof dump !== 'object' || !dump.tables || typeof dump.tables !== 'object') die('DUMP_SHAPE');

const dumpCounts = new Map();
for (const [key, rows] of Object.entries(dump.tables)) {
  const b = base(key);
  if (!ORDER.has(b)) die('UNKNOWN_TABLE');
  if (!Array.isArray(rows)) die('TABLE_NOT_AN_ARRAY');
  dumpCounts.set(b, rows.length);
}
for (const b of ORDER.keys()) if (!dumpCounts.has(b)) die('TABLE_MISSING_FROM_DUMP');

/* ── load: one jsonb row per source row, via COPY (text format: backslashes doubled, JSON has no raw tab or newline) ── */
const dir = mkdtempSync(path.join(tmpdir(), 'restore-'));
try {
  const out = [];
  for (const [key, rows] of Object.entries(dump.tables)) {
    const b = base(key);
    for (const row of rows) out.push(b + '\t' + JSON.stringify(row).replace(/\\/g, '\\\\'));
  }
  const nd = path.join(dir, 'rows.copy');
  writeFileSync(nd, out.join('\n') + '\n');

  psql('drop table if exists restored');
  psql('create table restored (tbl text not null, r jsonb not null)');
  psql(`\\copy restored (tbl, r) from '${nd.replace(/\\/g, '/')}'`);

  const restored = new Map();
  for (const line of psql('select tbl, count(*) from restored group by tbl order by tbl').split('\n')) {
    if (!line.trim()) continue;
    const [t, n] = line.split('|');
    if (!ORDER.has(t)) die('UNEXPECTED_TABLE_IN_RESTORE');
    restored.set(t, int(n));
  }

  for (const [t, cols] of ORDER) {
    if (!cols.every((c) => COLS_OK.test(c))) die('BAD_KEY_COLUMN');
    const tuple = cols.map((c) => `r->'${c}'`).join(', ');
    const distinct = int(psql(`select count(distinct jsonb_build_array(${tuple})) from restored where tbl = '${t}'`));
    const got = restored.get(t) ?? 0;
    report(t, dumpCounts.get(t), got, distinct === got);
  }
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* the runner's disk goes with the job */ }
}

if (LEAKY) console.log('LEAKY_CONTROL SENTINEL-EMAIL-labels-0@example.invalid');   // the deliberate leak a log grep must catch
console.log(failed ? 'RESTORE_TEST FAIL' : 'RESTORE_TEST PASS');
process.exit(failed ? 1 : 0);
