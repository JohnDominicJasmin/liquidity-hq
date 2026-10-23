/* #1632 item 1: CAN A SIGNED-IN USER WRITE `telegram_chat_id` STRAIGHT TO THE DATABASE? The item's own fix list asks for exactly this
 * check - "QA test that a direct REST write is refused" - and nothing committed covered it.
 *
 * WHY A SCRIPT AND NOT A UNIT TEST. It needs real credentials and a real request to Supabase's REST endpoint, bypassing the app
 * entirely. A test in __tests__/ would run inside the pre-push gate, so every push would hit the network and every cloud runner
 * without secrets would see a failure that means nothing. This runs on demand and says what it measured.
 *
 * WHY IT IS WORTH HAVING AT ALL, given the grants are correct today. The fix is a GRANT, not code: no test, type or lint catches a
 * grant being widened again, and the migration that narrowed it is one file among 200. The hole it closed was a throwaway trial
 * account pointing the official bot's alerts - including its own free-text price-alert notes - at someone else's Telegram.
 *
 * THE POSITIVE CONTROL IS NOT OPTIONAL. "The write was refused" and "my request was malformed" look identical from here: both return
 * an error. So the run also writes an ALLOWLISTED column, and a refusal there means the instrument is broken rather than the product
 * being safe. The control writes a column's value back AS IT ALREADY IS, read first - so a successful control changes nothing.
 *
 * usage: node qa/tools/regress/settings-column-grants.mjs [--project dev|prod]
 *   exit 0 = telegram_chat_id refused AND the control write accepted (the state the fix intends)
 *   exit 1 = telegram_chat_id was WRITTEN, or the control was refused (either way, read the output before believing a verdict)
 *   exit 2 = could not run (missing env, sign-in failed) */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
const env = {};
for (const f of ['.env.e2e.local', '.env.local']) {
  const p = `${REPO}/${f}`;
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.replace(/^﻿/, ''));
    if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
for (const [k, v] of Object.entries(process.env)) if (!(k in env) && typeof v === 'string' && v !== '') env[k] = v;

const need = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'E2E_USER_A_EMAIL', 'E2E_USER_A_PASSWORD'];
const missing = need.filter((k) => !env[k]);
if (missing.length) { console.error(`missing from the local env files: ${missing.join(', ')}`); process.exit(2); }

/* The dev project by default. The table name carries the same prefix lib/tables.ts applies, and it is spelled out rather than
   derived so a run against the wrong project cannot be mistaken for a pass. */
const which = process.argv.includes('--project') ? process.argv[process.argv.indexOf('--project') + 1] : 'dev';
/* PRODUCTION IS GATED, because the POSITIVE CONTROL WRITES. The blocked write is expected to fail, but the control PATCHes an
   allowlisted column - value-preserving, read first and written back identical, so it changes no data, and it is still an UPDATE on
   a production row. Writes to the production database are owner-direct (CLAUDE.md, OWNER-RULES rule 3), and "it writes the same
   value" is not an exemption anyone gets to grant themselves. The prod half of this question is answerable WITHOUT a write, and was:
   a read of information_schema.column_privileges on 2026-10-23 showed `authenticated` holding INSERT/UPDATE on 26 columns with
   telegram_chat_id absent, and anon holding none. Use that unless the owner asks for the live attempt. */
if (which === 'prod' && !process.argv.includes('--owner-approved')) {
  console.error('refusing to run against production: the positive control writes to a production row, which needs the owner\'s go each time.');
  console.error('The grants there are already evidenced by a read-only catalogue query - see #1632 item 1. Pass --owner-approved only when he has said so.');
  process.exit(2);
}
const TABLE = which === 'prod' ? 'lhq_user_settings' : 'lhq_dev_user_settings';
const BLOCKED_COLUMN = 'telegram_chat_id';
const ALLOWED_COLUMN = 'beginner_mode';

async function main() {
  const auth = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: env.E2E_USER_A_EMAIL, password: env.E2E_USER_A_PASSWORD }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!auth.ok) { console.error(`sign-in failed: HTTP ${auth.status}`); return 2; }
  const { access_token: token, user } = await auth.json();
  if (!token || !user?.id) { console.error('sign-in returned no token or no user id'); return 2; }
  console.log(`table: ${TABLE}  account: A  user id: ${user.id.slice(0, 8)}...  (values never printed)`);

  const rest = (method, path, body) => fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  /* Read the row first: the control needs a value to write back unchanged, and a missing row would make both results meaningless. */
  const readRes = await rest('GET', `${TABLE}?user_id=eq.${user.id}&select=${ALLOWED_COLUMN},${BLOCKED_COLUMN}`);
  const rows = readRes.ok ? await readRes.json() : null;
  if (!readRes.ok || !Array.isArray(rows)) { console.error(`could not read own row: HTTP ${readRes.status}`); return 2; }
  if (rows.length !== 1) { console.error(`expected exactly 1 own row, got ${rows.length} - account A has no settings row yet?`); return 2; }
  const current = rows[0];
  const blockedBefore = current[BLOCKED_COLUMN];
  console.log(`own row read: ${ALLOWED_COLUMN}=${JSON.stringify(current[ALLOWED_COLUMN])}, ${BLOCKED_COLUMN} is ${blockedBefore === null ? 'null' : 'set'} (value not printed)`);

  /* ── 1. THE BLOCKED WRITE. A chat id that is obviously a test value, so a row that somehow accepts it is identifiable. ── */
  const probe = `qa-grant-probe-${Date.now()}`;
  const blocked = await rest('PATCH', `${TABLE}?user_id=eq.${user.id}`, { [BLOCKED_COLUMN]: probe });
  const blockedBody = await blocked.text();
  const refused = !blocked.ok;
  console.log(`\n1. PATCH ${BLOCKED_COLUMN}  -> HTTP ${blocked.status} ${refused ? 'REFUSED' : 'ACCEPTED'}`);
  console.log(`   response: ${blockedBody.slice(0, 200)}`);

  /* ── 2. THE POSITIVE CONTROL: an allowlisted column, written back as it already is. ── */
  const control = await rest('PATCH', `${TABLE}?user_id=eq.${user.id}`, { [ALLOWED_COLUMN]: current[ALLOWED_COLUMN] });
  const controlOk = control.ok;
  console.log(`\n2. CONTROL PATCH ${ALLOWED_COLUMN} (unchanged value) -> HTTP ${control.status} ${controlOk ? 'ACCEPTED' : 'REFUSED'}`);
  if (!controlOk) console.log(`   response: ${(await control.text()).slice(0, 200)}`);

  /* ── 3. READ BACK. A 2xx on the blocked write would not prove the value landed, and an error would not prove it did not. ── */
  const after = await rest('GET', `${TABLE}?user_id=eq.${user.id}&select=${BLOCKED_COLUMN}`);
  const afterRow = after.ok ? (await after.json())[0] : null;
  const landed = afterRow?.[BLOCKED_COLUMN] === probe;
  console.log(`\n3. read back: ${BLOCKED_COLUMN} ${landed ? 'HOLDS THE PROBE VALUE' : 'unchanged'}`);

  if (landed) {
    console.error(`\nFAIL: a signed-in user wrote ${BLOCKED_COLUMN} directly. #1632 item 1 is OPEN on ${which}.`);
    console.error('The probe value is still in the row - clear it before leaving.');
    return 1;
  }
  if (!refused) {
    console.error(`\nFAIL (ambiguous): the PATCH returned ${blocked.status} but the column did not change. Read the response above.`);
    return 1;
  }
  if (!controlOk) {
    console.error('\nFAIL: the CONTROL write was refused too, so "refused" says nothing about the column grant - the instrument is broken, not the product safe.');
    return 1;
  }
  console.log(`\nPASS on ${which}: ${BLOCKED_COLUMN} refused (HTTP ${blocked.status}), an allowlisted column accepted, column unchanged on read-back.`);
  return 0;
}

process.exitCode = await main();
