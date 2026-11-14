import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { AI_TOOL_LIMITS, boundedString } from '../lib/aiInputLimits.ts';
import { TEXT_LIMITS } from '../lib/ownRowLimits.ts';

/* QA's cells for #2322 (input validation from the #1413 audit). The routes need a signed-in session and a database, so the route cells are SOURCE guards that pin each rule's exact bound, enum and status code; the pure
 * helper is exercised directly. NOT exercised: the routes answering 400 over HTTP (each needs an authenticated request); QA's PR body list of bad inputs is the live script for that. Expectations are the PR text. */
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const route = (name: string) => code(read(`app/api/${name}/route.ts`));

test('V1. the AI tool limits are the numbers the PR states', () => {
  assert.deepEqual({ ...AI_TOOL_LIMITS }, { text: 4000, analysis: 20000, assumptions: 20, assumption: 500, symbol: 20, shortField: 40 });
});
test('V2. boundedString: a string up to the limit is returned trimmed, one char over is refused, non-strings are refused', () => {
  assert.equal(boundedString('a'.repeat(4000), 4000)!.length, 4000); assert.equal(boundedString('a'.repeat(4001), 4000), null);
  assert.equal(boundedString('  hi  ', 10), 'hi'); assert.equal(boundedString('', 10), '');
  for (const v of [42, null, undefined, {}, [], true, ['a']]) assert.equal(boundedString(v, 10), null, String(v));
});

test('V3. price-alerts POST and PATCH: direction is above|below, the price a finite number above zero, a bad JSON body is 400 (counted in both handlers)', () => {
  const s = route('price-alerts');
  assert.equal((s.match(/direction !== 'above' && (body\.)?direction !== 'below'|direction !== 'above' && direction !== 'below'/g) || []).length, 2, 'direction enum in both POST and PATCH');
  assert.equal((s.match(/!Number\.isFinite\((targetNum|n)\) \|\| (targetNum|n) <= 0/g) || []).length, 2, 'finite positive price in both');
  /* #2344: the body is read through readJsonCapped (a size cap, 413 over it); a non-JSON body still comes back as value null and is the same 400. */
  assert.equal((s.match(/readJsonCapped\(req, BODY_CAPS\.priceAlerts\)/g) || []).length, 2, 'the body is read through the capped reader in both POST and PATCH');
  assert.equal((s.match(/Send a JSON body\./g) || []).length, 2, 'a non-JSON body is a 400 in both');
  assert.equal((s.match(/req\.json\(\)/g) || []).length, 0, 'no uncapped read is left');
  assert.ok((s.match(/status: 400/g) || []).length >= 6, 'each refusal is a 400');
  assert.match(s, /target_price: targetNum/, 'the validated number is what is inserted, not parseFloat of the raw value');
  assert.doesNotMatch(s, /target_price: parseFloat\(target_price\)/);
});

test('V4. thesis-check: every field type-checked and capped (symbol 20, direction/entryDate 40, thesis 4000, 20 assumptions of 500)', () => {
  const s = route('thesis-check');
  for (const frag of ['symbol.length > AI_TOOL_LIMITS.symbol', 'direction.length > AI_TOOL_LIMITS.shortField', 'thesisText.length > AI_TOOL_LIMITS.text', 'entryDate.length > AI_TOOL_LIMITS.shortField', 'assumptions.length > AI_TOOL_LIMITS.assumptions', 'a.length > AI_TOOL_LIMITS.assumption', '!Array.isArray(assumptions)']) assert.ok(s.includes(frag), frag);
  assert.match(s, /'INVALID_INPUT'/); assert.match(s, /status: 400/);
});
test('V5. strategy-research and pine-script: description text-typed and capped at 4000; pine-script analysis capped at 20000; over the cap is 400', () => {
  const sr = route('strategy-research'); const pine = route('pine-script');
  assert.ok(sr.includes("typeof body.description !== 'string'") && sr.includes('description.length > AI_TOOL_LIMITS.text'));
  assert.ok(pine.includes("typeof body.description !== 'string'") && pine.includes("typeof body.analysisText !== 'string'") && pine.includes('description.length > AI_TOOL_LIMITS.text') && pine.includes('analysisText.length > AI_TOOL_LIMITS.analysis'));
  for (const s of [sr, pine]) assert.match(s, /status: 400/);
});

test('V6. hypotheses PATCH: same types and limits as POST (TEXT_LIMITS), status in exactly the four values the database check allows', () => {
  const s = route('hypotheses/[id]');
  for (const frag of ['TEXT_LIMITS.hypothesisTitle', 'TEXT_LIMITS.hypothesis', 'TEXT_LIMITS.criteriaCount', 'TEXT_LIMITS.criterion']) assert.ok(s.includes(frag), frag);
  assert.ok(s.includes("['active', 'confirmed', 'disconfirmed', 'expired'].includes(update.status as string)"));
  assert.ok(TEXT_LIMITS.criteriaCount > 0 && TEXT_LIMITS.criterion > 0, 'the limits it reads exist');
  // the four values must equal the database's CHECK on hypotheses.status in the migrations
  const dir = new URL('../supabase/migrations/', import.meta.url); let found = ''; for (const f of readdirSync(dir)) { const t = readFileSync(new URL(f, dir), 'utf8'); const m = /check \(status = any \(array\[([^\]]*)\]\)\)/i.exec(t); if (m && /disconfirmed/.test(m[1])) found = m[1]; }
  assert.ok(found, 'could not find the hypotheses status CHECK in the migrations');
  assert.deepEqual([...found.matchAll(/'([a-z_]+)'/g)].map(x => x[1]).sort(), ['active', 'confirmed', 'disconfirmed', 'expired']);
});

test('V7. onchain: a price outside (0, 10M) or not finite is ignored (0), so an absurd value cannot reach the AI prompt or the shared cache key', () => {
  const s = route('onchain');
  assert.match(s, /Number\.isFinite\(priceIn\) && priceIn > 0 && priceIn < 10_000_000 \? priceIn : 0/);
  assert.doesNotMatch(s, /const btcPrice = parseFloat\(req\.nextUrl\.searchParams\.get\('price'\) \?\? '0'\) \|\| 0;/, 'the old unbounded read is back');
});

test('V8. grok: a non-JSON body is caught and answers 400 instead of a 500', () => {
  const s = route('grok'); assert.ok(s.includes('req.json()') && /catch/.test(s.slice(s.indexOf('req.json()'), s.indexOf('req.json()') + 400)));
});
