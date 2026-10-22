/* Mutation check for __tests__/tradeJournalLoadError.test.mts and __tests__/grokChatAuthGate.test.mts (#1342). */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const TJ = 'components/TradeJournal.tsx';
const GC = 'components/GrokChat.tsx';
const JSONF = 'lib/labelDefaults.en.json';
const KEYS = 'lib/labelKeys.ts';
const MIG = 'supabase/migrations/20260927c_labels_trade_journal_load_error.sql';
const TEST = ['__tests__/tradeJournalLoadError.test.mts', '__tests__/grokChatAuthGate.test.mts'];
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);

const M = [
  { name: 'T1 the error branch also sets trades from the response', f: TJ, from: 'if (error) { setTradesError(true); setLoading(false); return; }', to: 'if (error) { setTradesError(true); setTrades((data ?? []) as Trade[]); setLoading(false); return; }', red: ['S1.'] },
  { name: 'T2 tradesError is never cleared before a new read', f: TJ, from: '    setTradesError(false);\n', to: '', red: ['S1.'] },
  { name: 'T3 the History error and empty blocks swap order', f: TJ, apply: (s) => {
      const a = s.indexOf('          {!loading && tradesError && (');
      const bStart = s.indexOf('          {!loading && !tradesError && trades.length === 0 && (');
      const bEnd = s.indexOf('\n          )}\n', bStart) + '\n          )}\n'.length;
      const aEnd = s.indexOf('\n          )}\n', a) + '\n          )}\n'.length;
      const blockA = s.slice(a, aEnd), blockB = s.slice(bStart, bEnd);
      if (a < 0 || bStart < 0 || bEnd <= bStart || aEnd <= a) throw new Error('anchors');
      return s.slice(0, a) + blockB + blockA + s.slice(bEnd);
    }, red: ['S3.'] },
  { name: 'T4 the History empty block no longer excludes tradesError', f: TJ, from: '{!loading && !tradesError && trades.length === 0 && (', to: '{!loading && trades.length === 0 && (', red: ['S3.'] },
  { name: 'T5 the History retry button stops calling loadTrades', f: TJ, first: true, from: 'onClick={loadTrades}', to: 'onClick={() => {}}', red: ['S4.'] },
  { name: 'T5b the Stats retry button stops calling loadTrades (second occurrence)', f: TJ, nth: 2, from: 'onClick={loadTrades}', to: 'onClick={() => {}}', red: ['S6.'] },
  { name: 'T6 the Stats tab drops the tradesError branch entirely', f: TJ, from: 'tradesError ? (\n            <div className="tj-empty-state">\n              {t(\'TRADE_JOURNAL_HISTORY_LOAD_FAILED\')}{\' \'}\n              <button\n                onClick={loadTrades}\n                style={{ fontSize: \'var(--fs-caption)\', color: \'var(--txt3)\', background: \'transparent\', border: \'0.5px solid var(--bdr)\', borderRadius: 4, padding: \'3px 8px\', cursor: \'pointer\' }}\n              >\n                {t(\'TRADE_JOURNAL_HISTORY_LOAD_RETRY\')}\n              </button>\n            </div>\n          ) : ', to: '', red: ['S5.', 'S6.'] },
  { name: 'G1 authLoading is dropped from the useAuth destructure (back to just user)', f: GC, from: 'const { user, loading: authLoading } = useAuth();', to: 'const { user } = useAuth();', red: ['S1.'] },
  { name: 'G2 sendMsg checks !user before authLoading (the pre-fix order)', f: GC, from:
      '    if (authLoading) return;\n    if (!user) {\n      setOpen(true);\n      setShowLoginModal(true);\n      return;\n    }\n',
    to:
      '    if (!user) {\n      setOpen(true);\n      setShowLoginModal(true);\n      return;\n    }\n    if (authLoading) return;\n',
    red: ['S2.'] },
  { name: 'G3 sendMsg no longer no-ops on authLoading (falls through)', f: GC, from: 'if (authLoading) return;\n', to: '', red: ['S2.', 'S3.'] },
  { name: 'G4 authLoading dropped from the useCallback deps', f: GC, from: 'geoEvents, user, authLoading, usage', to: 'geoEvents, user, usage', red: ['S4.'] },
  { name: 'G5 the header ternary stops checking authLoading first (falls to the user branch)', f: GC, from: '{authLoading ? (\n                    <span className="login-spinner" aria-label="Loading" />\n                  ) : user ? (', to: '{user ? (', red: ['S5.', 'S6.'] },
  { name: 'Z1 the failed-load default is reworded', f: JSONF, from: "\"TRADE_JOURNAL_HISTORY_LOAD_FAILED\": \"Couldn't load your trades - this doesn't mean they're gone.\"", to: '"TRADE_JOURNAL_HISTORY_LOAD_FAILED": "Could not load trades."', red: ['L2.'] },
  { name: 'Z2 the key is dropped from labelKeys.ts', f: KEYS, from: "  'TRADE_JOURNAL_HISTORY_LOAD_FAILED', 'TRADE_JOURNAL_HISTORY_LOAD_RETRY',\n", to: '', red: ['L1.'] },
  { name: 'Z3 the migration live row drifts from the default', f: MIG, first: true, from: "'Try again'", to: "'Try once more'", red: ['L2.'] },
  { name: 'Z4 the commented dev row is missing', f: MIG, from: "-- ('TRADE_JOURNAL_HISTORY_LOAD_RETRY','en','Try again')\n", to: '', red: ['L2.'] },
];

const FILES = [TJ, GC, JSONF, KEYS, MIG];
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
  const good = m.red.length === 0 ? true : (r.code !== 0 && missing.length === 0);
  if (!good) all = false;
  console.log(`${good ? 'OK    ' : 'WRONG '}  ${m.name}\n        want red: ${m.red.join(', ') || '(none, informational)'} | actually red: ${r.failed.join(', ') || '(none - suite stayed GREEN)'}${missing.length ? ` | NOT CAUGHT: ${missing.join(', ')}` : ''}`);
}
revert();
console.log(all ? '\nAll mutations behaved as designed.' : '\nA MUTATION DID NOT BEHAVE AS DESIGNED.');
