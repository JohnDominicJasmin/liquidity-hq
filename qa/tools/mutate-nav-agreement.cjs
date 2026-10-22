const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const TEST = '__tests__/navScreenNameAgreement.test.mts';
const NAV = 'lib/navRoutes.ts';
const M = [
  { id: 'M1 prefix match for tabs', file: NAV, from: 'const item = TERMINAL_TABS.find(i => pathname === i.href);', to: "const item = TERMINAL_TABS.find(i => pathname === i.href || pathname.startsWith(i.href + '/'));", expect: ['N1'] },
  { id: 'M2 prefix match for screen names', file: NAV, from: 'if (pathname in SCREEN_NAMES) return t(SCREEN_NAMES[pathname]);', to: "{ const mp = Object.keys(SCREEN_NAMES).find(p => pathname === p || pathname.startsWith(p + '/')); if (mp) return t(SCREEN_NAMES[mp]); }", expect: ['N1'] },
  { id: 'M3 isActive by prefix again', file: NAV, from: 'return pathname === href;', to: "return pathname === href || pathname.startsWith(href + '/');", expect: ['N2'] },
  { id: 'M4 URL fallback for every path (the original bug)', file: NAV, from: "if (!URL_NAMED_ROUTES.has(pathname)) return '';", to: '', expect: ['N1'] },
  { id: 'M5 a named page loses its entry', file: NAV, from: "  '/hours':         'TNAV_HOURS_LABEL',\n", to: '', expect: ['N3'] },
  { id: 'M6 label key typo', file: NAV, from: "'TNAV_CALC_LABEL',", to: "'TNAV_CALC_LABELX',", expect: ['N4'] },
  { id: 'M7 nav link to a missing page', file: NAV, from: "{ path: '/hours',         labelKey: 'NAV_BEST_HOURS'    as const },", to: "{ path: '/hours-old',     labelKey: 'NAV_BEST_HOURS'    as const },", expect: ['N5'] },
  { id: 'M8 new page with the bar and no name', newFile: 'app/zz-qa-probe/page.tsx', body: 'export default function P() { return null; }\n', expect: ['N3'] },
  { id: 'M9 new dynamic page under a named route', newFile: 'app/arena/[id]/page.tsx', body: 'export default function P() { return null; }\n', expect: ['N3'] },
  { id: 'M10 a URL-named route without a page', file: NAV, from: "new Set(['/admin', '/offline'])", to: "new Set(['/admin', '/offline', '/gone'])", expect: ['N4'] },
];
const run = () => {
  const r = spawnSync(process.execPath, ['--import', './qa/alias-register.mjs', '--test', TEST], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  return [...new Set([...(r.stdout + r.stderr).matchAll(/^✖ (N\d+|CONTROL)\b/gm)].map((m) => m[1]))].sort();
};
console.log('baseline failed:', JSON.stringify(run()));
let killed = 0;
for (const m of M) {
  if (m.newFile) {
    const p = path.join(ROOT, m.newFile);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, m.body);
    try { const f = run(); const ok = m.expect.every((e) => f.includes(e)); if (ok) killed++; console.log(m.id, '=>', ok ? 'KILLED' : 'SURVIVED', JSON.stringify(f)); }
    finally { fs.rmSync(p); try { fs.rmdirSync(path.dirname(p)); } catch {} }
    continue;
  }
  const p = path.join(ROOT, m.file);
  const orig = fs.readFileSync(p, 'utf8');
  try {
    const crlf = orig.includes('\r\n');
    const from = crlf ? m.from.replace(/\n/g, '\r\n') : m.from;
    const to = crlf ? m.to.replace(/\n/g, '\r\n') : m.to;
    if (!orig.includes(from)) { console.log(m.id, '=> NOT APPLIED'); continue; }
    fs.writeFileSync(p, orig.replace(from, to));
    const f = run();
    const ok = m.expect.every((e) => f.includes(e));
    if (ok) killed++;
    console.log(m.id, '=>', ok ? 'KILLED' : 'SURVIVED', JSON.stringify(f));
  } finally { execFileSync('git', ['checkout', '--', m.file], { cwd: ROOT }); }
}
console.log(`killed ${killed} of ${M.length}`);
console.log('tree after:', execFileSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' }).trim());
