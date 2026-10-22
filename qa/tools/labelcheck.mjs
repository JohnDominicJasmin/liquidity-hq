// Usage: node labelcheck.mjs <head-ref> <base-ref>   (run from repo root)
// Checks: t() keys used in added lines exist in labelKeys.ts + labelDefaults.en.json at head;
// keys added to labelKeys/defaults; migration en rows == defaults; dev block commented.
import { execFileSync } from 'node:child_process';

const [, , head, base] = process.argv;
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const mb = git('merge-base', head, base).trim();
const files = git('diff', '--name-only', mb, head).split('\n').filter(Boolean);
console.log('merge-base', mb.slice(0, 8), 'files changed:', files.length);

const parseKeys = (src) => {
  const start = src.indexOf('export const LABEL_KEYS');
  const end = src.indexOf('] as const', start);
  const body = src.slice(start, end).split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  return new Set([...body.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]));
};
const keysTs = git('show', `${head}:lib/labelKeys.ts`);
const keySet = parseKeys(keysTs);
const defaults = JSON.parse(git('show', `${head}:lib/labelDefaults.en.json`));
const baseKeysTs = git('show', `${mb}:lib/labelKeys.ts`);
const baseKeySet = parseKeys(baseKeysTs);
console.log('key count head/base:', keySet.size, baseKeySet.size, 'defaults head/base:', Object.keys(defaults).length, Object.keys(JSON.parse(git('show', `${mb}:lib/labelDefaults.en.json`))).length);
const baseDefaults = JSON.parse(git('show', `${mb}:lib/labelDefaults.en.json`));

const addedKeys = [...keySet].filter((k) => !baseKeySet.has(k));
const removedKeys = [...baseKeySet].filter((k) => !keySet.has(k));
const addedDefaults = Object.keys(defaults).filter((k) => !(k in baseDefaults));
const changedDefaults = Object.keys(defaults).filter((k) => k in baseDefaults && baseDefaults[k] !== defaults[k]);
console.log('labelKeys added:', addedKeys);
console.log('labelKeys removed:', removedKeys);
console.log('defaults added:', addedDefaults);
console.log('defaults changed:', changedDefaults.map((k) => `${k}: ${JSON.stringify(baseDefaults[k])} -> ${JSON.stringify(defaults[k])}`));
console.log('in keys not defaults:', addedKeys.filter((k) => !(k in defaults)));
console.log('in defaults not keys:', addedDefaults.filter((k) => !keySet.has(k)));

// t() keys referenced in added lines of code files
const diff = git('diff', '-U0', mb, head, '--', '*.ts', '*.tsx');
const used = new Set();
for (const line of diff.split('\n')) {
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  for (const m of line.matchAll(/\bt\(\s*['"`]([A-Z0-9_]+)['"`]/g)) used.add(m[1]);
  for (const m of line.matchAll(/['"`]([A-Z][A-Z0-9]*_[A-Z0-9_]+)['"`]/g)) if (keySet.has(m[1]) || /_(LABEL|TITLE|BODY|ARIA|BUTTON|TEXT|HINT|DESC|ERROR|EMPTY)/.test(m[1])) used.add(m[1]);
}
const missing = [...used].filter((k) => !keySet.has(k) || !(k in defaults));
console.log('label-like keys in added code lines:', [...used]);
console.log('MISSING from keys/defaults:', missing.map((k) => `${k} keys=${keySet.has(k)} defaults=${k in defaults}`));

// migrations
for (const f of files.filter((f) => f.startsWith('supabase/migrations/'))) {
  let sql;
  try { sql = git('show', `${head}:${f}`); } catch { console.log('MIGRATION deleted:', f); continue; }
  console.log('\nMIGRATION', f);
  const lines = sql.split('\n');
  const live = lines.filter((l) => !/^\s*--/.test(l)).join('\n');
  const commented = lines.filter((l) => /^\s*--/.test(l)).map((l) => l.replace(/^\s*--\s?/, '')).join('\n');
  const rowRe = /\('([A-Z0-9_]+)'\s*,\s*'([a-z]{2})'\s*,\s*'((?:[^']|'')*)'\)/g;
  const tables = [...live.matchAll(/insert\s+into\s+(\w+)/gi)].map((m) => m[1]);
  const devCommented = /insert\s+into\s+lhq_dev_labels/i.test(commented);
  const devLive = /lhq_dev_labels/i.test(live);
  console.log(' live insert tables:', tables, '| dev block commented:', devCommented, '| dev live (BAD):', devLive);
  console.log(' other live statements:', [...live.matchAll(/^\s*(update|delete|alter|create|drop)\b[^\n]*/gim)].map((m) => m[0].trim()).slice(0, 10));
  const liveRows = [...live.matchAll(rowRe)];
  const devRows = [...commented.matchAll(rowRe)];
  const enLive = liveRows.filter((m) => m[2] === 'en');
  for (const m of enLive) {
    const v = m[3].replace(/''/g, "'");
    const d = defaults[m[1]];
    console.log(` en ${m[1]}: ${v === d ? 'MATCH' : 'MISMATCH sql=' + JSON.stringify(v) + ' default=' + JSON.stringify(d)}${keySet.has(m[1]) ? '' : ' NOT-IN-KEYS'}`);
  }
  const liveSet = liveRows.map((m) => m.slice(1).join('|')).sort().join('\n');
  const devSet = devRows.map((m) => m.slice(1).join('|')).sort().join('\n');
  console.log(' live rows:', liveRows.length, 'dev rows:', devRows.length, 'live==dev:', liveSet === devSet);
  console.log(' locales per key:', Object.entries(liveRows.reduce((a, m) => ((a[m[1]] ||= []).push(m[2]), a), {})).map(([k, v]) => `${k}:${v.join(',')}`).join(' '));
  console.log(' on conflict:', [...live.matchAll(/on conflict[^;]*/gi)].map((m) => m[0].replace(/\s+/g, ' ')));
}
