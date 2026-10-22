/* Mutation check for __tests__/arenaTfClampWaitsForPlan.test.mts.
 * Each mutant: edit one app file, run ONLY that test file, restore with git checkout. */
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const TEST = '__tests__/arenaTfClampWaitsForPlan.test.mts';
const ARENA = 'app/arena/page.tsx';
const AUTH = 'components/AuthProvider.tsx';
const MACRO = 'components/GlobalMacroContext.tsx';
const LIMITS = 'lib/limits.ts';

const M = [
  { id: 'M1 guard loses the wait', file: ARENA, from: "if (authLoading || entitlementsLoading || entitlementStatus !== 'not_entitled') return;\n    if (GATED_TFS", to: "if (authLoading || entitlementStatus !== 'not_entitled') return;\n    if (GATED_TFS", expect: ['A1'] },
  { id: 'M2 deps lose entitlementsLoading', file: ARENA, from: '}, [authLoading, entitlementsLoading, entitlementStatus, readTf]);', to: '}, [authLoading, entitlementStatus, readTf]);', expect: ['A2'] },
  { id: 'M3 deps lose readTf', file: ARENA, from: '}, [authLoading, entitlementsLoading, entitlementStatus, readTf]);', to: '}, [authLoading, entitlementsLoading, entitlementStatus]);', expect: ['A2'] },
  { id: 'M4 clamp fires on unknown too', file: ARENA, from: "if (authLoading || entitlementsLoading || entitlementStatus !== 'not_entitled') return;\n    if (GATED_TFS", to: "if (authLoading || entitlementsLoading || entitlementStatus === 'entitled') return;\n    if (GATED_TFS", expect: ['A1'] },
  { id: 'M5 guard loses authLoading', file: ARENA, from: "if (authLoading || entitlementsLoading || entitlementStatus !== 'not_entitled') return;\n    if (GATED_TFS", to: "if (entitlementsLoading || entitlementStatus !== 'not_entitled') return;\n    if (GATED_TFS", expect: ['A1'] },
  { id: 'M6 local stand-in for the flag', file: ARENA, from: 'const { user, loading: authLoading, entitlementStatus, entitlementsLoading, retryEntitlements } = useAuth();', to: 'const { user, loading: authLoading, entitlementStatus, retryEntitlements } = useAuth();\n  const entitlementsLoading = false;', expect: ['A3'] },
  { id: 'M7 whole fix reverted (file from 2656e4cb)', file: ARENA, gitRev: '2656e4cb', expect: ['A1', 'A2', 'A3'] },
  { id: 'M8 entitlementsLoading starts false', file: AUTH, from: 'const [entitlementsLoading, setEntitlementsLoading] = useState(true);', to: 'const [entitlementsLoading, setEntitlementsLoading] = useState(false);', expect: ['A4'] },
  { id: 'M9 a loading status is added', file: AUTH, from: "export type EntitlementStatus = 'entitled' | 'not_entitled' | 'unknown';", to: "export type EntitlementStatus = 'entitled' | 'not_entitled' | 'unknown' | 'loading';", expect: ['A4'] },
  { id: 'M10 sibling guard loses the wait', file: MACRO, from: "if (authLoading || entitlementsLoading || entitlementStatus !== 'not_entitled') return;", to: "if (authLoading || entitlementStatus !== 'not_entitled') return;", expect: ['A5'] },
  { id: 'M11 free fallback is a gated timeframe', file: LIMITS, from: "export const FREE_FALLBACK_TF = '1h';", to: "export const FREE_FALLBACK_TF = '15m';", expect: ['A6'] },
  { id: 'M12 Arena starts on a free timeframe', file: ARENA, from: "return valid.includes(tf as ChartTf) ? tf as ChartTf : '15m';", to: "return valid.includes(tf as ChartTf) ? tf as ChartTf : '1h';", expect: ['A6'] },
  { id: 'M13 a third unguarded early return appears', file: 'components/PlanBadge.tsx', append: "\n// mutant\nexport function mutantProbe(entitlementStatus: string) { if (entitlementStatus !== 'not_entitled') return; }\n", expect: ['A5'] },
];

function run() {
  const r = spawnSync(process.execPath, ['--import', './qa/alias-register.mjs', '--test', TEST], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const failed = [...out.matchAll(/^✖ (A\d+)\./gm)].map((m) => m[1]);
  return { failed: [...new Set(failed)].sort(), status: r.status };
}

const base = run();
console.log('baseline failed:', JSON.stringify(base.failed), 'exit', base.status);
let killed = 0;
for (const m of M) {
  const p = path.join(ROOT, m.file);
  const orig = fs.readFileSync(p, 'utf8');
  try {
    let next;
    if (m.gitRev) next = execFileSync('git', ['show', `${m.gitRev}:${m.file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    else if (m.append) next = orig + m.append;
    else {
      const from = orig.includes('\r\n') ? m.from.replace(/\n/g, '\r\n') : m.from;
      const to = orig.includes('\r\n') ? m.to.replace(/\n/g, '\r\n') : m.to;
      if (!orig.includes(from)) { console.log(m.id, '=> NOT APPLIED (text not found)'); continue; }
      next = orig.replace(from, to);
    }
    fs.writeFileSync(p, next);
    const r = run();
    const ok = m.expect.every((e) => r.failed.includes(e));
    if (ok) killed++;
    console.log(m.id, '=>', ok ? 'KILLED' : 'SURVIVED', 'failed:', JSON.stringify(r.failed), 'expected:', JSON.stringify(m.expect));
  } finally {
    execFileSync('git', ['checkout', '--', m.file], { cwd: ROOT });
  }
}
console.log(`killed ${killed} of ${M.length}`);
console.log('tree after:', execFileSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' }).trim() || '(only untracked test file expected)');
