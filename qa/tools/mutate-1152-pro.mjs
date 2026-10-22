/* Mutation check for the PRO additions in __tests__/planFeaturesSingleSource.test.mts (#1152). */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const PF = 'lib/planFeatures.ts';
const DICT = 'lib/i18n/dictionaries.ts';
const UPGRADE = 'app/upgrade/page.tsx';
const LANDING = 'components/LandingTerminal.tsx';
const TEST = ['__tests__/planFeaturesSingleSource.test.mts'];
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);

const M = [
  { name: 'M1 zh loses the toolPool dict row', f: DICT,
    from: "toolPool: '每日{tools}次AI工具调用(共享额度)',", to: '', red: ['P3apro', 'P3cpro'] },
  { name: 'M2 an orphan key added to ar Pro dict', f: DICT,
    from: "toolPool: '{tools} تشغيلًا لأدوات الذكاء الاصطناعي يوميًا (رصيد مشترك)',",
    to: "toolPool: '{tools} تشغيلًا لأدوات الذكاء الاصطناعي يوميًا (رصيد مشترك)',\n        orphanRow: 'صف شبح',", red: ['P3cpro'] },
  { name: 'M3 English Pro dict text reworded, drifts from labelDefaults.en', f: DICT,
    from: "everythingFree: 'Everything in Free',", to: "everythingFree: 'All of the Free plan',", red: ['P3bpro'] },
  { name: 'M4 toolPool var silently detached from AI_LIMITS.pro.toolPool (hand-typed)', f: PF,
    from: "{ id: 'toolPool',        labelKey: 'UPGRADE_PRO_FEATURE_TOOL_POOL',        vars: { tools: P.toolPool ?? 0 }, included: true },",
    to: "{ id: 'toolPool',        labelKey: 'UPGRADE_PRO_FEATURE_TOOL_POOL',        vars: { tools: 999 }, included: true },",
    red: ['P5pro'] },
  { name: 'M5 a Pro row gains included:false (breaks the "no excluded rows" premise)', f: PF,
    from: "{ id: 'telegram',        labelKey: 'UPGRADE_PRO_FEATURE_TELEGRAM',         included: true },",
    to: "{ id: 'telegram',        labelKey: 'UPGRADE_PRO_FEATURE_TELEGRAM',         included: false },",
    red: ['P0', 'P1pro', 'P0b'] },
  { name: 'M6 Pro rows reordered (telegram and unlimitedAlerts swap)', f: PF,
    from: "{ id: 'telegram',        labelKey: 'UPGRADE_PRO_FEATURE_TELEGRAM',         included: true },\n  { id: 'unlimitedAlerts', labelKey: 'UPGRADE_PRO_FEATURE_UNLIMITED_ALERTS', included: true },",
    to: "{ id: 'unlimitedAlerts', labelKey: 'UPGRADE_PRO_FEATURE_UNLIMITED_ALERTS', included: true },\n  { id: 'telegram',        labelKey: 'UPGRADE_PRO_FEATURE_TELEGRAM',         included: true },",
    red: ['P1pro'] },
  { name: 'M7 /upgrade re-hardcodes a local PRO_FEATURES list alongside the import', f: UPGRADE,
    from: "export default function UpgradePage() {",
    to: "const PRO_FEATURES: unknown[] = [];\nexport default function UpgradePage() {",
    red: ['P6'] },
  { name: 'M8 LandingTerminal reverts to mapping dict.pricing.pro.features as an array', f: LANDING,
    from: '{PRO_PLAN_FEATURES.map((row) => (',
    to: '{dict.pricing.pro.features.map((row) => (',
    red: ['P7'] },
];

const FILES = [PF, DICT, UPGRADE, LANDING];
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
