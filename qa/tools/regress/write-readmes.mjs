/* Writes README.md in every #1640 page folder: what the photos are, which ones I actually opened (from _sweep/opened.txt, one line per photo:
 * "<folder>/<file> | <UTC hh:mm> | <what I saw>"), and the automatic findings for that page from summarize.mjs's rules. usage: node write-readmes.mjs */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { ROOT } from './rlib.mjs';
const opened = new Map();
if (existsSync(`${ROOT}/_sweep/opened.txt`)) for (const l of readFileSync(`${ROOT}/_sweep/opened.txt`, 'utf8').split('\n').filter(Boolean)) { const [f, t, what] = l.split(' | '); opened.set(f.trim(), { t: (t || '').trim(), what: (what || '').trim() }); }
for (const d of readdirSync(ROOT)) {
  const dir = `${ROOT}/${d}`; if (d.startsWith('_') || !statSync(dir).isDirectory()) continue;
  const files = readdirSync(dir).filter((f) => /\.(jpg|png)$/.test(f)).sort();
  const lines = [`# ${d}: #1640 full regression, qa build 193ac57 (2026-10-21)`, '',
    'Photo names: `<account>-<width>-<theme>[-full].jpg`. Accounts: `anon` signed out, `B` Free, `T` trial, `A` Pro (real sessions for the seeded dev-project test accounts).',
    'Light photos were taken with the app\'s own theme switch applied in the page (lib/theme.ts applyTheme); dark photos are a fresh load.', '`_sheet.jpg` puts the 16 viewport photos side by side.', '',
    '## Opened by me (QA), and what I saw', ''];
  const mine = files.filter((f) => opened.has(`${d}/${f}`));
  if (mine.length) for (const f of mine) { const o = opened.get(`${d}/${f}`); lines.push(`- \`${f}\` (${o.t} UTC): ${o.what}`); } else lines.push('- none yet');
  lines.push('', `## Not opened individually (${files.length - mine.length} of ${files.length})`, '', 'Seen only as part of `_sheet.jpg` where one exists, or not at all. A claim about one of these needs that photo opened first.', '');
  for (const f of files.filter((x) => !opened.has(`${d}/${x}`))) lines.push(`- \`${f}\``);
  writeFileSync(`${dir}/README.md`, lines.join('\n') + '\n');
}
console.log('READMEs written');
