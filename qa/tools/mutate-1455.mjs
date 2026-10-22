/* Mutation check for __tests__/toastMobileNavOverlap.test.mts (#1455). */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const CSS = 'app/globals.css';
const TEST = ['__tests__/toastMobileNavOverlap.test.mts'];
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);

const M = [
  { name: 'C1 the tab bar shrinks (the height premise changes)', f: CSS, from: 'height: 56px; background: #0a0a0e; border-top: 0.5px solid var(--bdr); }', to: 'height: 48px; background: #0a0a0e; border-top: 0.5px solid var(--bdr); }', red: ['S1.'] },
  { name: 'C2 the media query is dropped entirely (the pre-fix regression)', f: CSS, from: '@media (max-width: 640px) {\n  .st-save-toast { bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 16px); }\n}\n', to: '', red: ['S2.', 'S3.', 'S4.', 'S6.'] },
  { name: 'C3 the 56px tab-bar height is dropped from the offset', f: CSS, from: '.st-save-toast { bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 16px); }', to: '.st-save-toast { bottom: calc(env(safe-area-inset-bottom, 0px) + 16px); }', red: ['S3.', 'S4.'] },
  { name: 'C4 the safe-area inset is dropped from the offset', f: CSS, from: '.st-save-toast { bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 16px); }', to: '.st-save-toast { bottom: calc(56px + 16px); }', red: ['S3.', 'S4.'] },
  { name: 'C5 the gap collapses to zero (the toast sits flush against the bar)', f: CSS, from: '.st-save-toast { bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 16px); }', to: '.st-save-toast { bottom: calc(56px + env(safe-area-inset-bottom, 0px)); }', red: ['S3.'] },
  { name: 'C6 the base desktop rule is touched by the mobile fix', f: CSS, from: '.st-save-toast {\n  position: fixed; bottom: 24px; right: 24px; z-index: 9999;', to: '.st-save-toast {\n  position: fixed; bottom: 40px; right: 24px; z-index: 9999;', red: ['S5.'] },
  { name: 'C7 the offset is re-guessed as a plain 60px, matching neither the tab-bar formula nor .app-content', f: CSS, from: '.st-save-toast { bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 16px); }', to: '.st-save-toast { bottom: 60px; }', red: ['S3.', 'S4.', 'S6.'] },
];

const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', CSS], { windowsHide: true });
const keyOf = (n) => n.split(' ')[0];
const run = () => {
  let out = '', code = 0;
  try { out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', ...TEST], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120_000 }); }
  catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status ?? 1; }
  const failed = [...new Set([...out.matchAll(/^\u2716 (.+?) \(/gm)].map((x) => keyOf(x[1])))].filter((k) => !k.includes('__tests__') && k !== 'failing');
  return { code, failed };
};

revert();
const base = run();
console.log(`BASELINE exit ${base.code} red: ${base.failed.join(', ') || '(none)'}`);
if (base.code !== 0) process.exit(2);
let all = true;
for (const m of M) {
  const src = readFileSync(`${ROOT}/${m.f}`, 'utf8').split(CR + LF).join(LF);
  const n = src.split(m.from).length - 1;
  if (n !== 1) { console.log(`SKIP    ${m.name}\n        anchor occurs ${n}x`); all = false; continue; }
  const at = src.indexOf(m.from);
  const out = src.slice(0, at) + m.to + src.slice(at + m.from.length);
  writeFileSync(`${ROOT}/${m.f}`, out);
  const r = run();
  revert();
  const missing = m.red.filter((k) => !r.failed.includes(k));
  const good = r.code !== 0 && missing.length === 0;
  if (!good) all = false;
  console.log(`${good ? 'OK    ' : 'WRONG '}  ${m.name}\n        want red: ${m.red.join(', ')} | actually red: ${r.failed.join(', ') || '(none - suite stayed GREEN)'}${missing.length ? ` | NOT CAUGHT: ${missing.join(', ')}` : ''}`);
}
revert();
console.log(all ? '\nAll mutations behaved as designed.' : '\nA MUTATION DID NOT BEHAVE AS DESIGNED.');
