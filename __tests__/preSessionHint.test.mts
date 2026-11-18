import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/* #1263 (last box, CLS on /arena at 360 RU, signed in, NO saved strategy): QA's unit cells on the pre-paint `session-hint` script in components/RootDocument.tsx.
 * WHAT THIS PINS: the REAL inline script text (taken out of RootDocument.tsx, not a copy) is run in node:vm against a stand-in document and localStorage, and the table below is what it sets on <html>:
 *   no stored session -> nothing; session + no cache -> data-sess only; session + cached strategy -> data-sess + data-strat; session + cached "no strategy" (arena_strategy null / "") -> data-sess + data-strat-none;
 *   key missing / corrupt JSON / non-object JSON / blocked or throwing storage -> never data-strat-none (an unreadable cache must not claim "none"); and data-strat and data-strat-none are NEVER both set.
 * It also pins the two shapes the fix depends on: the reserve rule in globals.css is the one that `:not([data-strat-none])` ends, and nothing in the app styles `[data-strat-none]` to HIDE anything.
 * WHAT IT CANNOT PROVE: the CLS number, or what the first paint looks like (qa/e2e/cls-arena-gate.spec.ts on a deployed build). The cache is NOT keyed by user (lhq_settings_v1), so a different account's
 * cache on a shared browser is a documented residual that no unit cell here can close. */

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');

function scriptText(): string {
  const src = read('components/RootDocument.tsx');
  const open = src.indexOf('<Script id="session-hint" strategy="beforeInteractive">');
  assert.ok(open > 0, 'the session-hint <Script> is gone from RootDocument.tsx');
  const tick = src.indexOf('{`', open);
  const end = src.indexOf('`}', tick);
  assert.ok(tick > open && end > tick, 'could not take the inline script text out of the session-hint <Script>');
  return src.slice(tick + 2, end);
}

type Store = Record<string, string>;
type Mode = 'ok' | 'blocked' | 'throwing-getItem';

/** Runs the real script text; returns the attributes it set on <html> (empty object if none). */
function run(store: Store, mode: Mode = 'ok'): Record<string, string> {
  const attrs: Record<string, string> = {};
  const keys = Object.keys(store);
  const ls = {
    get length() { return keys.length; },
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => { if (mode === 'throwing-getItem') throw new Error('SecurityError'); return k in store ? store[k] : null; },
  };
  const win: Record<string, unknown> = {};
  Object.defineProperty(win, 'localStorage', { get() { if (mode === 'blocked') throw new Error('SecurityError: storage blocked'); return ls; } });
  const document = { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } } };
  vm.runInNewContext(scriptText(), { window: win, document });
  return attrs;
}

const SESSION: Store = { 'sb-abcdefg-auth-token': '{"access_token":"x"}' };
const withSettings = (json: string | object): Store => ({ ...SESSION, lhq_settings_v1: typeof json === 'string' ? json : JSON.stringify(json) });

test('H1. no stored session: nothing is set (a signed-out visitor gets no reserve and no hint), whatever the settings cache says', () => {
  assert.deepEqual(run({}), {});
  assert.deepEqual(run({ lhq_settings_v1: JSON.stringify({ arena_strategy: null }) }), {});
  assert.deepEqual(run({ lhq_settings_v1: JSON.stringify({ arena_strategy: 'ema_stack' }) }), {});
  assert.deepEqual(run({ 'sb-abcdefg-auth-token': '' }), {}, 'an EMPTY auth-token value is not a session');
  assert.deepEqual(run({ 'sb-abcdefg-code-verifier': 'x' }), {}, 'only an -auth-token key counts as a session');
});

test('H2. session, no settings cache (first visit after sign-in on a new device): data-sess only', () => {
  assert.deepEqual(run(SESSION), { 'data-sess': '1' });
});

test('H3. session + cached SAVED strategy: data-sess and data-strat, never data-strat-none', () => {
  assert.deepEqual(run(withSettings({ arena_strategy: 'ema_stack' })), { 'data-sess': '1', 'data-strat': '1' });
});

test('H4. session + cached "no strategy" (null or empty string): data-sess and data-strat-none, never data-strat (THE FIX)', () => {
  assert.deepEqual(run(withSettings({ arena_strategy: null })), { 'data-sess': '1', 'data-strat-none': '1' });
  assert.deepEqual(run(withSettings({ arena_strategy: '' })), { 'data-sess': '1', 'data-strat-none': '1' });
  /* the full cache the app really writes (saveLocalSettings stores the WHOLE settings object, arena_strategy: null by default) */
  assert.deepEqual(run(withSettings({ account_size: 10000, risk_pct: 1, strategy_selection: [], arena_strategy: null })), { 'data-sess': '1', 'data-strat-none': '1' });
});

test('H5. a cache that does not say anything about the strategy never claims "none": key missing, other types, corrupt JSON, wrong shapes', () => {
  assert.deepEqual(run(withSettings({ account_size: 10000 })), { 'data-sess': '1' }, 'key missing');
  assert.deepEqual(run(withSettings('{not json')), { 'data-sess': '1' }, 'corrupt JSON');
  assert.deepEqual(run(withSettings('')), { 'data-sess': '1' }, 'empty string');
  assert.deepEqual(run(withSettings('null')), { 'data-sess': '1' }, 'JSON null');
  assert.deepEqual(run(withSettings('5')), { 'data-sess': '1' }, 'JSON number');
  assert.deepEqual(run(withSettings('"arena_strategy"')), { 'data-sess': '1' }, 'JSON string');
  assert.deepEqual(run(withSettings('true')), { 'data-sess': '1' }, 'JSON boolean');
});

test('H6. an unreadable store never throws out of the script and never sets "none"', () => {
  assert.deepEqual(run(withSettings({ arena_strategy: null }), 'blocked'), {}, 'localStorage getter throws: nothing set, no exception');
  assert.deepEqual(run(withSettings({ arena_strategy: null }), 'throwing-getItem'), {}, 'getItem throws while scanning for the session: nothing set');
});

test('H7. data-strat and data-strat-none are never both set, across a spread of cached values', () => {
  const values: unknown[] = [null, '', 'ema_stack', 'no_such_strategy', 0, false, [], {}, undefined];
  for (const v of values) {
    const a = run(withSettings(v === undefined ? {} : { arena_strategy: v }));
    assert.equal('data-strat' in a && 'data-strat-none' in a, false, `both set for arena_strategy=${JSON.stringify(v)}`);
  }
  /* an unknown but truthy string id is still treated as "has a strategy" (StrategyPanel corrects it once the settings load) */
  assert.deepEqual(run(withSettings({ arena_strategy: 'no_such_strategy' })), { 'data-sess': '1', 'data-strat': '1' });
});

test('H8. the CSS rule the hint feeds: the signed-in reserve is the rule data-strat-none (and data-strat) end, and nothing styles [data-strat-none] to hide anything', () => {
  const css = read('app/globals.css');
  assert.ok(/html\[data-sess="1"\]:not\(\[data-strat\]\):not\(\[data-strat-none\]\)\s+\.strat-call-host\s*\{\s*min-height:/.test(css), 'the signed-in reserve rule no longer ends on data-strat / data-strat-none');
  const rules = css.split('\n').filter((l) => /\[data-strat-none\]/.test(l) && !/^\s*\/\*/.test(l));
  assert.equal(rules.length, 1, `data-strat-none is used by more than the one reserve rule: ${rules.join(' | ').slice(0, 300)}`);
  assert.equal(/\[data-strat-none\][^{]*\{[^}]*(display\s*:\s*none|visibility\s*:\s*hidden)/.test(css), false, 'data-strat-none hides something');
});

test('H9. StrategyPanel still ends the guess: it sets data-strat-none once settings loaded with no strategy, and removes it when a strategy is picked', () => {
  const s = read('components/StrategyPanel.tsx');
  assert.ok(/if \(pickedStrategy\) \{ h\.removeAttribute\('data-strat-none'\); return; \}/.test(s), 'a loaded strategy no longer removes a wrong data-strat-none guess');
  assert.ok(/h\.removeAttribute\('data-strat'\);\s*h\.setAttribute\('data-strat-none', '1'\);/.test(s), 'no strategy after load no longer sets data-strat-none');
  assert.ok(/if \(!loaded\) return;/.test(s), 'the correction runs before the settings have loaded');
});
