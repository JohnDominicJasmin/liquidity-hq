import { readFileSync } from 'node:fs';
const root = process.argv[2];
const sql = readFileSync(`${root}/supabase/migrations/20261001c_labels_translations_ko_zh_ar_ru.sql`, 'utf8').split(/\r?\n/).join('\n');
const defaults = JSON.parse(readFileSync(`${root}/lib/labelDefaults.en.json`, 'utf8'));
const keysSrc = readFileSync(`${root}/lib/labelKeys.ts`, 'utf8');

function parse(lines) {
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith("('")) continue;
    const body = line.replace(/^\('/, '').replace(/'\)[,;]?\s*$/, '');
    const parts = body.split("','");
    if (parts.length !== 3) { console.log('BAD SPLIT', line); continue; }
    rows.push({ key: parts[0], locale: parts[1], value: parts[2].split("''").join("'") });
  }
  return rows;
}
const all = sql.split('\n');
const live = parse(all);
const dev = parse(all.filter((l) => l.startsWith('-- ')).map((l) => l.slice(3)));
console.log('live', live.length, 'dev', dev.length);
const keys = [...new Set(live.map((r) => r.key))];
console.log('keys', keys.length);
const locs = {};
for (const r of live) locs[r.locale] = (locs[r.locale] || 0) + 1;
console.log(locs);
const notInKeys = keys.filter((k) => !keysSrc.includes(`'${k}'`));
const notInDefaults = keys.filter((k) => !(k in defaults));
console.log('notInKeys', notInKeys, 'notInDefaults', notInDefaults);
// check for odd single quotes inside values (not doubled)
for (const l of all) { if (l.startsWith("('")) { const inner = l.replace(/^\('/, '').replace(/'\)[,;]?\s*$/, ''); const stripped = inner.split("','").join('').split("''").join(''); if (stripped.includes("'")) console.log('STRAY QUOTE', l.slice(0, 80)); } }
const tok = (s) => (s.match(/\{[A-Za-z0-9_]+\}/g) || []).sort().join('|');
const pct = (s) => (s.match(/%[sd]/g) || []).length;
const nums = (s) => (s.match(/\d+(?:[.,]\d+)?/g) || []).sort().join('|');
let tokMis = 0, numMis = 0;
for (const r of live) {
  const en = defaults[r.key];
  if (tok(en) !== tok(r.value)) { tokMis++; console.log('TOK', r.key, r.locale, tok(en), '=>', tok(r.value)); }
  if (pct(en) !== pct(r.value)) console.log('PCT', r.key, r.locale);
  if (nums(en) !== nums(r.value)) { numMis++; console.log('NUM', r.key, r.locale, JSON.stringify(nums(en)), '=>', JSON.stringify(nums(r.value)), '|', en.slice(0, 100), '|', r.value.slice(0, 100)); }
  if (!r.value.trim() || r.value === r.key) console.log('EMPTY/KEY', r.key, r.locale);
}
console.log('tokMis', tokMis, 'numMis', numMis);
const withTok = keys.filter((k) => tok(defaults[k]));
console.log('keys with tokens', withTok.length, withTok.map((k) => `${k}:${tok(defaults[k])}`).join(' '));
const withNum = keys.filter((k) => nums(defaults[k]));
console.log('keys with nums', withNum.length);
for (const k of withNum) console.log('  ', k, '|', defaults[k]);
// value equal to english
for (const r of live) if (r.value === defaults[r.key]) console.log('SAME AS EN', r.key, r.locale, r.value);
