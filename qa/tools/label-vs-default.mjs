/* For each label migration: do its `en` values equal the code default in lib/labelDefaults.en.json?
 * If yes, qa/staging (no DB row => code default) already SHOW what prod will show for English.
 * Other locales have no code default, so they cannot be previewed on an env that lacks the rows. */
import { readFileSync, readdirSync } from 'node:fs';
const defaults = JSON.parse(readFileSync('lib/labelDefaults.en.json', 'utf8'));
const files = readdirSync('supabase/migrations').filter((f) => ['20260918b','20260919b','20260919f','20260923a'].some((p) => f.startsWith(p)));
for (const f of files) {
  const rows = [];
  for (const line of readFileSync('supabase/migrations/' + f, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t.startsWith("('")) continue;
    const parts = t.replace(/^\('/, '').replace(/'\)[,;]?\s*$/, '').split("','");
    if (parts.length !== 3) continue;
    rows.push({ key: parts[0], locale: parts[1], value: parts[2].split("''").join("'") });
  }
  const en = rows.filter((r) => r.locale === 'en');
  const other = rows.filter((r) => r.locale !== 'en');
  const same = en.filter((r) => defaults[r.key] === r.value);
  const diff = en.filter((r) => defaults[r.key] !== r.value);
  console.log(`${f}: ${rows.length} rows (${en.length} en, ${other.length} other-locale) | en equal to code default: ${same.length}/${en.length}`);
  for (const r of diff) console.log(`   DIFFERS ${r.key}\n      migration: ${JSON.stringify(r.value).slice(0, 110)}\n      default  : ${JSON.stringify(defaults[r.key] ?? '(no default)').slice(0, 110)}`);
}
