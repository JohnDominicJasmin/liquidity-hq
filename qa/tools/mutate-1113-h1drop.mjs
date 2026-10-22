/* Mutation check for the S2/S2b/S3/S3b changes in __tests__/pageHintRollout.test.mts (h1-drop, d4bf1cdf). */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const CALC = 'app/calc/page.tsx';
const ECON = 'app/econ-calendar/page.tsx';
const TEST = ['__tests__/pageHintRollout.test.mts'];
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);

const M = [
  { name: 'H1 calc old h1 (CALC_PAGE_TITLE) sneaks back in', f: CALC,
    from: "<PageHint pageKey=\"calc\" title={t('CALC_HINT_TITLE')} body={t('CALC_HINT_BODY')} />",
    to: "<PageHint pageKey=\"calc\" title={t('CALC_HINT_TITLE')} body={t('CALC_HINT_BODY')} />\n      <h1>{t('CALC_PAGE_TITLE')}</h1>",
    red: ['S2b.'] },
  { name: 'H2 econ old h1 (ECON_CALENDAR_TITLE) sneaks back in', f: ECON,
    from: "<PageHint pageKey=\"econ-calendar\" title={t('ECON_CALENDAR_HINT_TITLE')} body={t('ECON_CALENDAR_HINT_BODY')} />",
    to: "<PageHint pageKey=\"econ-calendar\" title={t('ECON_CALENDAR_HINT_TITLE')} body={t('ECON_CALENDAR_HINT_BODY')} />\n      <h1>{t('ECON_CALENDAR_TITLE')}</h1>",
    red: ['S3b.'] },
  { name: 'H3 econ source-credit reverts to the OLD (pre-h1-drop) padding/indent', f: ECON,
    from: "<div style={{ padding: '20px 0 16px', fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{source}</div>",
    to: "<div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{source}</div>",
    red: ['S3.'] },
  { name: 'H4 econ source-credit is deleted entirely', f: ECON,
    from: "      {source && (\n        <div style={{ padding: '20px 0 16px', fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{source}</div>\n      )}\n",
    to: '',
    red: ['S3.'] },
];

const FILES = [CALC, ECON];
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
