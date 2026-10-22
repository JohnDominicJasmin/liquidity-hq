const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const TEST = '__tests__/pageHintRollout.test.mts';
const SR = `<h1 className="sr-only">{t('CALC_PAGE_TITLE')}</h1>`;
const M = [
  { id: 'M1 heading made visible', file: 'app/calc/page.tsx', from: SR, to: `<h1>{t('CALC_PAGE_TITLE')}</h1>`, expect: ['S2b'] },
  { id: 'M2 visible title added beside the hidden heading', file: 'app/calc/page.tsx', from: SR, to: SR + `\n      <div className="ps-title">{t('CALC_PAGE_TITLE')}</div>`, expect: ['S2b'] },
  { id: 'M3 heading removed (the seo.spec failure)', file: 'app/calc/page.tsx', from: SR, to: '', expect: ['S2b'] },
  { id: 'M4 class renamed to one that hides nothing', file: 'app/calc/page.tsx', from: SR, to: `<h1 className="visually-hidden">{t('CALC_PAGE_TITLE')}</h1>`, expect: ['S2b'] },
  { id: 'M5 .sr-only loses its clip', file: 'app/globals.css', from: 'overflow: hidden; clip: rect(0,0,0,0);', to: 'overflow: hidden;', expect: ['S2c'] },
  { id: 'M6 .sr-only overridden elsewhere', file: 'app/globals.css', append: '\n[data-design="terminal"] .sr-only { position: static; width: auto; height: auto; }\n', expect: ['S2c'] },
  { id: 'M7 .sr-only width widened', file: 'app/globals.css', from: '.sr-only { position: absolute; width: 1px;', to: '.sr-only { position: absolute; width: 100px;', expect: ['S2c'] },
];
const run = () => {
  const r = spawnSync(process.execPath, ['--import', './qa/alias-register.mjs', '--test', TEST], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  return [...new Set([...(r.stdout + r.stderr).matchAll(/^✖ (S[\w-]+)\./gm)].map((m) => m[1]))].sort();
};
console.log('baseline failed:', JSON.stringify(run()));
let killed = 0;
for (const m of M) {
  const p = path.join(ROOT, m.file);
  const orig = fs.readFileSync(p, 'utf8');
  try {
    let next;
    if (m.append) next = orig + m.append;
    else { if (!orig.includes(m.from)) { console.log(m.id, '=> NOT APPLIED'); continue; } next = orig.replace(m.from, m.to); }
    fs.writeFileSync(p, next);
    const f = run();
    const ok = m.expect.every((e) => f.includes(e));
    if (ok) killed++;
    console.log(m.id, '=>', ok ? 'KILLED' : 'SURVIVED', JSON.stringify(f));
  } finally { execFileSync('git', ['checkout', '--', m.file], { cwd: ROOT }); }
}
console.log(`killed ${killed} of ${M.length}`);
console.log('tree after:', execFileSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' }).trim());
