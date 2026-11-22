/* QA: PR #2766 (a hand-run tool, not in the app): scripts/apply-label-migration.mjs applies the label rows of a held migration to the DEV or PROD project through its REST API with the service-role key, reads them back and compares count + md5.
 *
 * THE WRITTEN RULE (the script's header and Dev's PR text): it reads ONLY the label insert of the chosen target's table (prod = lhq_labels, dev = lhq_dev_labels) and nothing else in the file; any other shape is REFUSED with the reason, never guessed; a duplicate (key, locale) is refused; --dry-run does no network call and needs no key; the env file's project ref must match the target (dev wdtjhrilakoitfcezxpx, prod qdpwhnvmhqgzijuwopso) or it stops before any request; THE KEY IS NEVER PRINTED, LOGGED OR WRITTEN; the verify hash is md5 of "key|locale|value" lines joined by a newline, ordered by key then locale in BYTE order (COLLATE "C").
 *   A1  THE PARSER ON EVERY HELD MIGRATION: the real script is RUN with --dry-run on every migration file that contains a label insert (both targets): the row count, the key count, the locales and the md5 equal an independent reading of the same file (a regex over the ('KEY','locale','value') triples, md5 computed here in byte order)
 *   A2  ESCAPES AND NON-ASCII: a temp migration with '' escapes, a ; and a -- inside a value, Korean / Chinese / Russian / Arabic text and an emoji gives exactly the rows and md5 an independent reading gives
 *   A3  REFUSALS, each with a reason and NO network attempt (fetch is replaced by a tripwire): a duplicate (key, locale); a column list other than (key, locale, value); a conflict rule other than "do update set value = excluded.value"; a value that is not a string literal; no rows for the chosen target; a missing file; an unknown target
 *   A4  THE REF CHECK: an env file whose URL is another project is refused before any request, for dev and for prod, and the key's value appears in no output
 *   A5  THE KEY IS NEVER PRINTED: every line of the script that mentions the key is the read, the existence check or the request headers; no console / write / die call carries it
 *   A6  THE EXACT HOST (Dev's hardening on this PR): `<ref>.example.invalid`, `<ref>.supabase.co.evil.test`, `<ref>-x.supabase.co`, a path trick and a subdomain of the project host are all refused before any request for dev and prod; `<ref>.supabase.co` itself passes the check (reaches the request step, where the tripwire stops it); the key is in no output
 * WHAT THIS CANNOT PROVE: the upsert and the read-back against a real project (the first DEV runs, MATCH on six files, are Dev's), and that the service-role key in .env.local belongs to the project it says. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url); const SCRIPT = 'scripts/apply-label-migration.mjs'; const SRC = readFileSync(new URL(`../${SCRIPT}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const TRIPWIRE = `--import=data:text/javascript,${encodeURIComponent("globalThis.fetch = async () => { process.stderr.write('NETWORK-ATTEMPT'); process.exit(99); };")}`;
const TABLE: Record<string, string> = { dev: 'lhq_dev_labels', prod: 'lhq_labels' }; const REF: Record<string, string> = { dev: 'wdtjhrilakoitfcezxpx', prod: 'qdpwhnvmhqgzijuwopso' };
const run = (args: string[], env: Record<string, string> = {}) => { const r = spawnSync(process.execPath, [TRIPWIRE, SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env }, timeout: 60_000 }); return { code: r.status, out: `${r.stdout}\n${r.stderr}` }; };
const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const md5 = (rows: Array<{ k: string; l: string; v: string }>) => createHash('md5').update([...rows].sort((a, b) => byBytes(a.k, b.k) || byBytes(a.l, b.l)).map((r) => `${r.k}|${r.l}|${r.v}`).join('\n'), 'utf8').digest('hex');
/* an INDEPENDENT reading: the rows of the chosen table's blocks, by a regex over the triples (the script uses a character state machine) */
function reading(sql: string, table: string) {
  sql = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');   // a commented-out block (the DEV half of many old files) is not a statement
  const rows: Array<{ k: string; l: string; v: string }> = []; const re = new RegExp(`insert\\s+into\\s+${table}\\s*\\(\\s*key\\s*,\\s*locale\\s*,\\s*value\\s*\\)\\s*values([\\s\\S]*?)\\bon\\s+conflict`, 'gi'); let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) for (const t of m[1].matchAll(/\(\s*'([A-Za-z0-9_]+)'\s*,\s*'([a-z]{2,3}(?:-[A-Za-z0-9]+)?)'\s*,\s*'((?:[^']|'')*)'\s*\)/g)) rows.push({ k: t[1], l: t[2], v: t[3].replace(/''/g, "'") });
  return rows;
}
const MIGS = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
const tmp = mkdtempSync(path.join(tmpdir(), 'qa-apply-')); const tmpFile = (name: string, text: string) => { const p = path.join(tmp, name); writeFileSync(p, text, 'utf8'); return p; };
const HEAD = (t: string) => `insert into ${t} (key, locale, value) values\n`; const TAIL = '\non conflict (key, locale) do update set value = excluded.value, updated_at = now();\n';

test('A1. the real script, --dry-run, on every migration with a label insert (both targets), against an independent reading', () => {
  let files = 0, cells = 0, refusedOther = 0, refusedE = 0; const bad: string[] = [];
  for (const f of MIGS) { const sql = readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'); if (!/insert\s+into\s+lhq_(dev_)?labels/i.test(sql)) continue; files++;
    for (const t of ['dev', 'prod']) { const want = reading(sql, TABLE[t]); if (!want.length) continue; const r = run([`supabase/migrations/${f}`, t, '--dry-run']); cells++;
      const live = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n'); const clause = (new RegExp(`insert\\s+into\\s+${TABLE[t]}[\\s\\S]*?\\bon\\s+conflict([^;]*);`, 'i').exec(live)?.[1] ?? '').trim(); const accepted = /^\(\s*key\s*,\s*locale\s*\)\s*do\s+update\s+set\s+value\s*=\s*excluded\.value/i.test(clause);
      if (r.code !== 0 && /expected a string literal/.test(r.out) && /[^A-Za-z0-9_]E'/.test(live)) { refusedE++; continue; }   // Postgres escape strings (E'..\n..'): refused with the reason rather than read wrongly
      if (r.code !== 0 && !accepted) { if (/REFUSED: the .* insert does not end with/.test(r.out)) { refusedOther++; continue; } bad.push(`${f} ${t}: refused for another reason: ${r.out.trim().slice(0, 140)}`); continue; }
      if (r.code !== 0) { bad.push(`${f} ${t}: exit ${r.code}: ${r.out.trim().split('\n').slice(0, 2).join(' | ').slice(0, 160)}`); continue; }
      const rows = Number(/rows\s*:\s*(\d+)/.exec(r.out)?.[1]), md = /local md5 :\s*([0-9a-f]{32})/.exec(r.out)?.[1]; const keys = new Set(want.map((x) => x.k)).size;
      if (rows !== want.length || md !== md5(want) || !new RegExp(`${keys} keys`).test(r.out)) bad.push(`${f} ${t}: script ${rows} rows / ${md} vs reading ${want.length} rows / ${md5(want)}`);
      if (r.out.includes('NETWORK-ATTEMPT')) bad.push(`${f} ${t}: a --dry-run made a network call`); } }
  console.log(`[A1] ${files} migration files, ${cells} dry runs, ${refusedOther} refused because their conflict rule is not the upsert the script supports, ${refusedE} refused because they use Postgres E'..' escape strings (older file shapes, refused with the reason rather than misread)`); assert.ok(files >= 20 && cells >= 20, `CONTROL: only ${files} files / ${cells} cells`); assert.deepEqual(bad.slice(0, 6), [], `${bad.length} disagreements`);
});

test('A2. quotes, semicolons, comment markers and non-ASCII inside values', () => {
  const vals = ["it''s a ''quoted'' word", 'a; b; c', 'x -- not a comment', '포함되지 않음:', '不包含：', 'Не входит:', 'ليس مشمولا', 'emoji 😀 ok', 'trailing space ', "''"];
  const sql = `-- a comment with insert into lhq_labels (key, locale, value) values ('NOT_A_ROW','en','x')\n${HEAD('lhq_labels')}${vals.map((v, i) => `('KEY_${i}','${['en', 'ko', 'zh', 'ru', 'ar'][i % 5]}','${v}')`).join(',\n')}${TAIL}\n-- DEV\n${HEAD('lhq_dev_labels')}('ONLY_DEV','en','dev value')${TAIL}`; const p = tmpFile('a2.sql', sql);
  for (const t of ['prod', 'dev']) { const r = run([p, t, '--dry-run']); assert.equal(r.code, 0, r.out.slice(0, 300)); const want = reading(sql.split('\n').slice(1).join('\n'), TABLE[t]); assert.equal(Number(/rows\s*:\s*(\d+)/.exec(r.out)?.[1]), want.length); assert.equal(/local md5 :\s*([0-9a-f]{32})/.exec(r.out)?.[1], md5(want), `${t}: md5`); assert.ok(!r.out.includes('NOT_A_ROW'), 'a row inside a comment was read'); }
  assert.equal(reading(sql.split('\n').slice(1).join('\n'), 'lhq_labels').length, vals.length);
});

test('A3. refusals: each with its reason and without a network attempt', () => {
  const cases: Array<[string, string, string, RegExp]> = [
    ['duplicate', `${HEAD('lhq_labels')}('K_A','en','x'),\n('K_A','en','y')${TAIL}`, 'prod', /appears twice/],
    ['columns', `insert into lhq_labels (key, locale, value, extra) values ('K_A','en','x','y')${TAIL}`, 'prod', /only \(key, locale, value\)/],
    ['conflict rule', `${HEAD('lhq_labels')}('K_A','en','x')\non conflict (key, locale) do nothing;\n`, 'prod', /does not end with/],
    ['not a string literal', `${HEAD('lhq_labels')}('K_A','en', now())${TAIL}`, 'prod', /expected a string literal/],
    ['no rows for the target', `${HEAD('lhq_labels')}('K_A','en','x')${TAIL}`, 'dev', /no "insert into lhq_dev_labels" rows/],
    ['bad key shape', `${HEAD('lhq_labels')}('K A','en','x')${TAIL}`, 'prod', /unexpected key or locale shape/],
  ];
  for (const [name, sql, target, re] of cases) { const r = run([tmpFile(`a3-${name.replace(/\W/g, '')}.sql`, sql), target, '--dry-run']); assert.notEqual(r.code, 0, `${name}: not refused`); assert.match(r.out, re, `${name}: ${r.out.slice(0, 200)}`); assert.ok(!r.out.includes('NETWORK-ATTEMPT'), `${name}: a network attempt`); }
  const missing = run([path.join(tmp, 'nope.sql'), 'prod', '--dry-run']); assert.notEqual(missing.code, 0); assert.match(missing.out, /not found/); const badTarget = run(['supabase/migrations/' + MIGS[MIGS.length - 1], 'staging', '--dry-run']); assert.notEqual(badTarget.code, 0); assert.match(badTarget.out, /usage/);
});

test('A4. the env file\'s project must match the target; the key never appears in any output', () => {
  const SENT = 'QA_SENTINEL_KEY_9f3a7c21d4e8'; const mig = tmpFile('a4.sql', `${HEAD('lhq_labels')}('K_A','en','x')${TAIL}\n${HEAD('lhq_dev_labels')}('K_A','en','x')${TAIL}`);
  for (const t of ['dev', 'prod'] as const) { const other = t === 'dev' ? REF.prod : REF.dev; for (const url of [`https://${other}.supabase.co`, 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co', 'https://example.com']) { const env = tmpFile(`env-${t}-${url.length}.txt`, `SUPABASE_URL=${url}\nSUPABASE_SERVICE_ROLE_KEY=${SENT}\n`); const r = run([mig, t, '--env-file', env]); assert.notEqual(r.code, 0, `${t} with ${url} was not refused`); assert.match(r.out, /REFUSED: the env file's Supabase project is not the/); assert.ok(r.out.includes('no request was made')); assert.ok(!r.out.includes('NETWORK-ATTEMPT'), `${t} ${url}: a request was attempted`); assert.ok(!r.out.includes(SENT), `${t} ${url}: the key is in the output`); } }
  const noKey = run([mig, 'prod', '--env-file', tmpFile('env-nokey.txt', `SUPABASE_URL=https://${REF.prod}.supabase.co\n`)]); assert.notEqual(noKey.code, 0); assert.match(noKey.out, /SUPABASE_SERVICE_ROLE_KEY/); assert.ok(!noKey.out.includes('NETWORK-ATTEMPT'));
  assert.equal(/const REFS = \{ dev: '([a-z0-9]+)', prod: '([a-z0-9]+)' \}/.exec(SRC)?.slice(1).join(','), `${REF.dev},${REF.prod}`, 'the project refs in the script are not the ones in CLAUDE.md'); assert.match(SRC, /const TABLES = \{ dev: 'lhq_dev_labels', prod: 'lhq_labels' \}/);
});

test('A5. the service-role key is only read, checked and sent as a header', () => {
  const lines = SRC.split('\n').filter((l) => /serviceKey/.test(l)); assert.ok(lines.length >= 3 && lines.length <= 5, `${lines.length} lines mention the key`);
  for (const l of lines) { assert.ok(/const serviceKey = pick\('SUPABASE_SERVICE_ROLE_KEY'\)|if \(!baseUrl \|\| !serviceKey\)|apikey: serviceKey, Authorization: `Bearer \$\{serviceKey\}`/.test(l), `an unexpected use of the key: ${l.trim().slice(0, 100)}`); assert.ok(!/console\.|writeFileSync|die\(`[^`]*\$\{serviceKey\}/.test(l.replace(/if \(!baseUrl \|\| !serviceKey\) die\(`[^`]*`\);?/, '')), `the key is written: ${l.trim().slice(0, 100)}`); }
  assert.ok(!/\$\{(?:env|process\.env)\b/.test(SRC.replace(/pick = .*/, '')), 'the whole env is interpolated somewhere'); const rec = /writeFileSync\(path\.join\('\.work'[^\n]*/.exec(SRC)?.[0] ?? ''; assert.ok(rec && !/serviceKey|value/.test(rec.replace(/readback=.*/, '')), 'the record file carries the key or row values'); assert.ok(existsSync(new URL('../.gitignore', import.meta.url)) && /^\/?\.work\/?$/m.test(readFileSync(new URL('../.gitignore', import.meta.url), 'utf8')), '.work/ is not git-ignored');
});

test('A6. the project check is the EXACT host <ref>.supabase.co: look-alike hosts are refused before any request, the real host passes the check', () => {
  assert.match(SRC, /if \(host !== `\$\{REFS\[target\]\}\.supabase\.co`\) die\(/, 'the host check is not the exact comparison'); assert.ok(!/host\.startsWith\(/.test(SRC), 'a prefix test on the host is back');
  const mig = tmpFile('a6.sql', `${HEAD('lhq_dev_labels')}('K_A','en','x')${TAIL}\n${HEAD('lhq_labels')}('K_A','en','x')${TAIL}`); const SENT = 'QA_SENTINEL_KEY_a6';
  for (const t of ['dev', 'prod'] as const) {
    for (const url of [`https://${REF[t]}.example.invalid`, `https://${REF[t]}.supabase.co.evil.test`, `https://${REF[t]}-x.supabase.co`, `https://evil.test/${REF[t]}.supabase.co`, `https://x.${REF[t]}.supabase.co`]) { const r = run([mig, t, '--env-file', tmpFile(`env-a6-${t}-${url.length}.txt`, `SUPABASE_URL=${url}\nSUPABASE_SERVICE_ROLE_KEY=${SENT}\n`)]); assert.notEqual(r.code, 0, `${t} ${url}: not refused`); assert.match(r.out, /REFUSED: the env file's Supabase project is not the/, `${t} ${url}`); assert.ok(!r.out.includes('NETWORK-ATTEMPT'), `${t} ${url}: a request was attempted`); assert.ok(!r.out.includes(SENT)); }
    const ok = run([mig, t, '--env-file', tmpFile(`env-a6ok-${t}.txt`, `SUPABASE_URL=https://${REF[t]}.supabase.co/\nSUPABASE_SERVICE_ROLE_KEY=${SENT}\n`)]); assert.ok(ok.out.includes('NETWORK-ATTEMPT'), `${t}: the real project host did not pass the check (${ok.out.slice(0, 160)})`); assert.ok(!ok.out.includes(SENT));
  }
});
