/* Mutation check for __tests__/cancelPanelButtons.test.mts (run on the branch that holds #1439's CSS and the dated confirm). */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const CSS = 'app/globals.css';
const PAGE = 'app/settings/page.tsx';
const JSONF = 'lib/labelDefaults.en.json';
const KEYS = 'lib/labelKeys.ts';
const MIG = 'supabase/migrations/20260926a_labels_subscription_cancel.sql';
const VIEW = 'lib/subscriptionPanel.ts';
const TEST = '__tests__/cancelPanelButtons.test.mts';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
const DATED_ROW = "('SETTINGS_SUB_CANCEL_CONFIRM_DATED','en','Cancel Pro? You''ll keep access until {date}.')";

const M = [
  { name: 'H1 "Yes, cancel" loses the shared class', f: PAGE, from: 'className="st-confirm-btn st-signout-btn"', to: 'className="st-signout-btn"', red: ['G1.'] },
  { name: 'H2 "Keep Pro" loses the shared class', f: PAGE, from: 'className="st-confirm-btn st-save-btn"', to: 'className="st-save-btn"', red: ['G1.'] },
  { name: 'H3 "Keep Pro" gets an inline width', f: PAGE, from: 'className="st-confirm-btn st-save-btn" disabled', to: 'className="st-confirm-btn st-save-btn" style={{ width: 120 }} disabled', red: ['G1.'] },
  { name: 'H4 "Yes, cancel" is no longer the red class', f: PAGE, from: 'className="st-confirm-btn st-signout-btn"', to: 'className="st-confirm-btn st-save-btn"', red: ['G1.'] },
  { name: 'H5 the buttons leave the flex row', f: PAGE, from: "<div style={{ display: 'flex', gap: 8, marginTop: 8 }}>", to: "<div style={{ display: 'grid', gap: 8, marginTop: 8 }}>", red: ['G2.'] },
  { name: 'H6 the touch target shrinks to 40px', f: CSS, from: '  min-height: 44px;\n  min-width: 128px;', to: '  min-height: 40px;\n  min-width: 128px;', red: ['G3.'] },
  { name: 'H7 the margin-top reset is removed', f: CSS, from: '.st-confirm-btn {\n  margin-top: 0;\n', to: '.st-confirm-btn {\n', red: ['G3.'] },
  { name: 'H8 the shared rule sets a width', f: CSS, from: '  min-height: 44px;\n  min-width: 128px;', to: '  min-height: 44px;\n  min-width: 128px;\n  width: 140px;', red: ['G3.'] },
  { name: 'H9 the shared min-width is dropped', f: CSS, from: '  min-width: 128px;\n', to: '', red: ['G3.'] },
  { name: 'H10 the shared rule moves ABOVE the colour rules', f: CSS, apply: (s) => {
      const a = s.indexOf('.st-confirm-btn {\n');
      const b = s.indexOf('}\n', a) + 2;
      const block = s.slice(a, b);
      const without = s.slice(0, a) + s.slice(b);
      const at = without.indexOf('/* Password save */');
      if (a < 0 || at < 0) throw new Error('anchors');
      return without.slice(0, at) + block + without.slice(at);
    }, red: ['G4.'] },
  { name: 'H11 a phone-width rule resizes one colour class', f: CSS, apply: (s) => s + '\n@media (max-width: 480px) { .st-save-btn { width: 100%; } }\n', red: ['G5.'] },
  { name: 'H12 a compound selector re-adds the margin', f: CSS, apply: (s) => s + '\n.st-section .st-signout-btn { margin-top: 12px; }\n', red: ['G5.'] },
  { name: 'H13 the light-theme red is too pale', f: CSS, from: '  color: #A81818;', to: '  color: #E0A0A0;', red: ['G8.'] },
  { name: 'H14 the purple button text is too pale', f: CSS, from: 'color: var(--accent-2); font-size: var(--fs-caption); font-weight: 600; cursor: pointer;', to: 'color: #9bb5d9; font-size: var(--fs-caption); font-weight: 600; cursor: pointer;', red: ['G8.'] },
  { name: 'H15 the light settings card stops being white', f: CSS, from: '[data-theme="light"] .st-section { background: #fff; }', to: '[data-theme="light"] .st-section { background: #E8EAED; }', red: ['G8.'] },
  { name: 'H16 the shared class is renamed in the stylesheet only', f: CSS, from: '.st-confirm-btn {\n  margin-top: 0;', to: '.st-confirm-btnx {\n  margin-top: 0;', red: ['G3.', 'G4.'] },
  // ── the dated confirm sentence
  { name: 'H17 the date test is negated (the two sentences swap)', f: PAGE, from: '{subView.untilDate\n                        ? t(\'SETTINGS_SUB_CANCEL_CONFIRM_DATED\'', to: '{!subView.untilDate\n                        ? t(\'SETTINGS_SUB_CANCEL_CONFIRM_DATED\'', red: ['G9.'] },
  { name: 'H18 the dated branch asks for the dateless sentence', f: PAGE, from: "t('SETTINGS_SUB_CANCEL_CONFIRM_DATED', {", to: "t('SETTINGS_SUB_CANCEL_CONFIRM', {", red: ['G9.', 'G10.'] },
  { name: 'H19 the date is printed in a different format', f: PAGE, from: "t('SETTINGS_SUB_CANCEL_CONFIRM_DATED', { date: new Date(subView.untilDate).toLocaleDateString() })", to: "t('SETTINGS_SUB_CANCEL_CONFIRM_DATED', { date: new Date(subView.untilDate).toDateString() })", red: ['G10.'] },
  { name: 'H20 the placeholder is renamed in the default', f: JSONF, from: 'keep access until {date}."', to: 'keep access until {when}."', red: ['G11.', 'G12.', 'G13.'] },
  { name: 'H21 the sentence is reworded in the default', f: JSONF, from: '"SETTINGS_SUB_CANCEL_CONFIRM_DATED": "Cancel Pro?', to: '"SETTINGS_SUB_CANCEL_CONFIRM_DATED": "Cancel?', red: ['G11.', 'G13.'] },
  { name: 'H22 the live migration row drifts', f: MIG, nth: 1, from: DATED_ROW, to: DATED_ROW.replace('{date}.', '{date}!'), red: ['G13.'] },
  { name: 'H23 the commented dev row drifts', f: MIG, nth: 2, from: "'Cancel Pro? You''ll keep access until {date}.')", to: "'Cancel Pro? You''ll keep access till {date}.')", red: ['G13.'] },
  { name: 'H24 the key is not registered', f: KEYS, from: "'SETTINGS_SUB_CANCEL_CONFIRM_DATED', ", to: '', red: ['G13.'] },
  { name: 'H25 the view no longer carries the date', f: VIEW, from: "return { kind: 'cancellable', untilDate: futureDateOrNull(sub.currentPeriodEnd, nowMs) };", to: "return { kind: 'cancellable', untilDate: null };", red: ['G14.'] },
  { name: 'H26 the view passes a past date through', f: VIEW, from: "return { kind: 'cancellable', untilDate: futureDateOrNull(sub.currentPeriodEnd, nowMs) };", to: "return { kind: 'cancellable', untilDate: sub.currentPeriodEnd };", red: ['G14.'] },
  { name: 'H27 the dateless fallback is reworded', f: JSONF, from: '"SETTINGS_SUB_CANCEL_CONFIRM": "Cancel Pro?', to: '"SETTINGS_SUB_CANCEL_CONFIRM": "Cancel your plan?', red: ['G11.'] },
  { name: 'H28 the commented dev row is missing', f: MIG, from: "-- ('SETTINGS_SUB_CANCEL_CONFIRM_DATED','en','Cancel Pro? You''ll keep access until {date}.'),\n", to: '', red: ['G13.'] },
];

const FILES = [CSS, PAGE, JSONF, KEYS, MIG, VIEW];
const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', ...FILES], { windowsHide: true });
const keyOf = (n) => n.split(' ')[0];
const run = () => {
  let out = '', code = 0;
  try { out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', TEST], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120_000 }); }
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
  let out;
  try {
    if (m.apply) out = m.apply(src);
    else {
      const n = src.split(m.from).length - 1;
      const need = m.nth ?? 1;
      if (m.nth ? n < need : n !== 1) { console.log(`SKIP    ${m.name}\n        anchor occurs ${n}x`); all = false; continue; }
      let at = -1;
      for (let i = 0; i < need; i++) at = src.indexOf(m.from, at + 1);
      out = src.slice(0, at) + m.to + src.slice(at + m.from.length);
    }
  } catch (e) { console.log(`SKIP    ${m.name}\n        ${e.message}`); all = false; continue; }
  if (out === src) { console.log(`SKIP    ${m.name}\n        mutation changed nothing`); all = false; continue; }
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
