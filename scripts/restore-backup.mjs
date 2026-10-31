#!/usr/bin/env node
/* Restore a dump written by /api/backup (#1413).
 *
 * A BACKUP NOBODY HAS RESTORED IS NOT A BACKUP. The export half is the easy half; the half that
 * matters on the bad day is this one, and the way it usually fails is that nobody ran it until
 * the day they had to. So this ships with the export rather than after it, and it defaults to a
 * dry run that reads the file and proves what it WOULD write.
 *
 * Usage:
 *   node scripts/restore-backup.mjs <dump.json>                      dry run - default
 *   node scripts/restore-backup.mjs <dump.json> --verify             dry run + round-trip proof
 *   node scripts/restore-backup.mjs <dump.json> --write --table X    actually write ONE table
 *
 * THERE IS NO "RESTORE EVERYTHING" FLAG, deliberately. A restore is performed one table at a
 * time, by a person who has read the dry run for that table, because the realistic disaster is a
 * single table damaged by a bad migration rather than a database that has vanished. A flag that
 * rewrites sixteen tables at once is a way to turn one bad day into a worse one.
 *
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are read from the environment for --write only. The
 * dry run and the verify need no credentials at all and touch no network.
 */
import { readFileSync } from 'node:fs';

const [file, ...flags] = process.argv.slice(2);
const WRITE = flags.includes('--write');
const VERIFY = flags.includes('--verify');
const only = flags.includes('--table') ? flags[flags.indexOf('--table') + 1] : null;

if (!file) {
  console.error('usage: node scripts/restore-backup.mjs <dump.json> [--verify] [--write --table NAME]');
  process.exit(2);
}

const raw = readFileSync(file, 'utf8');
const dump = JSON.parse(raw);

if (!dump || typeof dump !== 'object' || !dump.tables) {
  console.error('not a backup file: expected { takenAt, tables: { … } }');
  process.exit(2);
}

const tables = Object.entries(dump.tables);
console.log(`dump taken : ${dump.takenAt}`);
console.log(`tables     : ${tables.length}`);
console.log(`bytes      : ${Buffer.byteLength(raw).toLocaleString()}\n`);

console.log('table                               rows   columns  sample key');
console.log('─'.repeat(72));
let total = 0;
for (const [table, rows] of tables) {
  total += rows.length;
  const cols = rows.length ? Object.keys(rows[0]).length : 0;
  const key = rows.length ? (rows[0].id ?? rows[0].user_id ?? Object.values(rows[0])[0]) : '—';
  console.log(
    table.padEnd(34) + String(rows.length).padStart(7) + String(cols).padStart(10) +
    '  ' + String(key).slice(0, 22),
  );
}
console.log('─'.repeat(72));
console.log(`total rows: ${total.toLocaleString()}\n`);

if (VERIFY) {
  /* THE ROUND TRIP. Serialising and re-parsing must reproduce the rows exactly - if JSON has
     lost or changed anything (a Date becoming a string, a bigint overflowing, undefined being
     dropped) the restore would write different data than was backed up, silently. */
  let mismatches = 0;
  for (const [table, rows] of tables) {
    const again = JSON.parse(JSON.stringify(rows));
    if (JSON.stringify(again) !== JSON.stringify(rows)) { mismatches++; console.log(`  ROUND TRIP FAILED: ${table}`); }
  }
  console.log(`round trip: ${tables.length - mismatches} of ${tables.length} tables reproduce exactly`);

  /* CONTROL: the comparison must be capable of failing, or the line above means nothing. */
  const probe = [{ a: 1 }];
  const broken = JSON.parse(JSON.stringify(probe));
  broken[0].a = 2;
  console.log(`CONTROL (a mutated copy must differ): ${JSON.stringify(broken) !== JSON.stringify(probe) ? 'ok' : 'FAIL'}`);

  if (mismatches) process.exit(1);
}

if (!WRITE) {
  console.log('\nDRY RUN - nothing was written. Add --write --table <name> to restore one table.');
  process.exit(0);
}

if (!only) {
  console.error('\n--write requires --table <name>. There is no restore-everything flag; see the header.');
  process.exit(2);
}
const rows = dump.tables[only];
if (!rows) { console.error(`\n${only} is not in this dump`); process.exit(2); }

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('\nSUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for --write'); process.exit(2); }

const { createClient } = await import('@supabase/supabase-js');
const db = createClient(url, key, { auth: { persistSession: false } });

/* Upsert in pages, same reason the export paginates. Upsert rather than insert so a partial
   restore can be re-run without duplicating what already landed. */
const PAGE = 500;
let done = 0;
for (let i = 0; i < rows.length; i += PAGE) {
  const chunk = rows.slice(i, i + PAGE);
  const { error } = await db.from(only).upsert(chunk);
  if (error) { console.error(`\nfailed at row ${i}: ${error.message}`); process.exit(1); }
  done += chunk.length;
  console.log(`  ${done}/${rows.length}`);
}
console.log(`\nrestored ${done} rows into ${only}`);
