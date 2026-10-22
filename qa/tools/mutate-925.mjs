/* Mutation check for __tests__/liqFeedDedup.test.mts (#925). */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const LF_ = 'components/LiqFeed.tsx';
const TEST = ['__tests__/liqFeedDedup.test.mts'];
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);

const M = [
  { name: 'L1 the backfill no longer seeds persistedKeysRef', f: LF_, from: "for (const r of data as Array<{ coin: string; side: string; price: number; source: string; ts: number }>) {\n            persistedKeysRef.current.add(`${r.ts}_${r.coin}_${r.price}_${r.side}_${r.source}`);\n          }\n          ", to: '', red: ['S2.'] },
  { name: 'L2 the batch filter drops the persisted-set check (only intra-batch dedup remains)', f: LF_, from: 'if (persistedKeysRef.current.has(key) || batchKeys.has(key)) return false;', to: 'if (batchKeys.has(key)) return false;', red: ['S4.'] },
  { name: 'L3 the batch filter drops the intra-batch check (only persisted-set dedup remains)', f: LF_, from: 'if (persistedKeysRef.current.has(key) || batchKeys.has(key)) return false;', to: 'if (persistedKeysRef.current.has(key)) return false;', red: ['S4.'] },
  { name: 'L4 a key is marked persisted even when the insert errors', f: LF_, from: "if (error) { console.error('[liq] sb save failed:', error.message); return; }\n          // Only mark keys persisted once the insert actually succeeded, so a\n          // failed save is retried on the next tick rather than silently dropped.\n          for (const key of batchKeys) persistedKeysRef.current.add(key);", to: "for (const key of batchKeys) persistedKeysRef.current.add(key);\n          if (error) { console.error('[liq] sb save failed:', error.message); return; }", red: ['S5.'] },
  { name: 'L5 the empty-batch branch no longer advances the cursor', f: LF_, from: "if (toSave.length === 0) {\n          // Nothing new, but still advance the cursor so the range shrinks.\n          localStorage.setItem(SB_SAVE_TS_KEY, String(Date.now()));\n          return;\n        }", to: 'if (toSave.length === 0) return;', red: ['S6.'] },
  { name: 'L6 the ts boundary becomes < (an event exactly at lastTs is re-saved)', f: LF_, from: 'if (e.ts <= lastTs) return false;', to: 'if (e.ts < lastTs) return false;', red: ['S4.'] },
  { name: 'L7 the key template drops one field (price) in the backfill seed', f: LF_, first: true, from: '`${r.ts}_${r.coin}_${r.price}_${r.side}_${r.source}`', to: '`${r.ts}_${r.coin}_${r.side}_${r.source}`', red: ['S2.'] },
];

const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', LF_], { windowsHide: true });
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
  if (m.first ? n < 1 : n !== 1) { console.log(`SKIP    ${m.name}\n        anchor occurs ${n}x`); all = false; continue; }
  const at = src.indexOf(m.from);
  const out = src.slice(0, at) + m.to + src.slice(at + m.from.length);
  writeFileSync(`${ROOT}/${m.f}`, out);
  const r = run();
  revert();
  const missing = m.red.filter((k) => !r.failed.includes(k));
  const good = m.red.length === 0 ? true : (r.code !== 0 && missing.length === 0);
  if (!good) all = false;
  console.log(`${good ? 'OK    ' : 'WRONG '}  ${m.name}\n        want red: ${m.red.join(', ') || '(none, informational)'} | actually red: ${r.failed.join(', ') || '(none - suite stayed GREEN)'}${missing.length ? ` | NOT CAUGHT: ${missing.join(', ')}` : ''}`);
}
revert();
console.log(all ? '\nAll mutations behaved as designed.' : '\nA MUTATION DID NOT BEHAVE AS DESIGNED.');
