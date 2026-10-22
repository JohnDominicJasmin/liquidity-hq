/* Mutation check for the JSON-rescue tests in __tests__/aliasHookScope.test.mts. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const HOOK = 'qa/alias-hooks.mjs';
const TEST = '__tests__/aliasHookScope.test.mts';
const M = [
  { name: 'H1 the JSON rescue is switched off', from: "r.url.endsWith('.json') && r.url.startsWith(ROOT)", to: "false && r.url.startsWith(ROOT)", red: ['CONTROL:'] },
  { name: 'H2 the rescue also covers node_modules', from: "&& !r.url.includes('/node_modules/')", to: '', red: ['the'] },
];
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
const revert = () => execFileSync('git', ['-C', ROOT, 'stash', 'push', '--keep-index', '--quiet', '--', 'nothing'], { windowsHide: true, stdio: 'ignore' });
const orig = readFileSync(`${ROOT}/${HOOK}`, 'utf8');
const run = () => {
  let out = '', code = 0;
  try { out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', TEST], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120_000 }); }
  catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status ?? 1; }
  const failed = [...new Set([...out.matchAll(/^\u2716 (.+?) \(/gm)].map((x) => x[1].split(' ').slice(0, 2).join(' ')))].filter((k) => !k.includes('__tests__') && !k.startsWith('failing'));
  return { code, failed };
};
const base = run();
console.log(`BASELINE exit ${base.code} red: ${base.failed.join(' | ') || '(none)'}`);
if (base.code !== 0) process.exit(2);
let all = true;
for (const m of M) {
  const src = orig.split(CR + LF).join(LF);
  const n = src.split(m.from).length - 1;
  if (n !== 1) { console.log(`SKIP ${m.name}: anchor x${n}`); all = false; continue; }
  writeFileSync(`${ROOT}/${HOOK}`, src.replace(m.from, () => m.to).split(LF).join(CR + LF));
  const r = run();
  writeFileSync(`${ROOT}/${HOOK}`, orig);
  const good = r.code !== 0 && r.failed.length > 0;
  if (!good) all = false;
  console.log(`${good ? 'OK   ' : 'WRONG'} ${m.name}\n       red: ${r.failed.join(' | ') || '(none - suite stayed GREEN)'}`);
}
writeFileSync(`${ROOT}/${HOOK}`, orig);
console.log(all ? 'All mutations behaved as designed.' : 'A MUTATION DID NOT BEHAVE AS DESIGNED.');
