/* Do the labels a host SERVES match what the four release label migrations say?
 * Expected values come from the migration FILES; actual values from the host's public /api/labels.
 * Nothing here is derived from the code under test. Run from the repo root: node <this> <host> */
import { readFileSync } from 'node:fs';
const HOST = process.argv[2];
/* usage: node <this> <host> [migration names without .sql ...]; with no names, the four 2026-09 release files. Only the UNCOMMENTED (prod) rows are read:
   the dev section is the same rows commented out, so a host on the dev database that serves them proves dev == what prod will get. */
const MIGS = process.argv.length > 3 ? process.argv.slice(3) : ['20260918b_labels_support_contact_address', '20260919b_labels_alerts_ema_signal_desc_selection', '20260919f_labels_upgrade_annual_no_emdash', '20260923a_labels_three_plans_prices'];
const rows = [];
for (const m of MIGS) {
  let rowLines = 0, parsed = 0;
  for (const line of readFileSync(`supabase/migrations/${m}.sql`, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t.startsWith("('")) continue;
    rowLines++;
    const parts = t.replace(/^\('/, '').replace(/'\)[,;]?\s*$/, '').split("','");
    if (parts.length !== 3) continue;
    parsed++;
    rows.push({ mig: m.slice(0, 9), key: parts[0], locale: parts[1], value: parts[2].split("''").join("'") });
  }
  if (parsed !== rowLines || rowLines === 0) console.log(`  WARNING ${m}: ${rowLines} row lines, ${parsed} parsed - unparsed rows are NOT checked`);
}
const locales = [...new Set(rows.map((r) => r.locale))];
const served = {};
for (const l of locales) {
  const r = await fetch(`https://${HOST}/api/labels?locale=${l}`, { signal: AbortSignal.timeout(60_000) });
  served[l] = await r.json();
}
const byMig = {};
const bad = [];
for (const r of rows) {
  const got = served[r.locale]?.[r.key];
  const ok = got === r.value;
  const s = (byMig[r.mig] ??= { rows: 0, match: 0 });
  s.rows++; if (ok) s.match++; else bad.push({ ...r, got });
}
console.log(`host ${HOST}: locales ${locales.join(',')}; label rows served per locale: ${locales.map((l) => `${l}=${Object.keys(served[l]).length}`).join(' ')}`);
for (const [m, s] of Object.entries(byMig)) console.log(`  ${m}: ${s.match}/${s.rows} served values equal the migration's`);
for (const b of bad.slice(0, 12)) console.log(`  MISMATCH ${b.mig} ${b.locale} ${b.key}\n     migration: ${JSON.stringify(b.value).slice(0, 90)}\n     served   : ${JSON.stringify(b.got ?? '(absent)').slice(0, 90)}`);
console.log(`total: ${rows.length - bad.length}/${rows.length} match`);
