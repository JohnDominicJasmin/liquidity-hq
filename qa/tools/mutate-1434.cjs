const { execFileSync } = require('child_process');
const fs = require('fs');
const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const T = '__tests__/notFoundStaysStatic.test.mts';
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' });
const TRACKED = ['app/not-found.tsx', 'proxy.ts', 'app/layout.tsx', 'components/NotFoundContent.tsx'];
const TMP = `${ROOT}/lib/qaTmpRequestReader.ts`;
const revert = () => { git('checkout', '--', ...TRACKED); if (fs.existsSync(TMP)) fs.unlinkSync(TMP); };
const edit = (f, fn) => { const p = `${ROOT}/${f}`; const s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o === s) throw new Error('no change in ' + f); fs.writeFileSync(p, o); };
const M = [
  { name: 'T1 the pre-fix not-found.tsx (headers() + force-dynamic) comes back', red: ['N1.', 'N5.'], apply: () => fs.writeFileSync(`${ROOT}/app/not-found.tsx`, git('show', 'e4c49109:app/not-found.tsx')) },
  { name: 'T2 the pre-fix proxy.ts (runs everywhere, tags every request) comes back', red: ['N4.'], apply: () => fs.writeFileSync(`${ROOT}/proxy.ts`, git('show', 'e4c49109:proxy.ts')) },
  { name: 'T3 the request read moves one file down, into the component not-found renders', red: ['N2.'], apply: () => edit('components/NotFoundContent.tsx', (s) => s.replace(/^(['"]use client['"];?\s*\n)?/, "import { headers } from 'next/headers';\n")) },
  { name: 'T4 the root layout reads cookies', red: ['N3.', 'N5.'], apply: () => edit('app/layout.tsx', (s) => "import { cookies } from 'next/headers';\n" + s) },
  { name: 'T5 the root layout forces dynamic rendering', red: ['N3.'], apply: () => edit('app/layout.tsx', (s) => s + "\nexport const dynamic = 'force-dynamic';\n") },
  { name: 'T6 a new shared lib file imports next/headers', red: ['N5.'], apply: () => fs.writeFileSync(TMP, "import { headers } from 'next/headers';\nexport const x = async () => (await headers()).get('x');\n") },
  { name: 'T7 the proxy matcher gains a third path', red: ['N4.'], apply: () => edit('proxy.ts', (s) => s.replace("matcher: ['/backtest', '/live-tracking'],", "matcher: ['/backtest', '/live-tracking', '/((?!api).*)'],")) },
  { name: 'T8 not-found becomes async and logs', red: ['N1.'], apply: () => edit('app/not-found.tsx', (s) => s.replace('export default function NotFound() {', "export default async function NotFound() {\n  console.warn('[not-found]');")) },
];
const run = () => { let out = ''; let code = 0; try { out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', T], { cwd: ROOT, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = (e.stdout || '') + (e.stderr || ''); code = e.status || 1; }
  return { code, failed: [...new Set([...out.matchAll(/^\s*\u2716 (\S+)/gm)].map(x => x[1]))].filter(k => /^[A-Z]\d+[a-z]?\.$/.test(k)) }; };
revert(); const b = run(); console.log('BASELINE exit', b.code); if (b.code) process.exit(2);
let ok = 0;
for (const m of M) {
  try { m.apply(); } catch (e) { console.log('SKIP ', m.name, e.message); revert(); continue; }
  const r = run(); revert();
  const missing = m.red.filter(k => !r.failed.includes(k));
  const good = r.code !== 0 && missing.length === 0; if (good) ok++;
  console.log(good ? 'OK   ' : 'WRONG', m.name, '| want', m.red.join(','), '| red:', r.failed.join(',') || '(none)');
}
revert(); console.log(`${ok}/${M.length}`, git('status', '--short', '--', ...TRACKED, 'lib') || 'sources clean');
