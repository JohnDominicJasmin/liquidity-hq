/* Mutations of Dev's #1503 follow-up patch, run in wt-toast-fu: each must turn the named test red. Restores the file. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
process.chdir(process.argv[2]);
const P = 'components/SettingsProvider.tsx';
const orig = readFileSync(P, 'utf8');
const M = [
  ["    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }\n", '', 'S3b'],
  ["    setSaveStatus('error');\n    settleToIdle(3000);", "    setSaveStatus('error');\n    setTimeout(() => setSaveStatus('idle'), 3000);", 'S3'],
  ['    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);\n', '', 'S3b'],
  ['    retryingRef.current = true;\n', '', 'S3c'],
  ["retryingRef.current = false; setSaveStatus('error'); settleToIdle(3000); } return; }", 'retryingRef.current = false; } return; }', 'S3c'],
  ["    lastFailedRef.current = partial;\n    setSaveStatus('error');", "    setSaveStatus('error');\n    lastFailedRef.current = partial;", 'S8d'],
];
let bad = 0;
try {
  for (const [from, to, expect] of M) {
    const src = orig.split('\r\n').join('\n');
    const n = src.split(from).length - 1;
    if (n !== 1) { console.log(`BAD-ANCHOR (${n}x) ${from.slice(0, 60)}`); bad++; continue; }
    writeFileSync(P, src.replace(from, to));
    let out = '';
    try { out = execFileSync(process.execPath, ['--import', './qa/alias-register.mjs', '--test', '__tests__/settingsConflictNotice.test.mts'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = String(e.stdout || ''); }
    const red = [...new Set([...out.matchAll(/^\s*✖ (S\d+[a-z]?)\./gm)].map((m) => m[1]))];
    if (!red.includes(expect)) bad++;
    console.log(`${red.includes(expect) ? 'KILLED ' : 'SURVIVED'} expect ${expect} red=[${red.join(',')}] :: ${from.trim().slice(0, 60)}`);
    writeFileSync(P, orig);
  }
} finally { writeFileSync(P, orig); }
console.log(bad ? `${bad} not killed` : 'all mutations killed');
