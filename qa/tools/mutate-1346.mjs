/* Mutation check for __tests__/hypothesisTrackerEvidenceState.test.mts (#1342/#1346). */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const HT = 'components/HypothesisTracker.tsx';
const JSONF = 'lib/labelDefaults.en.json';
const KEYS = 'lib/labelKeys.ts';
const MIG = 'supabase/migrations/20260918a_labels_hypothesis_evidence_fetch_state.sql';
const TEST = ['__tests__/hypothesisTrackerEvidenceState.test.mts'];
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);

const M = [
  { name: 'H1 loading is set after the fetch starts, not before', f: HT, apply: (s) => {
      const a = "setEvidenceState(prev => ({ ...prev, [id]: { status: 'loading' } }));\n    let result:";
      const b = 'const res = await apiFetch(`/api/hypotheses/${id}/evidence`);\n';
      const at = s.indexOf(a);
      if (at < 0) throw new Error('anchor a');
      const loadLine = "setEvidenceState(prev => ({ ...prev, [id]: { status: 'loading' } }));\n    ";
      const rest = s.slice(at + loadLine.length);
      const bAt = rest.indexOf(b);
      if (bAt < 0) throw new Error('anchor b');
      // move the loading-set to just after the fetch call instead of before it
      const before = s.slice(0, at);
      const afterFetchIdx = at + loadLine.length + bAt + b.length;
      return before + rest.slice(0, bAt) + b + loadLine + s.slice(afterFetchIdx);
    }, red: ['S1.'] },
  { name: 'H2 a non-ok response is silently ignored (old behaviour)', f: HT, from: "if (!res.ok) {\n        result = { ok: false, message: t('HYPOTHESIS_TRACKER_EVIDENCE_ERROR') };\n      } else {\n        const json = await res.json() as { evidence?: Evidence[] };\n        result = { ok: true, data: json.evidence ?? [] };\n      }", to: "const json = await res.json() as { evidence?: Evidence[] };\n      result = { ok: true, data: json.evidence ?? [] };", red: ['S2.'] },
  { name: 'H3 a thrown error is not caught into an error state', f: HT, from: "} catch {\n      result = { ok: false, message: t('HYPOTHESIS_TRACKER_EVIDENCE_ERROR') };\n    }", to: '} catch { /* swallowed */ }', red: ['S3.'] },
  { name: 'H4 the success/error results bypass fetchStateFromResult', f: HT, from: 'setEvidenceState(prev => ({ ...prev, [id]: fetchStateFromResult(result) }));', to: "setEvidenceState(prev => ({ ...prev, [id]: result.ok ? { status: 'ready', data: result.data } : { status: 'error', message: result.message } }));", red: ['S4.'] },
  { name: 'H5 the error branch moves after the loading/ready check (unreachable)', f: HT, apply: (s) => {
      const errBlock = s.slice(s.indexOf("evState?.status === 'error' ? ("), s.indexOf("evState?.status !== 'ready' ? ("));
      const notReadyStart = s.indexOf("evState?.status !== 'ready' ? (");
      const notReadyEnd = s.indexOf('LoadingState message', notReadyStart);
      const notReadyBlock = s.slice(notReadyStart, s.indexOf(') : (', notReadyEnd) + ') : ('.length);
      if (!errBlock || !notReadyBlock) throw new Error('anchors');
      const start = s.indexOf(errBlock);
      return s.slice(0, start) + notReadyBlock + errBlock + s.slice(start + errBlock.length + notReadyBlock.length);
    }, red: ['S5.'] },
  { name: 'H6 the empty-state check reverts to a bare evList.length === 0', f: HT, from: '{isConfirmedEmpty(evState) ? (', to: '{evList.length === 0 ? (', red: ['S6.'] },
  { name: 'H7 evList reads data even from a non-ready state', f: HT, from: "const evList = evState?.status === 'ready' ? evState.data : [];", to: "const evList = (evState as { data?: Evidence[] })?.data ?? [];", red: ['S7.'] },
  { name: 'H8 deleteEvidence mutates regardless of status', f: HT, from: "setEvidenceState(prev => {\n        const cur = prev[hypothesisId];\n        if (cur?.status !== 'ready') return prev;\n        return { ...prev, [hypothesisId]: { status: 'ready', data: cur.data.filter(e => e.id !== evidenceId) } };\n      });", to: "setEvidenceState(prev => {\n        const cur = prev[hypothesisId];\n        const data = (cur as { data?: Evidence[] })?.data ?? [];\n        return { ...prev, [hypothesisId]: { status: 'ready', data: data.filter(e => e.id !== evidenceId) } };\n      });", red: ['S8.'] },
  { name: 'H9 fetchEvidence is called unconditionally on every expand', f: HT, from: 'if (!evidenceState[id]) await fetchEvidence(id);', to: 'await fetchEvidence(id);', red: ['S9.'] },
  { name: 'Z1 the LOADING default is reworded', f: JSONF, from: '"HYPOTHESIS_TRACKER_EVIDENCE_LOADING": "Loading evidence…"', to: '"HYPOTHESIS_TRACKER_EVIDENCE_LOADING": "Loading…"', red: ['L2.'] },
  { name: 'Z2 the key is dropped from labelKeys.ts', f: KEYS, from: "  'HYPOTHESIS_TRACKER_EVIDENCE_LOADING', 'HYPOTHESIS_TRACKER_EVIDENCE_ERROR',\n", to: '', red: ['L1.'] },
  { name: 'Z3 the migration live row drifts from the default', f: MIG, first: true, from: "'HYPOTHESIS_TRACKER_EVIDENCE_ERROR','en','Couldn''t load evidence.'", to: "'HYPOTHESIS_TRACKER_EVIDENCE_ERROR','en','Could not load evidence.'", red: ['L2.'] },
  { name: 'Z4 the commented dev row drifts from the live row', f: MIG, nth: 2, from: "'HYPOTHESIS_TRACKER_EVIDENCE_ERROR','en','Couldn''t load evidence.'", to: "'HYPOTHESIS_TRACKER_EVIDENCE_ERROR','en','Couldn''t load the evidence.'", red: ['L2.'] },
];

const FILES = [HT, JSONF, KEYS, MIG];
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
