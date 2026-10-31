/* #1631 item 4 / #1833: EVERY xAI CALL MUST CARRY THE OUTPUT CAP ITS OWN ENDPOINT READS.
 *
 * THE DEFECT THIS GATES, which is why it is a gate and not a note. The two xAI endpoints take
 * DIFFERENT field names for the same thing:
 *
 *     /v1/chat/completions  reads  max_tokens
 *     /v1/responses         reads  max_output_tokens
 *
 * and each SILENTLY IGNORES the other's name. So a `/v1/responses` call carrying `max_tokens: 2000`
 * is an UNCAPPED call that looks capped in the diff, in the file, and in review. Nothing fails,
 * nothing warns, and the bill is the only instrument that notices. That is a defect a careful read
 * passes, which is the definition of something that needs a test.
 *
 * WHAT AN UNCAPPED CALL COSTS, so the ceiling below is not arbitrary: xAI documents
 * `max_output_tokens` defaulting to **128,000** when unset on `/v1/responses`
 * (https://docs.x.ai/docs/api-reference, read 2026-10-30 — PM resolved this, and read it through a
 * fetch-and-summarise rather than raw, so treat it as the vendor's figure and not as a measurement
 * of our own). Against that, the app's 2000 is a 64x reduction rather than a rounding choice.
 *
 * ALSO GATED: that a cap EXISTS at all. #1833 capped the last two uncapped calls
 * (`/api/grok-chat`'s search branch and `/api/onchain`), and the comment it deleted is the reason
 * this file exists — `app/api/grok/route.ts` claimed Deep "was the only xAI call in the app with no
 * output bound at all", which was true when written and false when read. **A count of other call
 * sites, kept in a comment, is a claim with no owner.** This test is that count, re-derived on every
 * run instead.
 *
 * It reads source and makes no calls: no network, no key, no billed tokens. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ROOT } from './_appPath.mts';

/** The vendor's own default when the field is absent — so any cap must be below it to be a cap. */
const VENDOR_UNSET_DEFAULT = 128_000;

const FIELD_FOR: Record<string, string> = {
  '/v1/chat/completions': 'max_tokens',
  '/v1/responses': 'max_output_tokens',
};
const ALL_FIELDS = Object.values(FIELD_FOR);

interface CallSite {
  file: string;
  line: number;
  endpoint: string;
  /** Property names in the JSON.stringify'd body. */
  bodyKeys: string[];
  /** The cap's value when it is a numeric literal; null when it is computed. */
  capValue: number | null;
  capField: string | null;
}

/* ══ THE PURE CORE, so the red path is proved with fixtures rather than by editing app code ══════ */

/**
 * Every xAI call site in one source file, with the body keys it sends.
 *
 * AST, NOT A REGEX. The body is an object literal inside a `JSON.stringify` inside a property of an
 * options object, and the cap can sit on any line of it — `app/api/grok-chat/route.ts:161` puts the
 * whole body on one line while `app/api/grok/route.ts:253` spreads it over ten. A line-based search
 * has to guess where one call ends and the next begins, and `app/api/grok/route.ts` holds three.
 * Reading the tree also excludes comments and strings for free, which matters here: the files
 * DISCUSS `max_tokens` in prose more often than they send it.
 */
export function callSitesIn(rel: string, src: string): CallSite[] {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out: CallSite[] = [];

  const stringOf = (node: ts.Node): string | null =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;

  const bodyObjectOf = (options: ts.Node): ts.ObjectLiteralExpression | null => {
    if (!ts.isObjectLiteralExpression(options)) return null;
    for (const prop of options.properties) {
      if (!ts.isPropertyAssignment(prop) || prop.name.getText(sf) !== 'body') continue;
      let init: ts.Expression = prop.initializer;
      /* body: JSON.stringify({ ... }) — take the first object argument. */
      if (ts.isCallExpression(init) && init.arguments.length) {
        const arg = init.arguments[0];
        if (ts.isObjectLiteralExpression(arg)) return arg;
        init = arg;
      }
      if (ts.isObjectLiteralExpression(init)) return init;
    }
    return null;
  };

  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length >= 2) {
      const url = stringOf(node.arguments[0]);
      if (url && /^https:\/\/api\.x\.ai\//.test(url)) {
        const endpoint = new URL(url).pathname;
        const body = bodyObjectOf(node.arguments[1]);
        const bodyKeys: string[] = [];
        let capValue: number | null = null;
        let capField: string | null = null;
        for (const prop of body?.properties ?? []) {
          if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue;
          const name = prop.name?.getText(sf) ?? '';
          bodyKeys.push(name);
          if (!ALL_FIELDS.includes(name)) continue;
          capField = name;
          if (ts.isPropertyAssignment(prop) && ts.isNumericLiteral(prop.initializer)) {
            capValue = Number(prop.initializer.text);
          }
        }
        out.push({
          file: rel,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          endpoint,
          bodyKeys,
          capValue,
          capField,
        });
      }
    }
    node.forEachChild(walk);
  };

  sf.forEachChild(walk);
  return out;
}

/** Call sites whose cap field does not match their endpoint, or which carry no cap at all. */
export function mismatches(sites: readonly CallSite[]): string[] {
  const bad: string[] = [];
  for (const s of sites) {
    const want = FIELD_FOR[s.endpoint];
    if (!want) continue;                                     // an endpoint this rule says nothing about
    const wrong = ALL_FIELDS.filter((f) => f !== want && s.bodyKeys.includes(f));
    if (!s.bodyKeys.includes(want)) {
      bad.push(`${s.file}:${s.line} ${s.endpoint} has no ${want}` +
        (wrong.length ? ` - it sends ${wrong.join(', ')}, which this endpoint IGNORES` : ''));
    } else if (wrong.length) {
      bad.push(`${s.file}:${s.line} ${s.endpoint} sends both ${want} and ${wrong.join(', ')}`);
    }
  }
  return bad;
}

test('X1. CONTROL: the rule catches every wrong pairing and passes the right ones', () => {
  const src = (endpoint: string, field: string | null) =>
    `const r = await xaiFetch('https://api.x.ai${endpoint}', {\n` +
    `  method: 'POST',\n` +
    `  body: JSON.stringify({ model: 'grok-4.3', input: [], ${field ? `${field}: 2000,` : ''} }),\n` +
    '});';

  /* The defect itself: the right NUMBER on the wrong FIELD. This is what the diff looks like when it
     is wrong, and it is indistinguishable from correct unless something checks the pairing. */
  assert.equal(
    mismatches(callSitesIn('f.ts', src('/v1/responses', 'max_tokens'))).length, 1,
    'a /v1/responses call sending max_tokens must be reported - the endpoint ignores that field, so ' +
    'the call is uncapped while looking capped',
  );
  assert.equal(
    mismatches(callSitesIn('f.ts', src('/v1/chat/completions', 'max_output_tokens'))).length, 1,
    'and the mirror: /v1/chat/completions ignores max_output_tokens',
  );
  assert.equal(mismatches(callSitesIn('f.ts', src('/v1/responses', null))).length, 1, 'no cap at all must be reported');
  assert.equal(mismatches(callSitesIn('f.ts', src('/v1/chat/completions', null))).length, 1, 'on either endpoint');

  /* And the correct pairings must be silent, or the rule reports everything and means nothing. */
  assert.deepEqual(mismatches(callSitesIn('f.ts', src('/v1/responses', 'max_output_tokens'))), []);
  assert.deepEqual(mismatches(callSitesIn('f.ts', src('/v1/chat/completions', 'max_tokens'))), []);

  /* A mention in a COMMENT or a STRING is not a sent field. These files discuss max_tokens in prose
     more often than they send it, so a text search would read the discussion as coverage. */
  const talksAboutIt =
    "/* max_tokens is clamped elsewhere - see clampMaxTokens */\n" +
    "const note = 'max_output_tokens: 2000';\n" +
    `const r = await xaiFetch('https://api.x.ai/v1/responses', { method: 'POST', body: JSON.stringify({ input: [] }) });`;
  assert.equal(
    mismatches(callSitesIn('f.ts', talksAboutIt)).length, 1,
    'a comment and a string naming the field must NOT satisfy the rule - this call is uncapped',
  );
});

/* ══ THE REAL TREE ══════════════════════════════════════════════════════════════════════════════ */

function collect(): CallSite[] {
  const sites: CallSite[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(path.join(ROOT, rel))) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const next = `${rel}/${entry}`;
      if (statSync(path.join(ROOT, next)).isDirectory()) walk(next);
      else if (/\.(ts|tsx)$/.test(entry)) {
        const src = readFileSync(path.join(ROOT, next), 'utf8');
        if (src.includes('api.x.ai')) sites.push(...callSitesIn(next, src));
      }
    }
  };
  for (const dir of ['app', 'lib']) walk(dir);
  return sites;
}

const SITES = collect();

test('X2. CONTROL: the walk found the call sites, on both endpoints', () => {
  /* Without this, every assertion below passes on an empty list - which is exactly how an absence
     assertion reports success while measuring nothing. The count is re-derived rather than written
     into a comment, because a comment that counts call sites is the thing #1833 had to delete. */
  assert.ok(
    SITES.length >= 16,
    `only ${SITES.length} xAI call sites found; there were 16 on 2026-10-30. A drop means the walk is ` +
    'broken or routes were removed - either way nothing below is evidence until it is explained.',
  );
  const byEndpoint = new Map<string, number>();
  for (const s of SITES) byEndpoint.set(s.endpoint, (byEndpoint.get(s.endpoint) ?? 0) + 1);
  assert.ok((byEndpoint.get('/v1/chat/completions') ?? 0) >= 13, `/v1/chat/completions sites: ${byEndpoint.get('/v1/chat/completions')}`);
  assert.ok(
    (byEndpoint.get('/v1/responses') ?? 0) >= 3,
    `/v1/responses sites: ${byEndpoint.get('/v1/responses')} - the pairing rule is only interesting ` +
    'while BOTH endpoints are in use, so this is the half that keeps X3 meaningful',
  );
  /* Every site must have had its body parsed. A site with no body keys means the AST shape changed
     (a spread, a variable, a helper) and the cap check silently stopped looking at it. */
  const unparsed = SITES.filter((s) => s.bodyKeys.length === 0);
  assert.deepEqual(
    unparsed.map((s) => `${s.file}:${s.line}`), [],
    'these call sites had no readable body object, so their caps were never checked - the body is ' +
    'probably built by a helper or spread now, and this file needs to follow it rather than pass',
  );
});

test('X3. every xAI call carries the cap field ITS OWN endpoint reads', () => {
  const bad = mismatches(SITES);
  assert.deepEqual(
    bad, [],
    `${bad.length} xAI call site(s) are uncapped or carry the wrong field:\n  ${bad.join('\n  ')}\n\n` +
    '/v1/chat/completions reads max_tokens and /v1/responses reads max_output_tokens, and each ' +
    'IGNORES the other. A call with the right number on the wrong field is uncapped and looks capped.',
  );
});

test('X4. every cap is actually a cap - below the vendor default it replaces', () => {
  const tooHigh = SITES
    .filter((s) => s.capValue !== null && s.capValue >= VENDOR_UNSET_DEFAULT)
    .map((s) => `${s.file}:${s.line} = ${s.capValue}`);
  assert.deepEqual(
    tooHigh, [],
    `a cap at or above ${VENDOR_UNSET_DEFAULT} is the vendor's own unset default, so it bounds nothing: ` +
    tooHigh.join(', '),
  );
  const nonPositive = SITES.filter((s) => s.capValue !== null && s.capValue <= 0).map((s) => `${s.file}:${s.line}`);
  assert.deepEqual(nonPositive, [], `a cap of zero or less: ${nonPositive.join(', ')}`);

  /* The computed ones are named rather than waved through. `app/api/grok-chat/route.ts` passes a
     clamped variable because the browser supplies the figure, and its CLAMP is tested behaviourally
     in `__tests__/grokChatServerPrompt.test.mts` (a request for 999,999 comes out as 600). A new
     computed cap appearing here needs the same treatment, so it fails until someone says so. */
  const computed = SITES.filter((s) => s.capField !== null && s.capValue === null).map((s) => s.file);
  assert.deepEqual(
    [...new Set(computed)], ['app/api/grok-chat/route.ts'],
    'a call site computes its cap instead of writing a literal. That is allowed, but the clamp needs ' +
    'its own behavioural test - a computed cap is only a cap if something bounds the input.',
  );
});
