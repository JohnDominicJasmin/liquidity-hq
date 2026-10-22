import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const F = ROOT + '/__tests__/aliasHookScope.test.mts';
const src = readFileSync(F, 'utf8');

const muts = [
  ['M1 stop stripping block comments (reintroduces the original bug)',
   "replace(/\\/\\*[\\s\\S]*?\\*\\//g, ' ')", "replace(/NEVERMATCHESAAA/g, ' ')"],
  ['M2 drop the dynamic import() pattern',
   "/\\bimport\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)/g", "/NEVERMATCHESBBB/g"],
  ['M3 narrow back to single quotes only',
   "/\\bfrom\\s+['\"]([^'\"]+)['\"]/g", "/\\bfrom\\s+'([^']+)'/g"],
];

for (const [name, from, to] of muts) {
  if (!src.includes(from)) { console.log(`SKIP    ${name}\n        anchor: ${JSON.stringify(from)}`); continue; }
  writeFileSync(F, src.replace(from, to));
  let out = '', code = 0;
  try {
    out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', '__tests__/aliasHookScope.test.mts'],
      { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  } catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status ?? 1; }
  writeFileSync(F, src);
  const failed = [...out.matchAll(/^\u2716 (.+?) \(/gm)].map(m => m[1]);
  console.log(`${code !== 0 && failed.length ? 'CAUGHT' : 'MISSED'}  ${name}`);
  console.log(`        red: ${failed.length ? [...new Set(failed.map(f => f.slice(0, 52)))].join(' | ') : '(none - STAYED GREEN)'}`);
}
