#!/usr/bin/env node
/* Apply the label rows of a migration file to the DEV or PROD Supabase project through its REST endpoint, then read them back
 * and print count + md5, so the result can be compared with the SQL verify (PM, 2026-11-22: a weekend with no Supabase connector).
 *
 * Usage:
 *   node scripts/apply-label-migration.mjs <migration.sql> <dev|prod> --dry-run     parse only: row count and local md5, no network, no key
 *   node scripts/apply-label-migration.mjs <migration.sql> <dev|prod>               upsert, read back, compare
 *   options: --env-file <path>   default .env.local (one file; see CREDENTIALS)
 *            --batch <n>         rows per upsert request (default 200)
 *
 * WHAT IT READS FROM THE MIGRATION: every `insert into lhq_labels (key, locale, value) values (...)` statement when the target is
 * prod, every `insert into lhq_dev_labels ...` when it is dev. Nothing else in the file is executed. The statement must be the shape
 * the label migrations use (three columns, string literals, `on conflict (key, locale) do update`); any other shape is REFUSED with
 * the reason rather than guessed at. A duplicate (key, locale) inside one file is refused too (Postgres would reject it).
 *
 * THE VERIFY HASH is md5(string_agg(key || '|' || locale || '|' || value, E'\n' ORDER BY key COLLATE "C", locale COLLATE "C")), the
 * same expression the SQL check uses; "C" collation is a byte order, so keys and locales are sorted by their UTF-8 bytes. After the
 * upsert the same (key, locale) pairs are read back from the table and hashed the same way; a mismatch exits 1.
 *
 * CREDENTIALS. SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are read from the env file; a variable named
 * with a _DEV / _PROD suffix for the chosen target wins over the plain one. The URL's project ref must match the target
 * (dev = wdtjhrilakoitfcezxpx, prod = qdpwhnvmhqgzijuwopso) or the script stops before any request: a key for one project can never
 * write into the other by mistake. THE KEY IS NEVER PRINTED, LOGGED OR WRITTEN: it is held in a local variable and sent only as the
 * apikey / Authorization header; error messages carry the HTTP status and the server's message, never the request. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const REFS = { dev: 'wdtjhrilakoitfcezxpx', prod: 'qdpwhnvmhqgzijuwopso' };
const TABLES = { dev: 'lhq_dev_labels', prod: 'lhq_labels' };

function die(msg, code = 2) { console.error(msg); process.exit(code); }

/* ---------- arguments ---------- */
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--env-file', '--batch'].includes(args[i - 1])));
const [file, target] = positional;
const DRY = flag('--dry-run');
const BATCH = Math.max(1, Number(opt('--batch', 200)) || 200);
if (!file || !TABLES[target]) die('usage: node scripts/apply-label-migration.mjs <migration.sql> <dev|prod> [--dry-run] [--env-file path] [--batch n]');
const TABLE = TABLES[target];

/* ---------- parse the migration ---------- */
if (!existsSync(file)) die(`migration file not found: ${file}`);
const sql = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

/** Parses one `insert into <table> (cols) values (...), (...) on conflict ... ;` statement starting at `from`; returns { rows, end, conflict }. */
function parseInsert(src, from) {
  let i = from;
  const ws = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith('--', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
      break;
    }
  };
  const head = /insert\s+into\s+([a-z_]+)\s*\(([^)]*)\)\s*values/i.exec(src.slice(i));
  if (!head) die(`cannot read the insert header at offset ${from}`);
  const cols = head[2].split(',').map((c) => c.trim().toLowerCase());
  if (cols.join(',') !== 'key,locale,value') die(`REFUSED: ${head[1]} insert has columns (${cols.join(', ')}); only (key, locale, value) is supported`);
  i += head[0].length;
  const str = () => {
    ws();
    if (src[i] !== "'") die(`REFUSED: expected a string literal at offset ${i}, found ${JSON.stringify(src.slice(i, i + 24))}`);
    i++;
    let out = '';
    for (;;) {
      if (i >= src.length) die('REFUSED: unterminated string literal');
      const c = src[i];
      if (c === "'") { if (src[i + 1] === "'") { out += "'"; i += 2; continue; } i++; break; }
      out += c; i++;
    }
    return out;
  };
  const rows = [];
  for (;;) {
    ws();
    if (src[i] !== '(') die(`REFUSED: expected "(" at offset ${i}`);
    i++;
    const key = str(); ws(); if (src[i++] !== ',') die('REFUSED: expected "," after the key');
    const locale = str(); ws(); if (src[i++] !== ',') die('REFUSED: expected "," after the locale');
    const value = str(); ws(); if (src[i++] !== ')') die(`REFUSED: expected ")" after the value of ${key}/${locale} (only three string columns are supported)`);
    rows.push({ key, locale, value });
    ws();
    if (src[i] === ',') { i++; continue; }
    break;
  }
  const tail = /^on\s+conflict\s*\(\s*key\s*,\s*locale\s*\)\s*do\s+update\s+set\s+value\s*=\s*excluded\.value/i.exec(src.slice(i));
  if (!tail) die(`REFUSED: the ${head[1]} insert does not end with "on conflict (key, locale) do update set value = excluded.value"; this script upserts, so any other conflict rule would not mean what the file says`);
  const semi = src.indexOf(';', i);
  if (semi < 0) die('REFUSED: no terminating ";"');
  return { table: head[1].toLowerCase(), rows, end: semi + 1 };
}

const rows = [];
{
  const re = /insert\s+into\s+([a-z_]+)\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    /* a match inside a -- comment line is not a statement */
    const lineStart = sql.lastIndexOf('\n', m.index) + 1;
    if (/^\s*--/.test(sql.slice(lineStart, m.index))) continue;
    if (m[1].toLowerCase() !== TABLE) { const r = parseInsert(sql, m.index); re.lastIndex = r.end; continue; }
    const r = parseInsert(sql, m.index);
    rows.push(...r.rows);
    re.lastIndex = r.end;
  }
}
if (!rows.length) die(`no "insert into ${TABLE}" rows found in ${file} (target ${target})`);
const seen = new Set();
for (const r of rows) {
  const k = `${r.key}\u0000${r.locale}`;
  if (seen.has(k)) die(`REFUSED: ${r.key} / ${r.locale} appears twice in the ${TABLE} inserts of this file`);
  seen.add(k);
  if (!/^[A-Za-z0-9_]+$/.test(r.key) || !/^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(r.locale)) die(`REFUSED: unexpected key or locale shape: ${JSON.stringify(r.key)} / ${JSON.stringify(r.locale)}`);
}

/* ---------- the verify hash ---------- */
const byBytes = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
function hashRows(list) {
  const sorted = [...list].sort((a, b) => byBytes(a.key, b.key) || byBytes(a.locale, b.locale));
  return createHash('md5').update(sorted.map((r) => `${r.key}|${r.locale}|${r.value}`).join('\n'), 'utf8').digest('hex');
}
const localMd5 = hashRows(rows);
const keys = [...new Set(rows.map((r) => r.key))];
console.log(`migration : ${file}`);
console.log(`target    : ${target} (${TABLE})`);
console.log(`rows      : ${rows.length} (${keys.length} keys, locales ${[...new Set(rows.map((r) => r.locale))].sort().join(' ')})`);
console.log(`local md5 : ${localMd5}`);
if (DRY) { console.log('dry run   : nothing was sent'); process.exit(0); }

/* ---------- credentials (never printed) ---------- */
function readEnvFile(p) {
  if (!existsSync(p)) die(`env file not found: ${p}`);
  const out = {};
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const env = { ...readEnvFile(opt('--env-file', '.env.local')) };
const pick = (name, alt) => env[`${name}_${target.toUpperCase()}`] ?? env[name] ?? (alt ? env[alt] : undefined) ?? process.env[`${name}_${target.toUpperCase()}`] ?? process.env[name] ?? (alt ? process.env[alt] : undefined);
const baseUrl = String(pick('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL') ?? '').replace(/\/+$/, '');
const serviceKey = pick('SUPABASE_SERVICE_ROLE_KEY');
if (!baseUrl || !serviceKey) die(`the env file has no SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY for target ${target}`);
let host; try { host = new URL(baseUrl).hostname; } catch { die('the Supabase URL in the env file is not a URL'); }
if (host !== `${REFS[target]}.supabase.co`) die(`REFUSED: the env file's Supabase project is not the ${target} project (${REFS[target]}); no request was made`);

const headers = (extra = {}) => ({ apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, ...extra });
async function call(method, urlPath, body, extra) {
  let res;
  try { res = await fetch(`${baseUrl}/rest/v1/${urlPath}`, { method, headers: headers(extra), body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch (e) { die(`network error on ${method} ${TABLE}: ${e?.cause?.code ?? e?.message ?? 'unknown'}`, 1); }
  if (!res.ok) { let m = ''; try { m = (await res.json())?.message ?? ''; } catch { /* no body */ } die(`${method} ${TABLE} failed: HTTP ${res.status} ${String(m).slice(0, 200)}`, 1); }
  return res;
}

/* ---------- upsert ---------- */
const now = new Date().toISOString();
let sent = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH).map((r) => ({ key: r.key, locale: r.locale, value: r.value, updated_at: now }));
  await call('POST', `${TABLE}?on_conflict=key,locale`, chunk, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' });
  sent += chunk.length;
}
console.log(`upserted  : ${sent} rows`);

/* ---------- read back the same (key, locale) pairs ---------- */
const wanted = new Set(rows.map((r) => `${r.key}\u0000${r.locale}`));
const back = [];
for (let i = 0; i < keys.length; i += 50) {
  const inList = keys.slice(i, i + 50).join(',');
  const res = await call('GET', `${TABLE}?select=key,locale,value&key=in.(${inList})&limit=1000`);
  for (const r of await res.json()) if (wanted.has(`${r.key}\u0000${r.locale}`)) back.push({ key: r.key, locale: r.locale, value: r.value });
}
const backMd5 = hashRows(back);
console.log(`read back : ${back.length} rows`);
console.log(`db md5    : ${backMd5}`);

const ok = back.length === rows.length && backMd5 === localMd5;
console.log(ok ? 'verify    : MATCH' : `verify    : MISMATCH (expected ${rows.length} rows / ${localMd5})`);

/* a plain-text record next to the other scratch files (git-ignored: .work/); no key, no row values */
try {
  mkdirSync('.work', { recursive: true });
  const name = path.basename(file).replace(/\.sql$/, '');
  writeFileSync(path.join('.work', `apply-${name}-${target}.txt`), `${new Date().toISOString()} ${target} ${TABLE} rows=${rows.length} readback=${back.length} md5=${backMd5} local=${localMd5} ${ok ? 'MATCH' : 'MISMATCH'}\n`);
} catch { /* the record is a convenience */ }
process.exit(ok ? 0 : 1);
