const fs = require('fs');
let s = fs.readFileSync('aicaps-tail.mts', 'utf8');
const rep = (a, b) => { if (s.split(a).length !== 2) throw new Error('anchor x' + (s.split(a).length - 1) + ': ' + a.slice(0, 60)); s = s.replace(a, () => b); };

// P21 duplicates P14
rep("  ['P21', 'the site fuse is not a Pro cap: $50 of other people\'s spend today does not touch a Pro account', 'pro', PRO, rows(200, OTHER, Q, TODAY), null],\n", '');

// dev block start: first un-commented-out create statement, not the prose
rep("const start = lines.findIndex((l) => l.startsWith('-- ── DEV'));\n  return lines.slice(start + 1)", "const start = lines.findIndex((l) => /^--\s+create or replace function/.test(l));\n  return lines.slice(start)");

// repo root for git
rep("function filesUnder(dir: string): string[] {\n  return execFileSync('git', ['ls-files', dir],", "function filesUnder(dir: string): string[] {\n  return execFileSync('git', ['-C', fileURLToPath(new URL('..', import.meta.url)), 'ls-files', dir],");

// the increment helper and its callers
const oldHelper = s.slice(s.indexOf('async function increment(t: TestContext'), s.indexOf('const BLOCKS:'));
s = s.replace(oldHelper, `const clock = (t: TestContext) => t.mock.timers.enable({ apis: ['Date'], now: NOW });
async function increment(tier: UsageTier, uid: string, ledger: LedgerRow[], over: { reserve?: number | null; pool?: number | null } = {}) {
  reset();
  world.ledger = ledger;
  if ('reserve' in over) world.reserve = over.reserve ?? null;
  return incrementUsageColumn(uid, tier, 'grok_count', 10, over.pool ?? null);
}

`);
rep("    const got = await increment(t, tier, uid, ledger);\n    assert.equal(got.blocked, true);", "    clock(t);\n    const got = await increment(tier, uid, ledger);\n    assert.equal(got.blocked, true);");
rep("  const got = await increment(t, 'pro', PRO, rows(1, PRO, 0.5, TODAY), { reserve: 3 });", "  clock(t);\n  const got = await increment('pro', PRO, rows(1, PRO, 0.5, TODAY), { reserve: 3 });");
rep("  await increment(t, 'pro', PRO, rows(1, PRO, 0.5, TODAY));\n  const order", "  clock(t);\n  await increment('pro', PRO, rows(1, PRO, 0.5, TODAY));\n  const order");
const a4s = s.indexOf("test('A4.");
const a4e = s.indexOf("test('A5.");
s = s.slice(0, a4s) + `test('A4. the count caps still answer as before when no dollar cap is hit: own limit, app-wide breaker, shared pool', async (t) => {
  clock(t);
  assert.deepEqual(await increment('pro', PRO, [], { reserve: null }), { blocked: true, reason: 'user', limit: 10 });
  assert.deepEqual(await increment('pro', PRO, [], { reserve: -1 }), { blocked: true, reason: 'global', limit: 10 });
  assert.deepEqual(await increment('pro', PRO, [], { reserve: -2, pool: 7 }), { blocked: true, reason: 'pool', limit: 7 });
});

` + s.slice(a4e);
fs.writeFileSync('aicaps-tail.mts', s);
console.log('tail fixed');
