const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const TEST = '__tests__/macroForexUpstreamCount.test.mts';
const MACRO = 'app/api/macro/route.ts', JPY = 'app/api/forex/jpy/route.ts', CACHE = 'lib/apiCache.ts';
const M = [
  { id: 'M1 macro drops the failure hold', file: MACRO, from: ',\n      { failTtlMs: YF_FAIL_TTL_MS });', to: ');', expect: ['M3', 'M5', 'S1'] },
  { id: 'M2 jpy drops the failure hold', file: JPY, from: ', { failTtlMs: JPY_FAIL_TTL_MS });', to: ');', expect: ['J2', 'S1'] },
  { id: 'M3 cache never remembers a failure', file: CACHE, from: 'if (failTtlMs > 0) rememberFailure(key, e);', to: '', expect: ['M3', 'M5', 'J2', 'A2'] },
  { id: 'M4 hold boundary off by one (<=)', file: CACHE, from: 'if (fail && Date.now() - fail.ts < failTtlMs) throw fail.error;', to: 'if (fail && Date.now() - fail.ts <= failTtlMs) throw fail.error;', expect: ['A2'] },
  { id: 'M5 macro hold 60 s', file: MACRO, from: 'const YF_FAIL_TTL_MS = 30_000;', to: 'const YF_FAIL_TTL_MS = 60_000;', expect: ['M4', 'S1'] },
  { id: 'M6 macro bypasses the cache', file: MACRO, from: 'return await cached(`macro:yahoo:${label}`, YF_TTL_MS, () => fetchYf(sym, label),\n      { failTtlMs: YF_FAIL_TTL_MS });', to: 'return await fetchYf(sym, label);', expect: ['M1', 'M2'] },
  { id: 'M7 jpy window 1 minute', file: JPY, from: 'const JPY_TTL_MS = 5 * 60_000;', to: 'const JPY_TTL_MS = 60_000;', expect: ['J1'] },
  { id: 'M8 no-price stored as null instead of held', file: MACRO, from: "if (!parsed) throw new YfUnavailable('no price in payload');", to: 'if (!parsed) return null as unknown as { price: number; chg: number };', expect: ['M5'] },
  { id: 'M9 concurrent callers not shared', file: CACHE, from: '  if (existing) return existing;\n\n  const p = (async () => {\n    try {', to: '\n  const p = (async () => {\n    try {', expect: ['M2', 'A2'] },
  { id: 'M10 revalidate stacked back on', file: MACRO, from: "cache: 'no-store',\n      signal", to: 'next: { revalidate: 60 },\n      signal', expect: ['S1'] },
  { id: 'M11 whole #1473 reverted (files from origin/dev)', revert: 'origin/dev', files: [MACRO, JPY, CACHE], expect: ['M1', 'M2', 'M3', 'J1', 'J2', 'A2', 'S1'] },
];
const run = () => {
  const r = spawnSync(process.execPath, ['--import', './qa/alias-register.mjs', '--test', TEST], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  return [...new Set([...((r.stdout || '') + (r.stderr || '')).matchAll(/^✖ ([A-Z]\d+)\./gm)].map((m) => m[1]))].sort();
};
console.log('baseline failed:', JSON.stringify(run()));
let killed = 0;
for (const m of M) {
  const files = m.files ?? [m.file];
  try {
    if (m.revert) {
      for (const f of files) fs.writeFileSync(path.join(ROOT, f), execFileSync('git', ['show', `${m.revert}:${f}`], { cwd: ROOT, encoding: 'utf8' }));
    } else {
      const p = path.join(ROOT, m.file);
      const orig = fs.readFileSync(p, 'utf8');
      const crlf = orig.includes('\r\n');
      const from = crlf ? m.from.replace(/\n/g, '\r\n') : m.from;
      const to = crlf ? m.to.replace(/\n/g, '\r\n') : m.to;
      if (!orig.includes(from)) { console.log(m.id, '=> NOT APPLIED'); continue; }
      fs.writeFileSync(p, orig.replace(from, to));
    }
    const f = run();
    const ok = m.expect.every((e) => f.includes(e));
    if (ok) killed++;
    console.log(m.id, '=>', ok ? 'KILLED' : 'SURVIVED', 'failed:', JSON.stringify(f), 'expected:', JSON.stringify(m.expect));
  } finally { execFileSync('git', ['checkout', '--', ...files], { cwd: ROOT }); }
}
console.log(`killed ${killed} of ${M.length}`);
console.log('tree after:', execFileSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' }).trim());
