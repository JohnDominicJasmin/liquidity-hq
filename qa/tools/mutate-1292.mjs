/* Mutation check for __tests__/settingsConflictNotice.test.mts (#1285/#1292). */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const SP = 'components/SettingsProvider.tsx';
const ST = 'components/SettingsSaveToast.tsx';
const SL = 'lib/settings.ts';
const CSS = 'app/globals.css';
const JSONF = 'lib/labelDefaults.en.json';
const KEYS = 'lib/labelKeys.ts';
const MIG = 'supabase/migrations/20260913a_labels_seed_settings_conflict.sql';
const TEST = ['__tests__/settingsConflictNotice.test.mts'];
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);

const M = [
  { name: 'P1 the success branch always sets conflict, never saved', f: SP, from: "setSaveStatus(result.rejected.length > 0 ? 'conflict' : 'saved');", to: "setSaveStatus('conflict');", red: ['S2.'] },
  { name: 'P2 the success branch sets error instead of conflict (the old bug)', f: SP, from: "setSaveStatus(result.rejected.length > 0 ? 'conflict' : 'saved');", to: "setSaveStatus(result.rejected.length > 0 ? 'error' : 'saved');", red: ['S2.'] },
  { name: 'P3 the clear-timeout no longer matches the conflict/error split', f: SP, from: "setTimeout(() => setSaveStatus('idle'), result.rejected.length > 0 ? 3000 : 2000);", to: "setTimeout(() => setSaveStatus('idle'), 2000);", red: ['S3.'] },
  { name: 'T1 the toast no longer becomes visible for conflict', f: ST, from: "if (saveStatus === 'saved' || saveStatus === 'error' || saveStatus === 'conflict') {", to: "if (saveStatus === 'saved' || saveStatus === 'error') {", red: ['S4.'] },
  { name: 'T2 the toast hide-timer reverts to a flat 2000ms', f: ST, from: "setTimeout(() => setVisible(false), saveStatus === 'saved' ? 2000 : 3000);", to: 'setTimeout(() => setVisible(false), 2000);', red: ['S5.'] },
  { name: 'T3 the FAB-hiding effect also keys on saveStatus (drift risk)', f: ST, from: "}, [visible]);", to: '}, [visible, saveStatus]);', red: ['S6.'] },
  { name: 'T4 conflict shares the error class', f: ST, from: "const cls = saveStatus === 'error' ? ' error' : saveStatus === 'conflict' ? ' conflict' : saveStatus === 'saving' ? ' saving' : '';", to: "const cls = saveStatus === 'error' ? ' error' : saveStatus === 'saving' ? ' saving' : '';", red: ['S7.'] },
  { name: 'T5 conflict falls through to the FAILED text', f: ST, from: "const text = saveStatus === 'saving' ? t('SETTINGS_STATUS_SAVING')\n    : saveStatus === 'saved' ? t('SETTINGS_STATUS_SAVED')\n    : saveStatus === 'conflict' ? t('SETTINGS_STATUS_CONFLICT')\n    : t('SETTINGS_STATUS_FAILED');", to: "const text = saveStatus === 'saving' ? t('SETTINGS_STATUS_SAVING')\n    : saveStatus === 'saved' ? t('SETTINGS_STATUS_SAVED')\n    : t('SETTINGS_STATUS_FAILED');", red: ['S8.'] },
  { name: 'C1 the conflict rule uses the red tokens instead of amber', f: CSS, from: '.st-save-toast.conflict { background: var(--amber-bg); border-color: var(--amber-bdr); color: var(--amber); }', to: '.st-save-toast.conflict { background: rgba(248,113,113,0.15); border-color: rgba(248,113,113,0.4); color: var(--red); }', red: ['S9.'] },
  { name: 'C2 the FAB-hiding rule drops pointer-events', f: CSS, from: 'body.settings-toast-open .gchat-fab { opacity: 0; pointer-events: none; }', to: 'body.settings-toast-open .gchat-fab { opacity: 0; }', red: ['S10.'] },
  { name: 'Z1 the conflict default is reworded to match FAILED', f: JSONF, from: '"SETTINGS_STATUS_CONFLICT": "Updated from another device"', to: '"SETTINGS_STATUS_CONFLICT": "Couldn\'t save - try again"', red: ['L1.'] },
  { name: 'Z2 the key is dropped from labelKeys.ts', f: KEYS, from: "  'SETTINGS_STATUS_CONFLICT',\n", to: '', red: ['L1.'] },
  { name: 'Z3 the migration row drifts from the default', f: MIG, from: "('SETTINGS_STATUS_CONFLICT','en','Updated from another device')", to: "('SETTINGS_STATUS_CONFLICT','en','Updated elsewhere')", red: ['L2.'] },
];

const FILES = [SP, ST, SL, CSS, JSONF, KEYS, MIG];
const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', ...FILES], { windowsHide: true });
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
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
let all = true;
for (const m of M) {
  if (ONLY.length && !ONLY.includes(m.name.split(' ')[0])) continue;
  const src = readFileSync(`${ROOT}/${m.f}`, 'utf8').split(CR + LF).join(LF);
  const n = src.split(m.from).length - 1;
  if (n !== 1) { console.log(`SKIP    ${m.name}\n        anchor occurs ${n}x`); all = false; continue; }
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
