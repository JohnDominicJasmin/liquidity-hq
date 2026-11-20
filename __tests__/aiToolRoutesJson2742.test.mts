/* QA: PR #2742 (route reliability audit #1651, the AI TOOL routes): a failed AI answer is GIVEN BACK and answered as JSON, never as a bare 500 and never with the use spent.
 *
 * THE WRITTEN RULE (PR body + PM route audit 2026-11-20): (1) thesis-check, strategy-research and pine-script: a NETWORK throw refunds the use and answers 502 JSON (it used to refund and rethrow = a bare non-JSON 500); (2) all five tool routes (those three, behavioral-bias, shadow-account) and macro-context: a 2xx whose body is NOT JSON refunds and answers 502 JSON (it used to throw unhandled with the use spent);
 * (3) macro-context: an EMPTY analysis refunds and is NOT cached (it used to be a billed 200 held for 5 minutes). The refund is always the route's OWN tool counter on the reservation date. The client message never names the vendor.
 *   J1 the old shapes are gone in every route: no `.catch(async (e) => { await refundToolUsage(...); throw e; })`, no bare `const data = await res.json();`
 *   J2 the three network-throw routes: the throw becomes a value, a value that is an Error refunds THAT route's counter and answers apiError(<slug>, res, 502, 'AI service error')
 *   J3 the five tool routes: `res.json().catch(() => null)`, then `if (!data)` refunds the route's counter and answers apiError(<slug>, 'unreadable AI answer', 502, 'AI service error') BEFORE the answer is used
 *   J4 macro-context: a non-JSON 2xx and an empty analysis each give the use back BEFORE the result is returned (so nothing is cached), the refund is bound to macroContext, and the route's catch answers apiError('macro-context', e, 502, ...)
 *   J5 behaviour of the real apiError: a 502 JSON body with the generic message, no cause text, no vendor name, `refunded` only when the route passes it
 * WHAT THIS CANNOT PROVE: the routes answering a real non-JSON 2xx (needs the upstream); source pins name their premise and carry a control each. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apiError } from '../lib/apiError.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const count = (s: string, needle: string) => s.split(needle).length - 1;

const THROW_ROUTES = [['thesis-check', 'thesisCheck'], ['strategy-research', 'strategyResearch'], ['pine-script', 'pineScript']] as const;
const TOOL_ROUTES = [...THROW_ROUTES, ['behavioral-bias', 'behavioralBias'], ['shadow-account', 'shadowAccount']] as const;
const file = (slug: string) => `app/api/${slug}/route.ts`;

test('J1. the old shapes are gone from every route (and the matcher can see them)', () => {
  const OLD_THROW = /\.catch\(async \(e: unknown\) => \{ await refundToolUsage\([^)]*\); throw e; \}\)/;
  const OLD_JSON = /const data = await res\.json\(\);/;
  assert.match("}).catch(async (e: unknown) => { await refundToolUsage(authData.user.id, 'x', reservedOn); throw e; });", OLD_THROW, 'CONTROL: the old-throw matcher must match the old line');
  assert.match('  const data = await res.json();', OLD_JSON, 'CONTROL: the old-json matcher must match the old line');
  for (const [slug] of TOOL_ROUTES) { const s = read(file(slug)); assert.doesNotMatch(s, OLD_THROW, `${slug}: the refund-and-rethrow (bare 500) is back`); assert.doesNotMatch(s, OLD_JSON, `${slug}: an unguarded res.json() is back (a non-JSON 2xx throws with the use spent)`); }
  assert.doesNotMatch(read(file('macro-context')), /const aiData = await aiRes\.json\(\);/, 'macro-context: an unguarded aiRes.json() is back');
});

test('J2. a network throw refunds the route\'s own counter and answers 502 JSON (thesis-check, strategy-research, pine-script)', () => {
  for (const [slug, tool] of THROW_ROUTES) {
    const s = read(file(slug));
    assert.equal(count(s, '.catch((e: unknown) => e instanceof Error ? e : new Error(String(e)))'), 1, `${slug}: the network throw is not turned into a value exactly once`);
    const at = s.indexOf('if (res instanceof Error) {'); assert.ok(at > 0, `${slug}: nothing handles a network throw value`);
    const block = s.slice(at, at + 260);
    assert.ok(block.includes(`await refundToolUsage(authData.user.id, '${tool}', reservedOn);`), `${slug}: the network throw does not refund ${tool} (or refunds another tool's counter)`);
    assert.ok(block.includes(`return apiError('${slug}', res, 502, 'AI service error');`), `${slug}: the network throw does not answer apiError('${slug}', res, 502, 'AI service error')`);
    assert.ok(s.indexOf('if (res instanceof Error) {') < s.indexOf('res.ok'), `${slug}: the throw handler comes after the response is used`);
  }
});

test('J3. a 2xx with a body that is not JSON refunds and answers 502 JSON, before the answer is used (all five tool routes)', () => {
  for (const [slug, tool] of TOOL_ROUTES) {
    const s = read(file(slug));
    assert.equal(count(s, 'const data = await res.json().catch(() => null);'), 1, `${slug}: the body is not parsed defensively exactly once`);
    const at = s.indexOf('const data = await res.json().catch(() => null);'); const block = s.slice(at, at + 330);
    assert.ok(block.includes('if (!data) {'), `${slug}: an unparseable body is not checked`);
    assert.ok(block.includes(`await refundToolUsage(authData.user.id, '${tool}', reservedOn);`), `${slug}: the unparseable body does not refund ${tool}`);
    assert.ok(block.includes(`return apiError('${slug}', 'unreadable AI answer', 502, 'AI service error');`), `${slug}: the unparseable body does not answer apiError('${slug}', 'unreadable AI answer', 502, 'AI service error')`);
    const used = s.indexOf('data.choices', at); assert.ok(used < 0 || used > at + block.indexOf('return apiError'), `${slug}: the answer is read before the unparseable body is rejected`);
  }
});

test('J4. macro-context: a non-JSON 2xx and an empty analysis give the use back before anything is returned (so nothing is cached)', () => {
  const s = read(file('macro-context'));
  assert.ok(s.includes("const giveBack = () => refundToolUsage(authData.user.id, 'macroContext', reservedOn);"), 'the refund helper is not bound to macroContext');
  const a = s.indexOf('const aiData = await aiRes.json().catch(() => null);'); assert.ok(a > 0, 'the AI body is not parsed defensively');
  assert.ok(s.includes("if (!aiData) { await giveBack(); throw new Error('unreadable AI answer'); }"), 'a non-JSON 2xx does not refund and throw');
  const e = s.indexOf("if (!analysis.trim()) { await giveBack(); throw new Error('empty AI analysis'); }"); assert.ok(e > a, 'an EMPTY analysis does not refund and throw');
  const ret = s.indexOf('return { ...payload, analysis, missingData: missing };'); assert.ok(ret > e, 'the result is returned BEFORE the empty-analysis check (it would be cached)');
  assert.ok(s.indexOf('const analysis: string =') > a && s.indexOf('const analysis: string =') < e, 'the empty check does not read the parsed analysis');
  assert.match(s, /\} catch \(e\) \{[\s\S]{0,600}return apiError\('macro-context', e, 502, 'Request failed'\);/, 'the route catch no longer answers apiError(\'macro-context\', e, 502, ...)');
});

test('J5. the real apiError: a 502 JSON body with the generic message, no cause, no vendor; `refunded` only when passed', async () => {
  const origErr = console.error; console.error = () => {};
  try {
    const r = apiError('pine-script', new Error('upstream said: xAI Grok 500 internal at 10.0.0.3'), 502, 'AI service error');
    assert.equal(r.status, 502); const body = await r.json() as Record<string, unknown>;
    assert.deepEqual(body, { error: 'AI service error' }); assert.doesNotMatch(JSON.stringify(body), /grok|xai|10\.0\.0\.3|upstream/i, 'the body leaks the cause or the vendor');
    const withFlag = await apiError('x', 'unreadable AI answer', 502, 'AI service error', { refunded: true }).json() as Record<string, unknown>;
    assert.deepEqual(withFlag, { refunded: true, error: 'AI service error' });
    assert.equal((await apiError('x', 'y', 502, 'AI service error').json() as Record<string, unknown>).refunded, undefined, 'refunded appears without being passed');
  } finally { console.error = origErr; }
});
