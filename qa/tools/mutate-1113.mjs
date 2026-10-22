/* Mutation check for __tests__/pageHintReplay.test.mts (#1113 option 4). */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const PH = 'components/PageHint.tsx';
const JSONF = 'lib/labelDefaults.en.json';
const KEYS = 'lib/labelKeys.ts';
const MIG = 'supabase/migrations/20260927d_labels_page_hint_replay.sql';
const TEST = ['__tests__/pageHintReplay.test.mts'];
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);

const M = [
  { name: 'H1 the state type reverts to the old hide value', f: PH, from: "useState<'pending' | 'show' | 'collapsed'>('pending')", to: "useState<'pending' | 'show' | 'hide'>('pending')", red: ['S1.'] },
  { name: 'H2 a returning visitor is shown again instead of collapsed (the seen-marker check inverted)', f: PH, from: "setState(localStorage.getItem(key) ? 'collapsed' : 'show');", to: "setState(localStorage.getItem(key) ? 'show' : 'collapsed');", red: ['S2.'] },
  { name: 'H3 a storage error falls back to collapsed instead of show', f: PH, from: "} catch {\n      setState('show');\n    }", to: "} catch {\n      setState('collapsed');\n    }", red: ['S2.'] },
  { name: 'H4 dismiss unmounts the hint again (the pre-fix regression)', f: PH, from: "function dismiss() {\n    try { localStorage.setItem(key, '1'); } catch {}\n    setState('collapsed');\n  }", to: "function dismiss() {\n    try { localStorage.setItem(key, '1'); } catch {}\n    setState('hide' as never);\n  }", red: ['S3.'] },
  { name: 'H5 dismiss forgets to set the seen-marker', f: PH, from: "try { localStorage.setItem(key, '1'); } catch {}\n    setState('collapsed');", to: "setState('collapsed');", red: ['S3.'] },
  { name: 'H6 reopen also clears the seen-marker (so a reload would show the full banner again unprompted)', f: PH, from: 'function reopen() {', to: "function reopen() {\n    try { localStorage.removeItem(key); } catch {}", red: ['S4.'] },
  { name: 'H7 collapsed goes back to returning null (the exact pre-fix regression)', f: PH, apply: (s) => {
      const a = s.indexOf("if (state === 'collapsed') {");
      const b = s.indexOf("\n  }\n\n  return (", a);
      if (a < 0 || b < 0) throw new Error('anchors');
      return s.slice(0, a) + "if (state === 'collapsed') { return null; }" + s.slice(b + "\n  }".length);
    }, red: ['S5.'] },
  { name: 'H8 the collapsed chip loses its onClick handler', f: PH, from: 'onClick={reopen}', to: '', red: ['S5.'] },
  { name: 'H9 the collapsed chip loses its aria-label', f: PH, from: "aria-label={t('PAGE_HINT_REPLAY_LABEL')}", to: '', red: ['S5.'] },
  { name: 'H10 the collapsed chip shrinks below the 24px tap target', f: PH, apply: (s) => {
      const a = s.indexOf("if (state === 'collapsed') {");
      const b = s.indexOf("\n  }\n\n  return (", a);
      if (a < 0 || b < 0) throw new Error('anchors');
      const block = s.slice(a, b);
      const n = block.split('minHeight: 24,').length - 1;
      if (n !== 1) throw new Error('anchor x' + n + ' inside collapsed block');
      const mutated = block.replace('minHeight: 24,', 'minHeight: 18,');
      return s.slice(0, a) + mutated + s.slice(b);
    }, red: ['S6.'] },
  { name: 'H11 the collapsed chip drops its visible text (aria-label only)', f: PH, from: "        <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: 'var(--accent)', background: 'var(--accent-bg)', borderRadius: '50%', width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>?</span>\n        {t('PAGE_HINT_REPLAY_LABEL')}", to: "        <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: 'var(--accent)', background: 'var(--accent-bg)', borderRadius: '50%', width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>?</span>", red: ['S6.'] },
  { name: 'H12 the collapsed check moves after the final return (becomes unreachable dead code)', f: PH, apply: (s) => {
      const collapsedStart = s.indexOf("  if (state === 'collapsed') {");
      const collapsedEnd = s.indexOf("\n  }\n\n  return (", collapsedStart) + "\n  }\n".length;
      const block = s.slice(collapsedStart, collapsedEnd);
      const without = s.slice(0, collapsedStart) + s.slice(collapsedEnd);
      const returnAt = without.lastIndexOf('\n  return (');
      const closeAt = without.indexOf('\n}', returnAt);
      if (collapsedStart < 0 || returnAt < 0 || closeAt < 0) throw new Error('anchors');
      return without.slice(0, closeAt) + '\n' + block + without.slice(closeAt);
    }, red: ['S7.'] },
  { name: 'Z1 the replay label default is reworded', f: JSONF, from: '"PAGE_HINT_REPLAY_LABEL": "How this page works"', to: '"PAGE_HINT_REPLAY_LABEL": "Show help"', red: ['L2.'] },
  { name: 'Z2 the key is dropped from labelKeys.ts', f: KEYS, from: "'PAGE_HINT_DISMISS_LABEL', 'PAGE_HINT_REPLAY_LABEL',", to: "'PAGE_HINT_DISMISS_LABEL',", red: ['L1.'] },
  { name: 'Z3 the migration live row drifts from the default', f: MIG, first: true, from: "'PAGE_HINT_REPLAY_LABEL','en','How this page works'", to: "'PAGE_HINT_REPLAY_LABEL','en','How this works'", red: ['L2.'] },
  { name: 'Z4 the commented dev row drifts from the live row', f: MIG, nth: 2, from: "'PAGE_HINT_REPLAY_LABEL','en','How this page works'", to: "'PAGE_HINT_REPLAY_LABEL','en','How this page functions'", red: ['L2.'] },
];

const FILES = [PH, JSONF, KEYS, MIG];
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
  let out;
  try {
    if (m.apply) out = m.apply(src);
    else {
      const n = src.split(m.from).length - 1;
      const need = m.nth ?? 1;
      if (m.first ? n < 1 : m.nth ? n < need : n !== 1) { console.log(`SKIP    ${m.name}\n        anchor occurs ${n}x`); all = false; continue; }
      let at = -1;
      for (let i = 0; i < (m.first ? 1 : need); i++) at = src.indexOf(m.from, at + 1);
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
