/* #1810 item 2 / #1821: THE STATUS PAGE MUST NEVER FAIL GREEN.
 *
 * A status page whose failure mode is "Operational" is worse than no status page, because it is
 * believed. Dev Team named this as the assertion worth the most on #1821 and wrote the page to
 * match; this is the gate that keeps it that way.
 *
 * WHAT THIS TESTS AND HOW. `read()` and `exchangeState()` in the page are pure functions of the
 * parsed /api/health body, so the behavioural half is REAL: both are extracted from the source,
 * transpiled, and called with actual bodies. Nothing here matches a regex against what the code
 * looks like, except the three things that genuinely live outside those functions - the
 * UNREACHABLE constant, the `.catch` that installs it, and the colour table.
 *
 * WHY THE TRUTHY CASES MATTER MOST. `ok: 'true'`, `degraded: 'false'` and `degraded: 0` are the
 * inputs a loose check would wave through. A body shaped slightly wrong is exactly what a broken
 * upstream sends, and `if (body.ok)` instead of `if (body.ok === true)` would turn a malformed
 * answer into a green light. Every one of those is asserted to land on `unknown`.
 *
 * SEQUENCING: this test requires the page from #1821. Until that merges it FAILS, naming the PR,
 * rather than passing vacuously - a test that goes green when its subject does not exist is the
 * silent-detector shape this repo keeps getting caught by. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ROOT, appPathOrNull } from './_appPath.mts';

type State = 'operational' | 'degraded' | 'slow' | 'down' | 'unknown' | 'checking';
interface Reading {
  site: State; database: State; bybit: State; binance: State;
  checkedAt: string | null; reachable: boolean;
}
type Read = (body: Record<string, unknown>) => Reading;
type ExchangeState = (raw: unknown) => State;

/* ══ THE SUBJECT MUST EXIST ═════════════════════════════════════════════════════════════════════ */

const REL = appPathOrNull('app/status/page.tsx');
assert.ok(
  REL,
  'app/status/page.tsx does not exist in any route group. It arrives with #1821 ' +
  '("the five missing pages"); this test must merge AFTER that PR, not before. Failing here is ' +
  'the dependency reporting itself rather than the test quietly passing on a page that is absent.',
);
const SRC = readFileSync(path.join(ROOT, REL), 'utf8').replace(/^﻿/, '');

/* ══ EXTRACTING THE TWO PURE FUNCTIONS ══════════════════════════════════════════════════════════ */

/**
 * Pulls the named top-level function declarations out of the page and returns them callable.
 * They are lifted together into one scope because `read` calls `exchangeState`.
 *
 * ON THE `new Function` BELOW, because a scanner will flag it and should: the string it compiles is
 * this repository's own source file, read from disk by a test. That is the point - executing the
 * real code is what makes these assertions behavioural rather than a regex over what the code looks
 * like, and `__tests__/arenaHonestStates.test.mts` already does the same. It is NOT a pattern for
 * product code: there is no request, no user and no network anywhere near it, and the moment any of
 * those could reach the compiled string this stops being safe.
 */
function extract(names: readonly string[]): Record<string, unknown> {
  const sf = ts.createSourceFile(REL!, SRC, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const found: Record<string, string> = {};
  for (const node of sf.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      found[node.name.text] = node.getFullText(sf);
    }
  }
  for (const n of names) {
    assert.ok(
      found[n],
      `CONTROL: no top-level \`function ${n}\` in ${REL}. If the page was refactored, this test is ` +
      'measuring nothing and must be rewritten against whatever replaced it - do not delete this ' +
      'assertion to make the suite green.',
    );
  }
  const body = names.map((n) => found[n]).join('\n') + `\nreturn { ${names.join(', ')} };`;
  const out = ts.transpileModule(`(function () {\n${body}\n})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
  });
  assert.equal(
    out.diagnostics?.length ?? 0, 0,
    `CONTROL: the extracted functions no longer transpile alone: ${(out.diagnostics ?? [])
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join(' | ')}`,
  );
  return (new Function(`return ${out.outputText.trim().replace(/;$/, '')}`)() as () => Record<string, unknown>)();
}

const api = extract(['exchangeState', 'read']);
const exchangeState = api.exchangeState as ExchangeState;
const read = api.read as Read;

/* ══ N1: THE POSITIVE CONTROL ═══════════════════════════════════════════════════════════════════ */

test('N1. CONTROL: the extracted functions can reach `operational`, so the unknown cases are not vacuous', () => {
  assert.equal(read({ ok: true }).database, 'operational',
    'a body saying ok:true must read as operational - if this fails, every "must be unknown" ' +
    'assertion below is passing for the wrong reason');
  assert.equal(exchangeState({ degraded: false }), 'operational');
});

/* ══ N2: AN UNREACHABLE ENDPOINT - THE ASSERTION DEV ASKED FOR ══════════════════════════════════ */

test('N2. the unreachable reading is all-unknown and contains no operational state', () => {
  const m = /const\s+UNREACHABLE\s*:\s*Reading\s*=\s*\{([\s\S]*?)\};/.exec(SRC);
  assert.ok(m, 'no `const UNREACHABLE: Reading = { ... }` in the page - the catch path has no constant');
  const literal = m[1];

  for (const field of ['site', 'database', 'bybit', 'binance']) {
    const f = new RegExp(`\\b${field}\\s*:\\s*'([a-z]+)'`).exec(literal);
    assert.ok(f, `UNREACHABLE does not set ${field}`);
    assert.equal(f[1], 'unknown',
      `UNREACHABLE.${field} is '${f[1]}'. A failed fetch must read unknown - never operational, ` +
      'and never a state drawn in a healthy colour.');
  }
  assert.doesNotMatch(literal, /operational/,
    'the word operational appears in the UNREACHABLE literal; the failure path must not be able to ' +
    'report anything healthy');
  assert.match(literal, /reachable\s*:\s*false/, 'UNREACHABLE must record reachable: false');
  assert.match(literal, /checkedAt\s*:\s*null/, 'UNREACHABLE must have no timestamp');
});

test('N3. the health fetch installs that reading on failure, and refuses a cached answer', () => {
  assert.match(
    SRC, /\.catch\(\s*\(\s*\)\s*=>\s*setReading\(\s*UNREACHABLE\s*\)\s*\)/,
    'the /api/health chain has no `.catch(() => setReading(UNREACHABLE))`. Without it a rejected ' +
    'fetch leaves the previous reading on screen, which on a status page means showing the last ' +
    'known-good state as if it were current.',
  );
  assert.match(
    SRC, /fetch\(\s*'\/api\/health'\s*,\s*\{[^}]*cache:\s*'no-store'/,
    "the health read must send cache: 'no-store' - a cached answer is the one thing a status page " +
    'must never serve',
  );
});

/* ══ N4: THE DATABASE ROW, INCLUDING THE SHAPES A LOOSE CHECK WOULD WAVE THROUGH ════════════════ */

test('N4. only a literal ok:true reads as operational; every other shape is unknown, slow or down', () => {
  const cases: [string, Record<string, unknown>, State][] = [
    ['an empty body',                {},                          'unknown'],
    ['ok:true',                      { ok: true },                'operational'],
    ['ok as the STRING "true"',      { ok: 'true' },              'unknown'],
    ['ok:1',                         { ok: 1 },                   'unknown'],
    ['ok:"yes"',                     { ok: 'yes' },               'unknown'],
    ['ok:false',                     { ok: false },               'unknown'],
    ['reason db_slow',               { reason: 'db_slow' },       'slow'],
    ['reason db_error',              { reason: 'db_error' },      'down'],
    ['an unrecognised reason',       { reason: 'db_on_fire' },    'unknown'],
    ['ok:false with a slow reason',  { ok: false, reason: 'db_slow' }, 'slow'],
  ];
  for (const [label, body, want] of cases) {
    assert.equal(read(body).database, want, `${label} must read as ${want}`);
  }
});

test('N5. the site row says the site answered, and that is all it claims', () => {
  assert.equal(read({}).site, 'operational',
    'the page answering IS the site being up; this row is deliberately not inferred from the ' +
    'database result');
  assert.equal(read({}).reachable, true, 'a parsed body means the endpoint was reached');
});

/* ══ N6: THE EXCHANGE ROWS ══════════════════════════════════════════════════════════════════════ */

test('N6. an exchange is operational only on a literal degraded:false', () => {
  const cases: [string, unknown, State][] = [
    ['undefined',                 undefined,            'unknown'],
    ['null',                      null,                 'unknown'],
    ['a string',                  'degraded',           'unknown'],
    ['a number',                  0,                    'unknown'],
    ['an empty object',           {},                   'unknown'],
    ['degraded:true',             { degraded: true },   'degraded'],
    ['degraded:false',            { degraded: false },  'operational'],
    ['degraded as STRING "false"',{ degraded: 'false' }, 'unknown'],
    ['degraded:0',                { degraded: 0 },      'unknown'],
    ['degraded:null',             { degraded: null },   'unknown'],
  ];
  for (const [label, raw, want] of cases) {
    assert.equal(exchangeState(raw), want, `exchangeState(${label}) must be ${want}`);
  }
});

test('N7. a body with no or malformed exchanges block leaves both venues unknown, not healthy', () => {
  for (const body of [{}, { exchanges: 'nope' }, { exchanges: null }, { exchanges: 7 }, { ok: true }]) {
    const r = read(body as Record<string, unknown>);
    assert.equal(r.bybit, 'unknown', `bybit must be unknown for ${JSON.stringify(body)}`);
    assert.equal(r.binance, 'unknown', `binance must be unknown for ${JSON.stringify(body)}`);
  }
  /* A build whose /api/health predates the exchanges block is the real case here: ok:true and no
     exchanges key at all must still leave the venues unknown rather than inheriting the database's
     good news. */
  const old = read({ ok: true });
  assert.equal(old.database, 'operational');
  assert.equal(old.bybit, 'unknown');
  assert.equal(old.binance, 'unknown');
});

test('N8. one healthy venue does not make the other healthy', () => {
  const r = read({ exchanges: { bybit: { degraded: false } } });
  assert.equal(r.bybit, 'operational');
  assert.equal(r.binance, 'unknown');
});

/* ══ N9: THE TIMESTAMP ══════════════════════════════════════════════════════════════════════════ */

test('N9. checkedAt is kept only when it is actually a string', () => {
  assert.equal(read({ checked_at: '2026-10-30T10:00:00Z' }).checkedAt, '2026-10-30T10:00:00Z');
  for (const bad of [123, null, undefined, {}, true]) {
    assert.equal(read({ checked_at: bad } as Record<string, unknown>).checkedAt, null,
      `a non-string checked_at (${JSON.stringify(bad)}) must not be shown as a time`);
  }
});

/* ══ N10: UNKNOWN MUST NOT BE DRAWN AS HEALTHY ══════════════════════════════════════════════════ */

test('N10. the unknown and checking states are not painted in the operational colour', () => {
  const m = /const\s+STATE_COLOR\s*:\s*Record<State,\s*string>\s*=\s*\{([\s\S]*?)\};/.exec(SRC);
  assert.ok(m, 'no STATE_COLOR table in the page');
  const table = m[1];
  const colorOf = (state: string): string => {
    const f = new RegExp(`\\b${state}\\s*:\\s*'([^']+)'`).exec(table);
    assert.ok(f, `STATE_COLOR has no ${state} entry`);
    return f[1];
  };
  const operational = colorOf('operational');
  for (const state of ['unknown', 'checking']) {
    assert.notEqual(colorOf(state), operational,
      `STATE_COLOR.${state} is the same colour as operational. "We do not know" must not look like ` +
      '"it is fine" - the colour is what a reader actually reads.');
  }
  assert.notEqual(colorOf('down'), operational, 'down must not be the operational colour');
  assert.notEqual(colorOf('degraded'), operational, 'degraded must not be the operational colour');
});
