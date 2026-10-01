/* #1347 items 9, 10 and 11, fixed by #1490 (merged to dev as 83286c95). Each place collapsed "we cannot
 * tell" into a confident answer:
 *
 *   Item 9   app/arena/page.tsx: the "you changed your indicators since this read" banner. On a cold load
 *            `strategySelection` is [] until the account's saved selection is seeded, so a cached read made
 *            with ['ema'] was compared against [] and the banner claimed a change the trader never made. A
 *            cache entry saved before `selectionAtAnalysis` existed read as "computed with no selection"
 *            (`?? []`). A second, block-local copy of the check inside the signal card shadowed the
 *            page-level one, without either guard.
 *   Item 10  components/SettingsProvider.tsx: a PATCH /api/settings answered 200 without the accepted /
 *            rejected lists (`{}`, an error page, a proxy body) defaulted both to [] and reported `saved`
 *            for a write nobody acknowledged.
 *   Item 11  app/arena/page.tsx: a chart alert line carries no coin. Switch BTC -> ETH with
 *            GET /api/price-alerts failing and BTC's lines stayed on the ETH chart at BTC's prices.
 *   Item 11  components/KLineProChart.tsx: `indicators` was optional with `?? []`, so a caller that forgot
 *            it looked the same as a trader who selected nothing. PM ruling 2026-09-19: required.
 *
 * WHAT THESE TESTS ARE. The decisions live inside component closures, and this repo has no DOM test
 * library. Three of them are self-contained enough to run anyway: the test cuts the expression or
 * function out of the CURRENT source by anchor, strips its types with the TypeScript compiler, and calls
 * it with stand-in inputs (B1-B3, C1-C2, D1-D3). The real lib/retryWithBackoff.ts drives C1-C2. The rest
 * are source pins. None of this renders a page. Dev's PR lists item 9's cold-load banner and item 11's
 * canvas lines as read-verified only, and these tests do not change that.
 *
 * E3 is a compile-time pin. node --test strips types, so the project tsc (which includes __tests__/*.mts)
 * enforces it, not this runner.
 *
 * MUTATION CHECK, 2026-10-01: each fix was put back to its pre-#1490 shape one at a time. Every test
 * named here went red, and the file was restored after each run:
 *   IIFE guard removed, `?? []` restored        -> B1, B2
 *   setSelectionSeeded(true) removed            -> B5
 *   block-local selectionChanged copy restored  -> B4
 *   `accepted ?? []` / `rejected ?? []` restored -> C1, C2
 *   coin-change clear + success-path ref removed -> D1, D3
 *   local-create ref tag removed                -> D4
 *   `indicators?:` + `indicators ?? []`         -> E1, E2, and tsc on E3
 * All three files at 83286c95^1 (before #1490): 11 red. The 7 that stay green are the CONTROL and PREMISE
 * tests (B3, C3, C4, C5, D2, D5, E3 at run time), which must hold before and after the fix.
 *
 * `compile` runs text cut from this repo's own source files, the same trust as importing them. It never
 * evaluates input from outside the repo. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { retryWithBackoff } from '../lib/retryWithBackoff.ts';
import type KLineProChart from '../components/KLineProChart.tsx';

const ARENA = 'app/arena/page.tsx';
const PROVIDER = 'components/SettingsProvider.tsx';
const CHART = 'components/KLineProChart.tsx';
const ROUTE = 'app/api/settings/route.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/^﻿/, '').split(/\r?\n/).join('\n');
/* Block comments and whole-line `//` comments only: a trailing `//` would also eat URLs inside strings. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function anchorOnce(src: string, needle: string, label: string): number {
  const n = src.split(needle).length - 1;
  assert.equal(n, 1, `${label}: anchor occurs ${n} time(s), expected exactly 1 - re-read the current source`);
  return src.indexOf(needle);
}

/** The text strictly between the FIRST `start` and the first `end` after it. */
function between(src: string, start: string, end: string, label: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `CONTROL: ${label}: start anchor not found - re-derive this test from the current source`);
  const b = src.indexOf(end, a + start.length);
  assert.ok(b >= 0, `CONTROL: ${label}: end anchor not found after the start - re-derive this test from the current source`);
  return src.slice(a + start.length, b);
}

/** Wraps a TypeScript function body in `function (params) { ... }`, strips its types, returns it callable. */
function compile<F>(params: string[], body: string, label: string): F {
  const out = ts.transpileModule(`(function (${params.join(', ')}) {\n${body}\n})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
  });
  assert.equal(out.diagnostics?.length ?? 0, 0, `CONTROL: ${label} no longer transpiles on its own: ${(out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join(' | ')}`);
  return new Function(`return ${out.outputText.trim().replace(/;$/, '')}`)() as F;
}

/* ══ Item 9: the stale-selection banner ═════════════════════════════════════════════════════════════════ */

type CacheEntryLike = { selectionAtAnalysis?: readonly string[] } | null;
type SelectionChanged = (selectionSeeded: boolean, cacheEntry: CacheEntryLike, strategySelection: readonly string[]) => boolean;

/** The page-level `selectionChanged` IIFE body, run as a function of the three values it reads. */
function selectionChanged(): SelectionChanged {
  const body = between(read(ARENA), 'const selectionChanged = (() => {', '\n  })();', 'the page-level selectionChanged IIFE');
  return compile<SelectionChanged>(['selectionSeeded', 'cacheEntry', 'strategySelection'], body, 'the selectionChanged IIFE');
}

test('B1. cold load: before the saved selection is read, a cached read made WITH indicators does not claim the trader changed them', () => {
  const changed = selectionChanged();
  assert.equal(changed(false, { selectionAtAnalysis: ['ema'] }, []), false,
    'the banner says "you changed your indicators" while strategySelection is still the [] placeholder - #1347 item 9');
  assert.equal(changed(false, { selectionAtAnalysis: ['ema', 'rsi'] }, ['ema']), false,
    'an unseeded selection must never be compared at all, whatever it holds');
});

test('B2. a cache entry saved before selectionAtAnalysis existed is UNKNOWN, not "computed with no selection"', () => {
  const changed = selectionChanged();
  assert.equal(changed(true, { }, ['ema']), false,
    'a legacy entry with no selectionAtAnalysis was read as [] and compared against a real selection - it recorded nothing, so it cannot claim a change');
  assert.equal(changed(true, { selectionAtAnalysis: undefined }, ['ema', 'rsi']), false);
  assert.equal(changed(true, null, ['ema']), false, 'no cached read for this coin was compared as a read made with no indicators');
});

test('B3. CONTROL: once seeded, a real comparison still says "changed" - the guard must not silence the banner for good', () => {
  const changed = selectionChanged();
  assert.equal(changed(true, { selectionAtAnalysis: ['ema'] }, ['ema', 'rsi']), true, 'adding an indicator after the read is a change');
  assert.equal(changed(true, { selectionAtAnalysis: ['ema'] }, []), true, 'clearing every indicator after the read is a change - an account seeded with nothing is a real answer');
  assert.equal(changed(true, { selectionAtAnalysis: ['rsi', 'ema'] }, ['ema', 'rsi']), false, 'the same indicators in a different click order is not a change');
  assert.equal(changed(true, { selectionAtAnalysis: [] }, []), false);
});

test('B4. there is ONE selectionChanged on the page - the signal card\'s own copy shadowed it without the guard', () => {
  const src = code(read(ARENA));
  anchorOnce(src, 'const selectionChanged =', `the selectionChanged declaration in ${ARENA}`);
  /* The card and the Ask-AI prompt read the page-level value. If a second declaration comes back, these
     readers silently switch to whichever is in scope. */
  assert.ok((src.match(/\{selectionChanged && \(/g) ?? []).length >= 2, 'CONTROL: the stale banners no longer read `selectionChanged` - re-derive this test');
});

test('B5. the seed marks the selection known in the same effect run that sets it, unconditionally, and only after settings are ready', () => {
  const src = code(read(ARENA));
  anchorOnce(src, 'const [selectionSeeded, setSelectionSeeded] = useState(false);', 'selectionSeeded starts false');
  const calls = src.match(/setSelectionSeeded\([^)]*\)/g) ?? [];
  assert.deepEqual(calls, ['setSelectionSeeded(true)'],
    'setSelectionSeeded is called somewhere other than the seed, or not at all - without it the banner can never show; with a second call it can show before the seed');
  const gate = anchorOnce(src, "if (settingsLoadStatus !== 'ready') return;\n    if (arenaInitRef.current) return;", 'the seed effect\'s ready gate');
  const seedSel = anchorOnce(src, 'if (settings.strategy_selection) setStrategySelection(settings.strategy_selection);', 'the selection seed');
  const seeded = src.indexOf('setSelectionSeeded(true)');
  const deps = anchorOnce(src, '}, [settingsLoadStatus, settings.default_coin, settings.default_tf, settings.strategy_selection, settings.strategy_params]);', 'the seed effect\'s deps');
  assert.ok(gate < seedSel && seedSel < seeded && seeded < deps,
    'setSelectionSeeded(true) is not inside the seed effect after the ready gate - a failed settings read must leave it false so the banner never claims a change');
  assert.match(src, /^\s*setSelectionSeeded\(true\);/m,
    'setSelectionSeeded(true) is conditional - an account with NO saved selection must be seeded too, or its banner never shows');
});

/* ══ Item 10: a 200 that confirms nothing is not a save ═════════════════════════════════════════════════ */

type AttemptResult = { failed: true } | { failed: false; accepted: string[]; rejected: string[]; settings: Record<string, unknown> | null };
type AttemptSave = (n: number) => Promise<AttemptResult>;
type FakeResponse = { ok: boolean; json: () => Promise<unknown> };

const provider = read(PROVIDER);
const MAX_ATTEMPTS = Number(provider.match(/const SETTINGS_SAVE_MAX_ATTEMPTS = (\d+);/)?.[1]);

/** The provider's own `attemptSave`, driven by the real retryWithBackoff with the provider's attempt count. */
async function save(responses: Array<FakeResponse | 'throw'>) {
  const body = between(provider, '    type AttemptResult =', '\n    const { result } = await retryWithBackoff(attemptSave, {', 'attemptSave in flushToDb');
  const make = compile<(getAuthToken: () => Promise<string>, partial: object, fieldUpdatedAtRef: { current: Record<string, string> }, fetch: () => Promise<FakeResponse>) => AttemptSave>(
    ['getAuthToken', 'partial', 'fieldUpdatedAtRef', 'fetch'], `type AttemptResult =${body}\nreturn attemptSave;`, 'attemptSave');
  let i = 0;
  const fetchStub = async () => { const r = responses[Math.min(i++, responses.length - 1)]; if (r === 'throw') throw new TypeError('Failed to fetch'); return r; };
  const attemptSave = make(async () => 'token', { account_size: 1000 }, { current: {} }, fetchStub);
  const outcome = await retryWithBackoff(attemptSave, { maxAttempts: MAX_ATTEMPTS, backoffMs: [0, 0, 0, 0, 0] });
  return { ...outcome, fetches: i };
}
const ok = (body: unknown): FakeResponse => ({ ok: true, json: async () => body });
const notJson: FakeResponse = { ok: true, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } };

test('C1. a 200 answered with {} is a FAILED attempt: retried, and still failed after every attempt - so the toast reads error, never saved', async () => {
  assert.ok(MAX_ATTEMPTS >= 2, `CONTROL: SETTINGS_SAVE_MAX_ATTEMPTS not found or below 2 in ${PROVIDER}`);
  const empty = await save([ok({})]);
  assert.equal(empty.result.failed, true, 'a 200 {} reports a successful save that nothing acknowledged - #1347 item 10');
  assert.equal(empty.fetches, MAX_ATTEMPTS, 'a 200 {} was not retried');
  for (const body of [{ ok: true }, { accepted: ['account_size'] }, { rejected: [] }, { accepted: 'account_size', rejected: [] }]) {
    const r = await save([ok(body)]);
    assert.equal(r.result.failed, true, `a 200 with ${JSON.stringify(body)} counted as a save - both lists must be real arrays`);
  }
});

test('C2. a 200 {} followed by a real answer recovers on the retry - the guard spends an attempt, it does not end the save', async () => {
  const r = await save([ok({}), ok({ ok: true, accepted: ['account_size'], rejected: [], settings: null })]);
  assert.equal(r.result.failed, false);
  assert.equal(r.attempts, 2);
});

test('C3. CONTROL: a well-formed answer is still a save, with its lists passed through untouched', async () => {
  const saved = await save([ok({ ok: true, accepted: ['account_size'], rejected: [], settings: { account_size: 1000 } })]);
  assert.equal(saved.result.failed, false, 'a well-formed save now reads as failed - the guard is too strict');
  assert.equal(saved.attempts, 1);
  assert.deepEqual(saved.result.failed ? null : [saved.result.accepted, saved.result.rejected], [['account_size'], []]);
  const lost = await save([ok({ ok: true, accepted: [], rejected: ['account_size'], settings: { account_size: 5 } })]);
  assert.equal(lost.result.failed, false, 'a save that lost its field to another device is a conflict (#1285), not a failure');
  for (const bad of [{ ok: false, json: async () => ({ error: 'x' }) }, notJson, 'throw' as const]) {
    assert.equal((await save([bad])).result.failed, true, 'a non-OK, non-JSON or thrown response must stay a failed attempt');
  }
});

test('C4. the status follows the attempt: saved/conflict only on a non-failed result, error otherwise', () => {
  const src = code(provider);
  const retry = anchorOnce(src, 'const { result } = await retryWithBackoff(attemptSave, {', 'the retry call');
  const success = anchorOnce(src, 'if (!result.failed) {', 'the success branch');
  const saved = anchorOnce(src, "setSaveStatus(result.rejected.length > 0 ? 'conflict' : 'saved');", 'the saved/conflict status');
  const error = anchorOnce(src, "setSaveStatus('error');", 'the error status');
  assert.ok(retry < success && success < saved && saved < error, 'the saved/conflict/error statuses are no longer chosen by result.failed in this order');
});

test('C5. PREMISE: the route answers EVERY successful save with both lists - so requiring them cannot fail a real save', () => {
  const src = code(read(ROUTE));
  const patch = src.slice(anchorOnce(src, 'export async function PATCH(', 'the PATCH handler'));
  const responses = patch.match(/NextResponse\.json\([^;]*\);/g) ?? [];
  const success = responses.filter((r) => !/status:/.test(r));
  assert.equal(success.length, 2, `CONTROL: expected the two 200 answers in ${ROUTE} (nothing accepted / written), found ${success.length}: ${success.join(' | ')}`);
  for (const r of success) assert.match(r, /\baccepted\b[\s\S]*\brejected\b/, `a 200 from the route lacks a list, so the provider would now treat a real save as failed: ${r}`);
});

/* ══ Item 11: alert lines belong to a coin ═══════════════════════════════════════════════════════════════ */

type Line = { id: string; target_price: number };
type SetLines = (v: Line[] | ((prev: Line[]) => Line[])) => void;
type AlertEffect = (authLoading: boolean, user: object | null, selectedCoin: string, chartAlertsCoinRef: { current: string | null },
  setChartAlerts: SetLines, getAuthToken: () => Promise<string>, fetch: () => Promise<FakeResponse>) => (() => void) | undefined;

/** The Arena's "fetch alerts for the selected coin" effect body, run with stand-ins for what it closes over. */
function alertEffect(): AlertEffect {
  const src = read(ARENA);
  const at = anchorOnce(src, "fetch('/api/price-alerts', { headers:", 'the chart-lines GET');
  const start = src.lastIndexOf('useEffect(() => {', at);
  const end = src.indexOf('\n  }, [selectedCoin, user, authLoading]);', at);
  assert.ok(start >= 0 && end > at, 'CONTROL: the chart-lines effect no longer wraps the GET with these deps - re-derive this test');
  return compile<AlertEffect>(['authLoading', 'user', 'selectedCoin', 'chartAlertsCoinRef', 'setChartAlerts', 'getAuthToken', 'fetch'],
    src.slice(start + 'useEffect(() => {'.length, end), 'the chart-lines effect');
}

const SERVER = [
  { id: 'btc-1', coin: 'btc', target_price: 70000, direction: 'above' },
  { id: 'eth-1', coin: 'eth', target_price: 3000, direction: 'below' },
];
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

/** One chart: re-runs the effect the way React does on a dep change (cleanup, then the new run). */
function chart() {
  const effect = alertEffect();
  const ref = { current: null as string | null };
  let lines: Line[] = [];
  let cleanup: (() => void) | undefined;
  const setChartAlerts: SetLines = (v) => { lines = typeof v === 'function' ? v(lines) : v; };
  return {
    ref,
    ids: () => lines.map((l) => l.id),
    push: (l: Line) => setChartAlerts((prev) => [...prev, l]),
    async show(coin: string, fetchOk: boolean) {
      cleanup?.();
      const fetchStub = async (): Promise<FakeResponse> => (fetchOk ? ok({ alerts: SERVER }) : { ok: false, json: async () => ({ error: 'upstream' }) });
      cleanup = effect(false, { id: 'user-1' }, coin, ref, setChartAlerts, async () => 'token', fetchStub);
      await flush();
    },
  };
}

test('D1. switching BTC -> ETH while the alerts fetch fails leaves NO BTC line on the ETH chart', async () => {
  const c = chart();
  await c.show('btc', true);
  assert.deepEqual(c.ids(), ['btc-1'], 'CONTROL: the BTC chart did not get its own line - the harness is not exercising the effect');
  await c.show('eth', false);
  assert.deepEqual(c.ids(), [], 'BTC\'s alert line is still drawn on the ETH chart, at BTC\'s price - #1347 item 11');
});

test('D2. CONTROL: the SAME coin keeps its last known lines through a failed refetch - no flicker on a token refresh', async () => {
  const c = chart();
  await c.show('btc', true);
  await c.show('btc', false);
  assert.deepEqual(c.ids(), ['btc-1'], 'a failed same-coin refetch wiped lines that were still correct');
});

test('D3. switching back with the fetch working brings the coin\'s own lines back, and only its own', async () => {
  const c = chart();
  await c.show('btc', true);
  await c.show('eth', false);
  await c.show('btc', true);
  assert.deepEqual(c.ids(), ['btc-1']);
  await c.show('eth', true);
  assert.deepEqual(c.ids(), ['eth-1'], 'the ETH chart shows a line that is not an ETH alert');
  assert.equal(c.ref.current, 'eth', 'a successful load did not record which coin the lines belong to');
});

test('D4. an alert created on screen is tagged with the coin on screen, before its line is added', () => {
  /* Why it matters: with ETH's GET failing, the ref is null. A line created there without the tag reads as
     "another coin's" on the next same-coin run (a token refresh changes `user`) and is wiped. D5 runs that. */
  anchorOnce(code(read(ARENA)),
    'chartAlertsCoinRef.current = selectedCoin;\n      setChartAlerts(prev => [...prev, { id: alert.id,',
    'the create path\'s coin tag directly before it appends the new line');
});

test('D5. a line created after a failed load survives the next same-coin run once it carries the coin tag', async () => {
  const c = chart();
  await c.show('eth', false);
  c.ref.current = 'eth'; // what D4's line does
  c.push({ id: 'eth-new', target_price: 3100 });
  await c.show('eth', false);
  assert.deepEqual(c.ids(), ['eth-new'], 'the alert the trader just created disappeared from the chart on a same-coin refetch failure');
});

/* ══ Item 11: KLineProChart's indicators prop is required ═══════════════════════════════════════════════ */

test('E1. Props declares indicators as required - "forgot to pass it" must not look like "selected nothing"', () => {
  const lines = code(read(CHART)).match(/^\s*indicators(\??):\s*readonly string\[\];/gm) ?? [];
  assert.equal(lines.length, 1, `CONTROL: expected one indicators prop in ${CHART}, found ${lines.length}`);
  assert.doesNotMatch(lines[0], /indicators\?:/, 'indicators is optional again - #1347 item 11, PM ruling 2026-09-19');
});

test('E2. the sync effect reads indicators as given - no `?? []` fallback that would hide a missing prop', () => {
  const src = code(read(CHART));
  anchorOnce(src, 'for (const id of indicators) {', 'the sync loop over indicators');
  assert.doesNotMatch(src, /indicators\s*\?\?/, 'an `indicators ?? ...` fallback is back');
  assert.match(code(read(ARENA)), /<KLineProChart [^>]*\bindicators=\{strategySelection\}/, 'CONTROL: the one caller no longer passes the strategy selection');
});

type ChartProps = Parameters<typeof KLineProChart>[0];
/** true only when a props object without `indicators` is not assignable to the props - i.e. it is required. */
type IndicatorsRequired = Partial<Pick<ChartProps, 'indicators'>> extends Pick<ChartProps, 'indicators'> ? false : true;

test('E3. COMPILE-TIME: KLineProChart\'s props make indicators required (enforced by tsc on this file, not by node --test)', () => {
  const indicatorsRequired: IndicatorsRequired = true;
  assert.equal(indicatorsRequired, true);
});
