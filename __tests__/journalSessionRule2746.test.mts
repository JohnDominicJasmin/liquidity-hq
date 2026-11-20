/* QA: PR #2746 (QA's #2741 pass, PM option A): a journal session rule compares the LIVE window name with the rule's session OPTION.
 *
 * THE WRITTEN RULE (Dev's list, PM 2026-11-20): the live name comes from lib/session.ts getSessionName ("NY Session", "Prime", "London Open", "Asia Session", "Pre-NY", "God Tier", "Dead Zone", "Off-peak"); a rule's value is one of the SESSIONS options ("New York", "London", "Asia", "Pre-Market", "Weekend"). ruleViolated maps the live name to the option before comparing:
 * NY Session and Prime -> New York; London Open -> London; Asia Session -> Asia; Pre-NY -> Pre-Market; God Tier -> Weekend; Dead Zone and anything else compare RAW (they match no option). Display and stored values are unchanged; every other rule field (coin, direction, setup type, leverage) is unchanged.
 *   R1 `is New York,London`: NY Session / Prime / London Open are NOT violated; Asia Session / Pre-NY / God Tier / Dead Zone / Off-peak ARE violated (the shipped "NY or London only" preset)
 *   R2 `is_not Asia`: Asia Session IS violated, NY Session is not   R3 `is Weekend`: God Tier is not violated, NY Session is   R4 every mapped pair, both operators, and a session value typed in the rule's own words ("new york") still matches
 *   R5 other fields are untouched (coin / direction / setup / leverage rules give the same answers as before), and a disabled rule is never violated
 *   R6 source: the table and the `rule.field === 'session' ? ruleSessionName(fields.session)` line, the mapping covers EVERY live name lib/session.ts can return except the two deliberately unmapped ones (a new window name must be decided), and both call sites go through ruleViolated
 * The real functions are cut out of components/TradeJournal.tsx and run on literal inputs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const tj = read('components/TradeJournal.tsx');

function braceBlock(src: string, start: number): string { let depth = 0, i = src.indexOf('{', start); const open = i; for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); } } throw new Error('unbalanced braces at ' + open); }
const tableAt = tj.indexOf('const RULE_SESSION_OF_LIVE: Record<string, string> = {'); assert.ok(tableAt > 0, 'CONTROL: RULE_SESSION_OF_LIVE was not found: the matcher lost its target');
const table = braceBlock(tj, tableAt);
const mapFn = braceBlock(tj, tj.indexOf('function ruleSessionName('));
const ruleFn = braceBlock(tj, tj.indexOf('function ruleViolated('));
// the signature spans lines with a typed parameter object: cut from the function keyword to the end of its body (braceBlock starts at the first `{`, which is the parameter type), so take everything up to the second block
const ruleStart = tj.indexOf('function ruleViolated(');
const ruleBodyStart = tj.indexOf('}): boolean {', ruleStart) + '}): boolean '.length;
const ruleFull = tj.slice(ruleStart, ruleBodyStart) + braceBlock(tj, ruleBodyStart).slice(0);
void ruleFn;

type Rule = { enabled: boolean; field: 'coin' | 'direction' | 'setup_type' | 'leverage' | 'session'; operator: 'is' | 'is_not' | 'lte' | 'gte'; value: string };
type Fields = { coin: string; direction: string; setup_type: string; leverage: number; session: string };
const wrapped = stripTypeScriptTypes(`function __cut() {\n${table}\n${mapFn}\n${ruleFull}\nreturn { ruleViolated, ruleSessionName };\n}`);
const { ruleViolated, ruleSessionName } = new Function(`${wrapped}\nreturn __cut();`)() as { ruleViolated: (r: Rule, f: Fields) => boolean; ruleSessionName: (s: string) => string };
const F = (session: string, over: Partial<Fields> = {}): Fields => ({ coin: 'BTC', direction: 'LONG', setup_type: 'Squeeze', leverage: 10, session, ...over });
const R = (operator: Rule['operator'], value: string, over: Partial<Rule> = {}): Rule => ({ enabled: true, field: 'session', operator, value, ...over });

test('R1. "NY or London only" (`is New York,London`): the NY / Prime / London windows are not violations, every other window is', () => {
  const rule = R('is', 'New York,London');
  for (const live of ['NY Session', 'Prime', 'Mon Evening', 'London Open']) assert.equal(ruleViolated(rule, F(live)), false, `${live} must satisfy "NY or London only"`);
  for (const live of ['Asia Session', 'Pre-NY', 'God Tier', 'Dead Zone', 'Off-peak']) assert.equal(ruleViolated(rule, F(live)), true, `${live} must violate "NY or London only"`);
});

test('R2/R3. `is_not Asia` and `is Weekend`', () => {
  assert.equal(ruleViolated(R('is_not', 'Asia'), F('Asia Session')), true, 'Asia Session must violate "not Asia"');
  assert.equal(ruleViolated(R('is_not', 'Asia'), F('NY Session')), false); assert.equal(ruleViolated(R('is_not', 'Asia'), F('Dead Zone')), false);
  assert.equal(ruleViolated(R('is', 'Weekend'), F('God Tier')), false, 'God Tier must satisfy "Weekend"'); assert.equal(ruleViolated(R('is', 'Weekend'), F('NY Session')), true);
});

test('R4. every mapped pair on both operators; the rule is typed in its own words (any case, spaces) and still matches', () => {
  const PAIRS: Array<[string, string]> = [['NY Session', 'New York'], ['Prime', 'New York'], ['Mon Evening', 'New York'], ['London Open', 'London'], ['Asia Session', 'Asia'], ['Pre-NY', 'Pre-Market'], ['God Tier', 'Weekend']];
  for (const [live, opt] of PAIRS) {
    assert.equal(ruleSessionName(live), opt, `${live} must map to ${opt}`);
    assert.equal(ruleViolated(R('is', opt), F(live)), false, `is ${opt} with ${live}`); assert.equal(ruleViolated(R('is_not', opt), F(live)), true, `is_not ${opt} with ${live}`);
    for (const other of ['New York', 'London', 'Asia', 'Pre-Market', 'Weekend'].filter((o) => o !== opt)) assert.equal(ruleViolated(R('is', other), F(live)), true, `is ${other} with ${live} must be a violation`);
  }
  assert.equal(ruleViolated(R('is', ' new york , LONDON '), F('NY Session')), false, 'the rule value comparison stays case- and space-insensitive');
  for (const raw of ['Dead Zone', 'Off-peak', 'Something New']) assert.equal(ruleSessionName(raw), raw, `${raw} must compare raw`);
  assert.equal(ruleViolated(R('is', 'Dead Zone'), F('Dead Zone')), false, 'a value that IS the raw name still matches itself');
});

test('R5. other fields and a disabled rule are untouched', () => {
  assert.equal(ruleViolated({ enabled: true, field: 'coin', operator: 'is', value: 'btc,eth' }, F('NY Session', { coin: 'BTC' })), false);
  assert.equal(ruleViolated({ enabled: true, field: 'coin', operator: 'is', value: 'btc,eth' }, F('NY Session', { coin: 'SOL' })), true);
  assert.equal(ruleViolated({ enabled: true, field: 'direction', operator: 'is', value: 'LONG' }, F('Asia Session', { direction: 'SHORT' })), true);
  assert.equal(ruleViolated({ enabled: true, field: 'setup_type', operator: 'is_not', value: 'Other' }, F('Asia Session', { setup_type: 'Other' })), true);
  assert.equal(ruleViolated({ enabled: true, field: 'leverage', operator: 'lte', value: '20' }, F('Prime', { leverage: 25 })), true);
  assert.equal(ruleViolated({ enabled: true, field: 'leverage', operator: 'gte', value: '5' }, F('Prime', { leverage: 3 })), true);
  assert.equal(ruleViolated({ enabled: true, field: 'leverage', operator: 'lte', value: '20' }, F('Prime', { leverage: 10 })), false);
  assert.equal(ruleViolated(R('is', 'Asia', { enabled: false }), F('NY Session')), false, 'a disabled rule must never be violated');
});

test('R6. source: the table, the call, full coverage of the live names, both call sites', () => {
  assert.match(table, /'NY Session': 'New York', 'Prime': 'New York', 'Mon Evening': 'New York', 'London Open': 'London', 'Asia Session': 'Asia', 'Pre-NY': 'Pre-Market', 'God Tier': 'Weekend'/, 'the mapping table changed: re-pin on the decision (Mon Evening -> New York was decided by PM 2026-11-20: Mon 12:00-15:00 UTC overlaps Pre-NY and NY and the rule check has only the stored name)');
  assert.ok(tj.includes("const raw = rule.field === 'session' ? ruleSessionName(fields.session) : fields[rule.field];"), 'ruleViolated does not map the session through ruleSessionName');
  const live = [...read('lib/session.ts').matchAll(/return \{ name: '([^']+)',\s+label: '/g)].map((m) => m[1]); const names = new Set([...live, 'Dead Zone', 'Off-peak']);
  assert.ok(live.length >= 6, 'CONTROL: the live window names were not found in lib/session.ts');
  const UNMAPPED = new Set(['Dead Zone', 'Off-peak']);
  const unhandled = [...names].filter((n) => !UNMAPPED.has(n) && ruleSessionName(n) === n); assert.deepEqual(unhandled, [], 'a live window name is not mapped to a rule option (and is not one of the two deliberately raw names): decide it');
  const options = new Set(['New York', 'London', 'Asia', 'Pre-Market', 'Weekend']); assert.match(tj, /const SESSIONS = \['New York', 'London', 'Asia', 'Pre-Market', 'Weekend'\];/);
  for (const [, v] of Object.entries(JSON.parse('{' + [...table.matchAll(/'([^']+)': '([^']+)'/g)].map((m) => `"${m[1]}":"${m[2]}"`).join(',') + '}') as Record<string, string>)) assert.ok(options.has(v), `the table maps to "${v}", which is not a SESSIONS option`);
  assert.equal(tj.split('ruleViolated(').length - 1, 3, 'ruleViolated must be defined once and called from exactly the two sites (live form and compliance score)');
});
