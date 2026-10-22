/* Mutation check for __tests__/pageHintRollout.test.mts (#1113 rollout). */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const NEWS = 'app/news/page.tsx';
const CALC = 'app/calc/page.tsx';
const ECON = 'app/econ-calendar/page.tsx';
const TOUR = 'components/SpotlightTour.tsx';
const JSONF = 'lib/labelDefaults.en.json';
const KEYS = 'lib/labelKeys.ts';
const MIG = 'supabase/migrations/20260928a_labels_page_hint_rollout.sql';
const TEST = ['__tests__/pageHintRollout.test.mts'];
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);

const M = [
  { name: 'H1 news PageHint drops its pageKey', f: NEWS, from: '<PageHint pageKey="news" title={t(\'NEWS_HINT_TITLE\')} body={t(\'NEWS_HINT_BODY\')} />', to: '<PageHint title={t(\'NEWS_HINT_TITLE\')} body={t(\'NEWS_HINT_BODY\')} />', red: ['S1.'] },
  { name: 'H2 news PageHint is not the first thing in the wrapper (something inserted ahead of it)', f: NEWS, apply: (s) => {
      const at = s.indexOf('<div className="news-term-wrap">');
      if (at < 0) throw new Error('anchor');
      const insertAt = at + '<div className="news-term-wrap">'.length;
      return s.slice(0, insertAt) + '\n      <div style={{ height: 1 }} />' + ' '.repeat(220) + s.slice(insertAt);
    }, red: ['S1.'] },
  { name: 'H3 calc drops PageHint but the subtitle stays removed (partial revert)', f: CALC, from: '<PageHint pageKey="calc" title={t(\'CALC_HINT_TITLE\')} body={t(\'CALC_HINT_BODY\')} />\n', to: '', red: ['S2.'] },
  // H4 retired: it targeted the old h1, which d4bf1cdf deleted outright (there is no longer an h1 to hang a
  // reintroduced subtitle off). The equivalent regression risk (old copy sneaking back in) is now covered by
  // mutate-1113-h1drop.mjs's H1 (CALC_PAGE_TITLE) directly.
  { name: 'H5 econ-calendar loses its PageHint', f: ECON, from: '<PageHint pageKey="econ-calendar" title={t(\'ECON_CALENDAR_HINT_TITLE\')} body={t(\'ECON_CALENDAR_HINT_BODY\')} />\n', to: '', red: ['S3.'] },
  { name: 'H6 econ-calendar\'s standalone source credit is deleted along with the subtitle', f: ECON, from: "      {source && (\n        <div style={{ padding: '20px 0 16px', fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{source}</div>\n      )}\n", to: '', red: ['S3.'] },
  { name: 'H7 a retired STEP2 tag reappears in STEPS', f: TOUR, from: "  {\n    tagKey:   'SPOTLIGHT_TOUR_STEP5_TAG',", to: "  {\n    tagKey:   'SPOTLIGHT_TOUR_STEP2_TAG',\n    titleKey: 'x', bodyKey: 'x', Visual: Step1Visual,\n  },\n  {\n    tagKey:   'SPOTLIGHT_TOUR_STEP5_TAG',", red: ['S4.'] },
  { name: 'H8 isLast reverts to a hard-coded index', f: TOUR, from: 'const isLast  = step === STEPS.length - 1;', to: 'const isLast  = step === 1;', red: ['S5.'] },
  { name: 'H9 finish stops routing to Arena', f: TOUR, from: "if (isLast) {\n      close();\n      router.push('/arena');\n      return;\n    }", to: 'if (isLast) {\n      close();\n      return;\n    }', red: ['S6.'] },
  { name: 'H10 Step3Visual is left behind as dead code', f: TOUR, from: '/* ── Step 5 visual: animated arena chart mockup ── */', to: "function Step3Visual() { return null as never; }\n/* ── Step 5 visual: animated arena chart mockup ── */", red: ['S7.'] },
  { name: 'Z1 a hint default is reworded', f: JSONF, from: '"NEWS_HINT_TITLE": "News"', to: '"NEWS_HINT_TITLE": "Headlines"', red: ['L2.'] },
  { name: 'Z2 a key is dropped from labelKeys.ts', f: KEYS, from: "'PLAYBOOK_HINT_TITLE', 'PLAYBOOK_HINT_BODY',", to: '', red: ['L1.'] },
  { name: 'Z3 the migration live row drifts from the default', f: MIG, first: true, from: "('DASHBOARD_HINT_TITLE','en','Dashboard')", to: "('DASHBOARD_HINT_TITLE','en','Home')", red: ['L2.'] },
  { name: 'Z4 the commented dev row drifts from the live row', f: MIG, nth: 2, from: "('DASHBOARD_HINT_TITLE','en','Dashboard')", to: "('DASHBOARD_HINT_TITLE','en','Overview')", red: ['L2.'] },
];

const FILES = [NEWS, CALC, ECON, TOUR, JSONF, KEYS, MIG];
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
