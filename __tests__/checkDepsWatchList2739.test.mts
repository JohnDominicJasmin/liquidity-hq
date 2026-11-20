/* QA: PR #2739, the install check no longer watches a package the lockfile dropped.
 *
 * THE WRITTEN RULE (PR body, PM note on the v2026.11.22 build): scripts/check-deps.mjs watches `@opentelemetry/instrumentation` only while package-lock.json still lists it (the Sentry 11 upgrade removed it, so every fresh install printed the "DEPENDENCY CHECK FAILED" banner for a package nothing installs). A readable lockfile that does not list it: no banner. A lockfile that lists it (top-level or nested) and a missing package.json on disk: the banner names it. An unreadable lockfile keeps the whole watch list (the conservative direction). A missing DECLARED dependency still raises the banner whatever the lockfile says. The script always exits 0.
 * The real script is copied into a scratch project (scripts/ + package.json + package-lock.json + node_modules) and RUN, so the behaviour is measured, not read.
 *   C1 lockfile without the name, nothing on disk: NO banner   C2 listed at the top level, missing on disk: banner names it   C3 listed only nested, missing: banner   C4 unreadable / absent lockfile: banner (kept)
 *   C5 listed and present on disk: no banner   C6 a look-alike name (`instrumentation-http`) does not count as listed: no banner   C7 a missing declared dependency: banner whatever the lockfile   C8 exit code 0 in every case */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'check-deps.mjs');
const NAME = '@opentelemetry/instrumentation';

type Opts = { lock?: unknown | 'ABSENT' | 'BROKEN'; present?: boolean; deps?: Record<string, string>; depPresent?: boolean };
function run(o: Opts) {
  const dir = mkdtempSync(path.join(tmpdir(), 'qa-checkdeps-'));
  try {
    mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    copyFileSync(SCRIPT, path.join(dir, 'scripts', 'check-deps.mjs'));
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'scratch', dependencies: o.deps ?? {} }));
    if (o.lock === 'BROKEN') writeFileSync(path.join(dir, 'package-lock.json'), '{ not json');
    else if (o.lock !== 'ABSENT') writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(o.lock ?? { packages: {} }));
    if (o.present) { const p = path.join(dir, 'node_modules', '@opentelemetry', 'instrumentation'); mkdirSync(p, { recursive: true }); writeFileSync(path.join(p, 'package.json'), '{}'); }
    for (const d of Object.keys(o.deps ?? {})) if (o.depPresent) { const p = path.join(dir, 'node_modules', d); mkdirSync(p, { recursive: true }); writeFileSync(path.join(p, 'package.json'), '{}'); }
    const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'check-deps.mjs')], { encoding: 'utf8', cwd: dir });
    return { status: r.status, err: r.stderr, banner: /DEPENDENCY CHECK FAILED/.test(r.stderr), names: r.stderr };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const lockWith = (...keys: string[]) => ({ packages: Object.fromEntries(['', ...keys].map((k) => [k, {}])) });

test('C1. a readable lockfile that no longer lists the package: NO banner (the fix)', () => {
  const r = run({ lock: lockWith('node_modules/next', 'node_modules/@sentry/node') });
  assert.equal(r.banner, false, `a stale watch entry still printed the banner:\n${r.err}`); assert.equal(r.status, 0);
  assert.equal(run({ lock: { packages: {} } }).banner, false); assert.equal(run({ lock: {} }).banner, false, 'a lockfile with no packages map lists nothing');
});

test('C2/C3. listed (top-level or nested) and missing on disk: the banner names it', () => {
  for (const [label, key] of [['top level', `node_modules/${NAME}`], ['nested', `node_modules/@sentry/node/node_modules/${NAME}`]] as const) {
    const r = run({ lock: lockWith(key) }); assert.equal(r.banner, true, `${label}: no banner for a listed, missing package`);
    assert.match(r.names, new RegExp(`- ${NAME.replace('/', '\\/')}`), `${label}: the banner does not name the package`); assert.equal(r.status, 0);
  }
});

test('C4. an unreadable or absent lockfile keeps the whole watch list', () => {
  for (const lock of ['BROKEN', 'ABSENT'] as const) { const r = run({ lock }); assert.equal(r.banner, true, `${lock} lockfile: the watch list was dropped`); assert.match(r.names, /@opentelemetry\/instrumentation/); assert.equal(r.status, 0); }
});

test('C5. listed and present on disk: no banner', () => {
  const r = run({ lock: lockWith(`node_modules/${NAME}`), present: true }); assert.equal(r.banner, false, r.err); assert.equal(r.status, 0);
});

test('C6. a look-alike name does not count as listed', () => {
  for (const key of [`node_modules/${NAME}-http`, `node_modules/${NAME}-fetch`, `node_modules/x${NAME}`]) { const r = run({ lock: lockWith(key) }); assert.equal(r.banner, false, `"${key}" was treated as listing the watched package:\n${r.err}`); }
});

test('C7/C8. a missing DECLARED dependency raises the banner whatever the lockfile says; every run exits 0', () => {
  for (const lock of [lockWith(), lockWith(`node_modules/${NAME}`), 'BROKEN' as const]) {
    const r = run({ lock, deps: { 'left-pad-qa-scratch': '1.0.0' } }); assert.equal(r.banner, true, 'a missing declared dependency did not raise the banner'); assert.match(r.names, /left-pad-qa-scratch/); assert.equal(r.status, 0);
  }
  const ok = run({ lock: lockWith(), deps: { 'left-pad-qa-scratch': '1.0.0' }, depPresent: true }); assert.equal(ok.banner, false, 'CONTROL: a present declared dependency must not raise the banner'); assert.equal(ok.status, 0);
  void execFileSync;
});
