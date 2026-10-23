/* #1632 item 4: IS AN ANONYMOUS DELETE - AND AN ANONYMOUS UPDATE - ACTUALLY REFUSED on the liquidation history?
 *
 * The grants were revoked on 2026-10-23 on the owner's instruction, and the session that made the change also verified it. This is
 * the independent run: it asks the database over PostgREST with the public anon key, the same way a browser would.
 *
 * THE FILTERS CANNOT MATCH A ROW, ON PURPOSE. Each probe targets `coin=eq.__qa_grant_probe__`, a value no real row carries, so a
 * grant that is still in place deletes or updates NOTHING - the probe reads the ANSWER (403 vs 2xx), not the effect. That matters
 * twice over: PM has seeded one identifiable row at `ts = now - 8 days` for #1730's purge test, and a probe that could reach it
 * would break someone else's measurement while proving a point about grants.
 *
 * THE CONTROL IS A READ, NOT A WRITE, AND THAT IS A DELIBERATE LIMIT. The usual positive control for "the write was refused" is a
 * write that succeeds, but INSERT is still granted here by design, and inserting a row would change the 195-row count #1730's test
 * asserts against. So the control proves the key and the role work (a SELECT returns rows) rather than proving writes work. Stated
 * rather than hidden: this run shows DELETE and UPDATE are refused and that the caller is otherwise functional - it does not prove
 * the refusal is grant-level rather than, say, a route-level block, and the catalogue read on #1632 covers that half.
 *
 * PRODUCTION IS NOT PROBED. A DELETE whose filter cannot match anything is still a write request to the production database, and
 * production writes are owner-direct. The same question is answered there read-only: `information_schema.role_table_grants` showed
 * anon and authenticated holding INSERT, REFERENCES, SELECT and TRIGGER only, with `liq_events_delete_expired` dropped.
 *
 * usage: node qa/tools/regress/liq-events-grants.mjs
 *   exit 0 = DELETE and UPDATE both refused, and the control read works
 *   exit 1 = one of them was accepted, or the control failed (read the output; do not assume which)
 *   exit 2 = could not run */
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

const need = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const missing = need.filter((k) => !env[k]);
if (missing.length) { console.error(`missing from the local env files: ${missing.join(', ')}`); process.exit(2); }

const TABLE = 'lhq_dev_liq_events';
const NO_SUCH_COIN = '__qa_grant_probe__';

const anon = (method, path, body) => fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
  method,
  headers: {
    'Content-Type': 'application/json',
    apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    Prefer: 'return=representation',
  },
  body: body === undefined ? undefined : JSON.stringify(body),
  signal: AbortSignal.timeout(30_000),
});

async function main() {
  console.log(`table: ${TABLE}  caller: anonymous (public anon key, no Authorization header)`);
  console.log(`every probe filters on coin=eq.${NO_SUCH_COIN}, which no row carries - nothing can be deleted or changed\n`);

  /* CONTROL: the key and the role work. If this fails, the two refusals below mean nothing. */
  const read = await anon('GET', `${TABLE}?select=coin,ts&limit=3`);
  const readRows = read.ok ? await read.json() : null;
  const controlOk = read.ok && Array.isArray(readRows) && readRows.length > 0;
  console.log(`CONTROL  GET  -> HTTP ${read.status} ${controlOk ? `OK, ${readRows.length} rows readable` : 'FAILED'}`);
  if (!controlOk) {
    console.error('the anonymous SELECT failed, so a refused DELETE below would say nothing about the grant.');
    return 1;
  }

  const del = await anon('DELETE', `${TABLE}?coin=eq.${NO_SUCH_COIN}`);
  const delBody = await del.text();
  console.log(`\n1. DELETE -> HTTP ${del.status} ${del.ok ? 'ACCEPTED' : 'REFUSED'}`);
  console.log(`   ${delBody.slice(0, 180) || '(empty body)'}`);

  const upd = await anon('PATCH', `${TABLE}?coin=eq.${NO_SUCH_COIN}`, { usd: 1 });
  const updBody = await upd.text();
  console.log(`\n2. UPDATE -> HTTP ${upd.status} ${upd.ok ? 'ACCEPTED' : 'REFUSED'}`);
  console.log(`   ${updBody.slice(0, 180) || '(empty body)'}`);

  if (del.ok || upd.ok) {
    console.error(`\nFAIL: ${del.ok ? 'DELETE' : ''}${del.ok && upd.ok ? ' and ' : ''}${upd.ok ? 'UPDATE' : ''} still accepted for an anonymous caller.`);
    console.error('No row was touched - the filter matched nothing - but the grant is there and a real filter would.');
    return 1;
  }
  console.log('\nPASS: an anonymous DELETE and an anonymous UPDATE are both refused, with a working anonymous read as the control.');
  return 0;
}

process.exitCode = await main();
