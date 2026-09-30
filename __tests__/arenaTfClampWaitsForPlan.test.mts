/* #1263: the same account, with the same saved default timeframe, opened the
 * Arena on different timeframes from one load to the next.
 *
 * THE CAUSE. `entitlementStatus` reads 'not_entitled' for a confirmed free
 * account AND for the whole time the plan is still being loaded - there is no
 * fourth value for "not known yet". The Arena's clamp (move a free account off
 * 1m/5m/15m to 1h) waited only for `authLoading`, which ends before the plan
 * read settles. In that gap it moved a Pro or trial account to 1h, and nothing
 * moved it back: the saved-default seed runs once.
 *
 * MEASURED on the qa site before the fix (build 2656e4c, synthetic session, the
 * two reads answered in the browser so their order could be forced, 3 runs each):
 *   Pro, saved default 5m, PLAN read delayed 2s      -> 1h, 1h, 1h   (wrong)
 *   Pro, saved default 5m, SETTINGS read delayed 2s  -> 5m, 5m, 5m   (right)
 *   Pro, opened on /arena?tf=1m, plan read delayed   -> 1h, 1h, 1h   (wrong)
 *   Free, opened on /arena?tf=5m                     -> 1h, 1h, 1h   (right)
 *
 * WHAT THESE TESTS ARE, AND ARE NOT. There is no DOM test library in this repo,
 * so these are SOURCE PINS on the guard, plus two behavioural checks of
 * lib/limits.ts. They fail when the guard loses the wait. They do not prove the
 * page ends on the right timeframe - only a browser with the plan read delayed
 * shows that (the table above, repeated on the build that has the fix). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATED_TFS, FREE_FALLBACK_TF, isGatedTf } from '../lib/limits.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/^﻿/, '').split(/\r?\n/).join('\n');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ARENA = 'app/arena/page.tsx';
const AUTH = 'components/AuthProvider.tsx';

/** `a || b || c` -> ['a', 'b', 'c'], whitespace-normalised. */
const terms = (expr: string, sep: string) => expr.split(sep).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean).sort();

/** The clamp effect: its guard and its dependency list. */
function clampEffect() {
  const src = code(ARENA);
  const calls = src.match(/setReadTf\(FREE_FALLBACK_TF\)/g) ?? [];
  assert.equal(calls.length, 1, `CONTROL: expected exactly one place in ${ARENA} that moves the timeframe to the free fallback, found ${calls.length} - re-derive these tests`);
  const m = src.match(/useEffect\(\(\) => \{\s*if \(([^)]*)\) return;\s*if \(GATED_TFS\.includes\(readTf\)\) setReadTf\(FREE_FALLBACK_TF\);\s*\}, \[([^\]]*)\]\);/);
  assert.ok(m, `CONTROL: the clamp effect in ${ARENA} no longer has the shape "if (<guard>) return; if (GATED_TFS.includes(readTf)) setReadTf(FREE_FALLBACK_TF);" - re-derive these tests from the new shape`);
  return { guard: terms(m[1], '||'), deps: terms(m[2], ',') };
}

test('A1. the clamp waits for the PLAN, not only for the session - and acts on a confirmed free account only', () => {
  const { guard } = clampEffect();
  assert.ok(guard.includes('entitlementsLoading'), 'the clamp no longer waits for entitlementsLoading. While the plan is loading entitlementStatus reads \'not_entitled\', so a Pro or trial account is moved to 1h and never moved back - #1263');
  assert.ok(guard.includes('authLoading'), 'the clamp no longer waits for authLoading');
  assert.ok(guard.includes("entitlementStatus !== 'not_entitled'"), "the clamp no longer requires a confirmed 'not_entitled' - it must never fire on 'unknown' (#1119) or on 'entitled'");
  assert.deepEqual(guard, ['authLoading', "entitlementStatus !== 'not_entitled'", 'entitlementsLoading'], 'the clamp guard gained or lost a condition - decide whether the new one can be true while the plan is still unknown');
});

test('A2. the clamp re-runs when the plan arrives, and when the timeframe changes', () => {
  const { deps } = clampEffect();
  assert.ok(deps.includes('entitlementsLoading'), 'entitlementsLoading is not a dependency: a free account would never be clamped, because the effect would not run again when the plan lands');
  assert.ok(deps.includes('readTf'), 'readTf is not a dependency: a saved default that arrives AFTER the plan would not be clamped for a free account');
  assert.deepEqual(deps, ['authLoading', 'entitlementStatus', 'entitlementsLoading', 'readTf']);
});

test('A3. the Arena takes both flags from useAuth() - not a local stand-in', () => {
  const m = code(ARENA).match(/const \{([^}]*)\} = useAuth\(\);/);
  assert.ok(m, `CONTROL: ${ARENA} no longer destructures useAuth()`);
  const names = terms(m[1], ',');
  assert.ok(names.includes('entitlementsLoading'), 'entitlementsLoading is not read from useAuth()');
  assert.ok(names.includes('loading: authLoading'), 'authLoading is not the provider\'s `loading`');
  assert.ok(names.includes('entitlementStatus'));
});

test("A4. PREMISE: 'not_entitled' is still what the status reads while the plan is loading", () => {
  /* If a 'loading' status is ever added, the guard above can be simplified and
     this test should be rewritten, not deleted: it is the reason the wait exists. */
  const src = code(AUTH);
  const union = src.match(/export type EntitlementStatus = ([^;]+);/);
  assert.ok(union, `CONTROL: EntitlementStatus is no longer declared in ${AUTH}`);
  assert.deepEqual(terms(union[1], '|'), ["'entitled'", "'not_entitled'", "'unknown'"], 'EntitlementStatus gained or lost a value - if there is now a value for "still loading", re-derive the clamp guard');
  assert.match(src, /const \[entitlementsLoading, setEntitlementsLoading\] = useState\(true\);/, 'entitlementsLoading no longer starts true - "unknown until proven otherwise" is what makes waiting on it safe');
  const derive = src.match(/const entitlementStatus: EntitlementStatus =([\s\S]*?);/);
  assert.ok(derive, 'CONTROL: the entitlementStatus derivation moved');
  assert.equal(/entitlementsLoading/.test(derive[1]), false, "the status derivation now reads entitlementsLoading - 'not_entitled' may no longer cover the loading window; re-derive the clamp guard");
  assert.match(derive[1].replace(/\s+/g, ' '), /\(isPro \|\| isTrial\) \? 'entitled' : entitlementsError \? 'unknown' : 'not_entitled'/);
});

test("A5. SWEEP: every early-return that acts on a confirmed 'not_entitled' also waits for the plan", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (rel !== 'app/api') walk(rel); }
      else if (/\.tsx?$/.test(e.name)) files.push(rel);
    }
  };
  for (const d of ['app', 'components']) walk(d);
  assert.ok(files.length > 100 && files.includes(ARENA), `the walk is not seeing the tree (${files.length} files)`);
  const hits: string[] = [];
  for (const f of files) {
    for (const line of code(f).split('\n')) {
      if (/entitlementStatus !== 'not_entitled'\) return/.test(line)) hits.push(`${f}: ${line.trim()}`);
    }
  }
  assert.deepEqual(hits.map((h) => h.split(':')[0]).sort(), [ARENA, 'components/GlobalMacroContext.tsx'], `CONTROL: the two known guards were not both found, or a third appeared: ${hits.join(' | ')}`);
  for (const h of hits) assert.ok(/entitlementsLoading/.test(h), `${h} acts on 'not_entitled' without waiting for entitlementsLoading - it will act on the placeholder`);
});

test('A6. the clamp moves a free account to a timeframe that is itself free, and the Arena\'s own start is a gated one', () => {
  assert.equal(isGatedTf(FREE_FALLBACK_TF), false, 'the free fallback timeframe is itself gated - the clamp would move a free account onto a locked timeframe');
  assert.deepEqual([...GATED_TFS], ['1m', '5m', '15m']);
  // The premise of "a Pro account that opens the Arena is affected even with no ?tf=":
  // the page's own initial timeframe is one the clamp acts on.
  const initial = code(ARENA).match(/valid\.includes\(tf as ChartTf\) \? tf as ChartTf : '([^']+)'/);
  assert.ok(initial, `CONTROL: the Arena's initial timeframe expression moved in ${ARENA}`);
  assert.equal(isGatedTf(initial[1]), true, `the Arena now starts on ${initial[1]}, which is not gated - the clamp no longer touches a load with no ?tf=, and the comment on the clamp effect is out of date`);
});

test("A7. KNOWN GAP: the Journal and the Hypothesis tracker also wait for the plan before showing tools as locked", { todo: "components/TradeJournal.tsx and components/HypothesisTracker.tsx lock on `!authLoading && entitlementStatus === 'not_entitled'` - read from source, not reproduced in a browser; reported on #1263" }, () => {
  for (const f of ['components/TradeJournal.tsx', 'components/HypothesisTracker.tsx']) {
    const lines = code(f).split('\n').filter((l) => /!authLoading && entitlementStatus === 'not_entitled'/.test(l));
    assert.ok(lines.length > 0, `CONTROL: ${f} no longer has the lock expression - delete this todo`);
    for (const l of lines) assert.ok(/entitlementsLoading/.test(l), `${f}: ${l.trim()}`);
  }
});
