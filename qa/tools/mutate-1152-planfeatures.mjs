/* Mutation check for __tests__/planFeaturesSingleSource.test.mts (#1152). */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const PF = 'lib/planFeatures.ts';
const DICT = 'lib/i18n/dictionaries.ts';
const DEFAULTS = 'lib/labelDefaults.en.json';
const KEYS = 'lib/labelKeys.ts';
const UPGRADE = 'app/upgrade/page.tsx';
const LANDING = 'components/LandingTerminal.tsx';
const TEST = ['__tests__/planFeaturesSingleSource.test.mts'];
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);

const M = [
  { name: 'M1 a row is dropped from the dict (ko loses aiChat)', f: DICT,
    from: "aiChat: '일일 AI 채팅 {chat}회',", to: '', red: ['P3a', 'P3c'] },
  { name: 'M2 an orphan key is added to a dict locale (zh)', f: DICT,
    from: "priceAlerts: '价格提醒',", to: "priceAlerts: '价格提醒',\n        orphanRow: '幽灵行',", red: ['P3c'] },
  { name: 'M3 English dict text reworded, drifts from labelDefaults.en', f: DICT,
    from: "dashboard: 'Dashboard + market overview',", to: "dashboard: 'Dashboard + live market overview',", red: ['P3b'] },
  { name: 'M4 a row\'s labelKey typo\'d (would render the raw key on /upgrade)', f: PF,
    from: "{ id: 'news',       labelKey: 'UPGRADE_FREE_FEATURE_NEWS',        included: true },",
    to: "{ id: 'news',       labelKey: 'UPGRADE_FREE_FEATURE_NEWSS',        included: true },",
    red: ['P4', 'P3b'] },
  { name: 'M5 aiAnalyses vars silently detached from AI_LIMITS.free (hand-typed instead)', f: PF,
    from: "{ id: 'aiAnalyses', labelKey: 'UPGRADE_FREE_FEATURE_AI_ANALYSES', vars: { quick: F.quick, deep: F.deep }, included: true },",
    to: "{ id: 'aiAnalyses', labelKey: 'UPGRADE_FREE_FEATURE_AI_ANALYSES', vars: { quick: 999, deep: F.deep }, included: true },",
    red: ['P5'] },
  { name: 'M6 an excluded row gains vars it should not have', f: PF,
    from: "{ id: 'telegram',   labelKey: 'UPGRADE_FREE_EXCL_TELEGRAM',       included: false },",
    to: "{ id: 'telegram',   labelKey: 'UPGRADE_FREE_EXCL_TELEGRAM',       vars: { x: 1 }, included: false },",
    red: ['P2'] },
  { name: 'M7 a row is reordered (aiIncluded and aiAnalyses swap)', f: PF,
    from: "{ id: 'aiIncluded', labelKey: 'UPGRADE_FREE_FEATURE_AI_INCLUDED', included: true },\n  { id: 'aiAnalyses', labelKey: 'UPGRADE_FREE_FEATURE_AI_ANALYSES', vars: { quick: F.quick, deep: F.deep }, included: true },",
    to: "{ id: 'aiAnalyses', labelKey: 'UPGRADE_FREE_FEATURE_AI_ANALYSES', vars: { quick: F.quick, deep: F.deep }, included: true },\n  { id: 'aiIncluded', labelKey: 'UPGRADE_FREE_FEATURE_AI_INCLUDED', included: true },",
    red: ['P1'] },
  // M8 retired: its anchor (`const P = AI_LIMITS.pro...`) was removed from app/upgrade/page.tsx by the PRO
  // consolidation commit (28a1d8d5) - AI_LIMITS isn't imported there at all any more. The equivalent
  // regression risk (a re-hardcoded local list) is covered by mutate-1152-pro.mjs's M7 with a current anchor.
  { name: 'M9 LandingTerminal reverts to mapping dict.pricing.free.features as an array', f: LANDING,
    from: '{FREE_PLAN_FEATURES.map((row) => (',
    to: '{dict.pricing.free.features.map((row) => (',
    red: ['P7'] },
];

const FILES = [PF, DICT, DEFAULTS, KEYS, UPGRADE, LANDING];
const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', ...FILES], { windowsHide: true });
const run = () => {
  let out = '', code = 0;
  try { out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', ...TEST], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 15_000 }); }
  catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status ?? 1; }
  const failed = [...new Set([...out.matchAll(/^\s*\u2716 (.+?) \(/gm)].map((x) => x[1]))];
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
  const missing = m.red.filter((want) => !r.failed.some((f) => f.includes(want)));
  const good = r.code !== 0 && missing.length === 0;
  if (!good) all = false;
  console.log(`${good ? 'OK    ' : 'WRONG '}  ${m.name}\n        want red matching: ${m.red.join(', ')} | actually red: ${r.failed.join(' | ') || '(none - suite stayed GREEN)'}`);
}
revert();
console.log(all ? '\nAll mutations behaved as designed.' : '\nA MUTATION DID NOT BEHAVE AS DESIGNED.');
