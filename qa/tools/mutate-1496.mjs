// Mutation check for __tests__/marketReadWaitsForInputs.test.mts and __tests__/aboutSubtitle.test.mts.
// Each mutation: exact-string replace (must match exactly once) or a git-show of the pre-fix file,
// run the named test file, list which tests went red, restore with `git checkout -- <file>`.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const WT = process.argv[2];
const only = process.argv[3];
const opts = { cwd: WT, encoding: 'utf8' };

const MR = '__tests__/marketReadWaitsForInputs.test.mts';
const AB = '__tests__/aboutSubtitle.test.mts';

const mutations = [
  { id: 'MR-prefix', test: MR, desc: 'the actual pre-fix code (merge 92c144aa first parent) for lib/marketRead.ts + components/MarketRead.tsx',
    show: [['92c144aa^1', 'lib/marketRead.ts'], ['92c144aa^1', 'components/MarketRead.tsx']] },
  { id: 'MR-score-ignores-pending', test: MR, desc: 'verdict computes while inputs are missing (score no longer gated on pending)',
    file: 'lib/marketRead.ts', from: 'const score = pending ? null : Math.min(', to: 'const score = Math.min(' },
  { id: 'MR-no-funding-check', test: MR, desc: 'funding never counted as missing',
    file: 'lib/marketRead.ts', from: "  if (coin?.fundingRate == null && manualFund == null) missing.push('funding');\n", to: '' },
  { id: 'MR-override-ignored', test: MR, desc: 'manual override no longer counts as the funding input',
    file: 'lib/marketRead.ts', from: 'if (coin?.fundingRate == null && manualFund == null)', to: 'if (coin?.fundingRate == null)' },
  { id: 'MR-fng-falsy', test: MR, desc: 'F&G missing-check made falsy (0 treated as missing)',
    file: 'lib/marketRead.ts', from: "if (store.fng == null) missing.push('fng');", to: "if (!store.fng) missing.push('fng');" },
  { id: 'MR-fng-cell-50', test: MR, desc: 'F&G cell shows the old invented 50',
    file: 'lib/marketRead.ts', from: 'sub: fng == null ? undefined : String(fng)', to: 'sub: String(fng ?? 50)' },
  { id: 'MR-score-bare', test: MR, desc: 'component renders read.score bare',
    file: 'components/MarketRead.tsx', from: "{read.score ?? '-'}<small>", to: '{read.score}<small>' },
  { id: 'AB-default-old', test: AB, desc: 'label default reverted to old wording',
    file: 'lib/labelDefaults.en.json', from: '"ABOUT_PAGE_SUBTITLE": "Liquidity Hunter HQ - crypto market analytics"', to: '"ABOUT_PAGE_SUBTITLE": "Liquidity Hunter HQ - crypto trading intelligence"' },
  { id: 'AB-migration-1char', test: AB, desc: 'migration en row (active) changed by one char',
    file: 'supabase/migrations/20261001e_labels_about_market_analytics.sql', from: "\n('ABOUT_PAGE_SUBTITLE','en','Liquidity Hunter HQ - crypto market analytics'),", to: "\n('ABOUT_PAGE_SUBTITLE','en','Liquidity Hunter HQ - crypto market analytic'),"  },
  { id: 'AB-ko-unchanged', test: AB, desc: 'ko row carried forward unchanged from 20260917a (prod and dev blocks)',
    file: 'supabase/migrations/20261001e_labels_about_market_analytics.sql', from: "\n('ABOUT_PAGE_SUBTITLE','ko','Liquidity Hunter HQ - 암호화폐 시장 분석'),", to: "\n('ABOUT_PAGE_SUBTITLE','ko','Liquidity Hunter HQ - 암호화폐 트레이딩 인텔리전스'),"  },
  { id: 'AB-dev-block-drift', test: AB, desc: 'commented dev block ru row differs from prod',
    file: 'supabase/migrations/20261001e_labels_about_market_analytics.sql', from: "-- ('ABOUT_PAGE_SUBTITLE','ru','Liquidity Hunter HQ - аналитика криптовалютного рынка')", to: "-- ('ABOUT_PAGE_SUBTITLE','ru','Liquidity Hunter HQ - аналитика криптовалютного рынкa')" },
  { id: 'AB-do-nothing', test: AB, desc: 'active conflict clause changed to do nothing',
    file: 'supabase/migrations/20261001e_labels_about_market_analytics.sql', from: "('ABOUT_PAGE_SUBTITLE','ru','Liquidity Hunter HQ - аналитика криптовалютного рынка')\non conflict (key, locale) do update set value = excluded.value, updated_at = now();", to: "('ABOUT_PAGE_SUBTITLE','ru','Liquidity Hunter HQ - аналитика криптовалютного рынка')\non conflict (key, locale) do nothing;" },
  { id: 'AB-page-hardcoded', test: AB, desc: 'About page hard-codes the subtitle',
    file: 'app/about/page.tsx', from: "{t('ABOUT_PAGE_SUBTITLE')}", to: 'Liquidity Hunter HQ - crypto market analytics' },
];

function run(testFile) {
  const r = spawnSync(process.execPath, ['--import', './qa/alias-register.mjs', '--test', testFile], { ...opts });
  const out = (r.stdout || '') + (r.stderr || '');
  const red = new Set();
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^✖ ([A-Z]\d+b?)\./);
    if (m) red.add(m[1]);
  }
  const pass = out.match(/ℹ pass (\d+)/)?.[1];
  const fail = out.match(/ℹ fail (\d+)/)?.[1];
  return { red: [...red], pass, fail };
}

for (const m of mutations) {
  if (only && m.id !== only) continue;
  const touched = [];
  try {
    if (m.show) {
      for (const [rev, path] of m.show) {
        const content = execFileSync('git', ['show', `${rev}:${path}`], { ...opts, maxBuffer: 1 << 26 });
        writeFileSync(`${WT}/${path}`, content);
        touched.push(path);
      }
    } else {
      const p = `${WT}/${m.file}`;
      const src = readFileSync(p, 'utf8').split('\r\n').join('\n');
      const n = src.split(m.from).length - 1;
      if (n !== 1) { console.log(`${m.id}: SKIPPED - mutation anchor matched ${n} times`); continue; }
      writeFileSync(p, src.replace(m.from, m.to));
      touched.push(m.file);
    }
    const r = run(m.test);
    console.log(`${m.id} (${m.desc}): pass ${r.pass} fail ${r.fail} | red: ${r.red.join(', ') || 'NONE'}`);
  } finally {
    if (touched.length) execFileSync('git', ['checkout', '--', ...touched], opts);
  }
}
const status = execFileSync('git', ['status', '--porcelain'], opts);
console.log('git status after restore:\n' + status);
