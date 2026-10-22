const fs = require('fs');
const lines = fs.readFileSync('aicaps-tail.mts', 'utf8').split(/\r?\n/);
const iStart = lines.findIndex((l) => l.startsWith('async function increment(t: TestContext'));
const iEnd = lines.findIndex((l) => l.startsWith('const BLOCKS:'));
const helper = [
  "const clock = (t: TestContext) => t.mock.timers.enable({ apis: ['Date'], now: NOW });",
  "async function increment(tier: UsageTier, uid: string, ledger: LedgerRow[], over: { reserve?: number | null; pool?: number | null } = {}) {",
  "  reset();",
  "  world.ledger = ledger;",
  "  if ('reserve' in over) world.reserve = over.reserve ?? null;",
  "  return incrementUsageColumn(uid, tier, 'grok_count', 10, over.pool ?? null);",
  "}",
  "",
];
lines.splice(iStart, iEnd - iStart, ...helper);
let s = lines.join('\n');
const rep = (a, b) => { const n = s.split(a).length - 1; if (n !== 1) throw new Error('anchor x' + n + ': ' + a.slice(0, 70)); s = s.replace(a, () => b); };
rep("    const got = await increment(t, tier, uid, ledger);", "    clock(t);\n    const got = await increment(tier, uid, ledger);");
rep("  const got = await increment(t, 'pro', PRO, rows(1, PRO, 0.5, TODAY), { reserve: 3 });", "  clock(t);\n  const got = await increment('pro', PRO, rows(1, PRO, 0.5, TODAY), { reserve: 3 });");
rep("  await increment(t, 'pro', PRO, rows(1, PRO, 0.5, TODAY));\n", "  clock(t);\n  await increment('pro', PRO, rows(1, PRO, 0.5, TODAY));\n");
const a = s.indexOf("test('A4.");
const b = s.indexOf("test('A5.");
s = s.slice(0, a) + [
  "test('A4. the count caps still answer as before when no dollar cap is hit: own limit, app-wide breaker, shared pool', async (t) => {",
  "  clock(t);",
  "  assert.deepEqual(await increment('pro', PRO, [], { reserve: null }), { blocked: true, reason: 'user', limit: 10 });",
  "  assert.deepEqual(await increment('pro', PRO, [], { reserve: -1 }), { blocked: true, reason: 'global', limit: 10 });",
  "  assert.deepEqual(await increment('pro', PRO, [], { reserve: -2, pool: 7 }), { blocked: true, reason: 'pool', limit: 7 });",
  "});",
  "",
  "",
].join('\n') + s.slice(b);
fs.writeFileSync('aicaps-tail.mts', s);
console.log('ok');
