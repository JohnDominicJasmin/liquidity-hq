/* THE FENCE'S LIST, PINNED AGAINST THE SOURCE - and the specs that need the fence, pinned against themselves.
 *
 * Dev's design point on #1632, and it is the one that matters: do not key the guard to the thing it is guarding against changing.
 * `qa/e2e/_no-paid-ai.ts` refuses any unstubbed request to a paid AI route. If its list of paid routes is a hand-written constant,
 * then the day a fourteenth route starts calling xAI the fence silently stops covering it - a second thing reporting success while
 * measuring nothing, which is the exact failure the fence exists to prevent.
 *
 * So: P1 reads `app/api/**-/route.ts` for the routes that actually call xAI and asserts the fence covers every one. The source is the
 * authority; the constant is the copy. Same shape as `testIdParity.test.mts`, which is why that file is the precedent Dev named.
 *
 * P2 is the other half and it is the one that will go red first. A spec that stubs `/api/grok` and does NOT install the fence is
 * exactly the spec that silently starts paying when the path is renamed: its glob stops matching, Playwright passes the request
 * through, the real route answers, and the spec still passes. Ten spec files are in that state today.
 *
 * NO NETWORK, NO BROWSER: this reads files. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** Every `route.ts` under app/api, with its path segments relative to app/api. */
function routeFiles(dir: string, rel: string[] = []): Array<{ file: string; segments: string[] }> {
  const out: Array<{ file: string; segments: string[] }> = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full, [...rel, entry]));
    else if (entry === 'route.ts') out.push({ file: full, segments: rel });
  }
  return out;
}

/** The routes that actually spend money: they call xAI, directly or through the shared helper. */
function paidRouteSegments(): string[] {
  const hits: string[] = [];
  for (const { file, segments } of routeFiles(join(ROOT, 'app', 'api'))) {
    const src = readFileSync(file, 'utf8');
    if (/xaiFetch|api\.x\.ai/.test(src)) hits.push(segments[0]);
  }
  return [...new Set(hits)].sort();
}

const fence = readFileSync(join(ROOT, 'qa', 'e2e', '_no-paid-ai.ts'), 'utf8');
/** The declared list, read out of the fence rather than imported: this file must not need the Playwright types to run. */
const declared = [...(fence.match(/export const PAID_AI_SEGMENTS = \[([\s\S]*?)\] as const;/)?.[1] ?? '')
  .matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('P1. every route that calls xAI is covered by the fence\'s segment list', () => {
  const paid = paidRouteSegments();
  assert.ok(paid.length >= 10, `only ${paid.length} xAI routes found - the enumeration broke, so this test is vacuous`);
  assert.ok(declared.length > 0, 'PAID_AI_SEGMENTS could not be read out of qa/e2e/_no-paid-ai.ts');

  const missing = paid.filter((s) => !declared.includes(s));
  assert.deepEqual(missing, [],
    `these routes call xAI and the fence does not list them: ${missing.join(', ')}. `
    + 'A spec could reach them unstubbed and be billed while still passing. Add them to PAID_AI_SEGMENTS.');
});

test('P1b. the fence lists nothing that has stopped calling xAI - a stale entry is a claim nobody checks', () => {
  const paid = paidRouteSegments();
  const stale = declared.filter((s) => !paid.includes(s));
  assert.deepEqual(stale, [],
    `the fence lists ${stale.join(', ')}, which no longer calls xAI. Harmless to traffic, but it means the list is a `
    + 'hand-maintained guess rather than a reflection of the source - and the next reader cannot tell which entries are real.');
});

/* ── P3: the free-GET exception, pinned against the source ───────────────────────────────── */

const SPENDS = /xaiFetch|api\.x\.ai/;

/** Module-scope function bodies by name: `function f(...) {...}`, `const f = (...) => {...}`, `const f = async (...) => {...}`. */
function moduleHelpers(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
    const end = src.indexOf('\n}', m.index!);
    out.set(m[1], src.slice(m.index!, end === -1 ? undefined : end));
  }
  for (const m of src.matchAll(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/gm)) {
    const end = src.indexOf('\n};', m.index!);
    out.set(m[1], src.slice(m.index!, end === -1 ? src.indexOf('\n}', m.index!) : end));
  }
  return out;
}

/** Does this route's GET handler reach xAI - directly, or through a module-scope helper it calls?
 *
 *  THE INDIRECTION IS NOT HYPOTHETICAL AND DEV FOUND IT IN THE FILE THIS EXCEPTION COVERS. `app/api/grok/route.ts` has
 *  `restateVerdict()` at module scope, which calls `xaiFetch`. Today only POST calls it, so the allowlist entry is correct - but a
 *  purely textual check of the handler BODY would stay green if someone wired a usage-repair path into GET, and the allowlist entry
 *  would silently become a licence to bill. The guarantee has to be "cannot reach xAI", not "contains no literal xaiFetch", because
 *  those come apart exactly where the money is.
 *
 *  Transitive rather than one hop: a helper calling a helper costs two lines here and is the same class of gap. */
function getHandlerSpends(segment: string): boolean | null {
  const file = join(ROOT, 'app', 'api', segment, 'route.ts');
  let src: string;
  try { src = readFileSync(file, 'utf8'); } catch { return null; }
  const at = src.indexOf('export async function GET');
  if (at === -1) return null;
  const end = src.indexOf('\n}', at);
  const body = src.slice(at, end === -1 ? undefined : end);
  if (SPENDS.test(body)) return true;

  const helpers = moduleHelpers(src);
  const seen = new Set<string>();
  const queue = [...body.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const h = helpers.get(name);
    if (!h) continue;
    if (SPENDS.test(h)) return true;
    queue.push(...[...h.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  }
  return false;
}

test('P3. the fence only lets a GET through where that GET handler does NOT call xAI', () => {
  const allowed = [...(fence.match(/const FREE_GET_PATHS = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? '')
    .matchAll(/'\/api\/([^']+)'/g)].map((m) => m[1]);
  assert.ok(allowed.length > 0, 'FREE_GET_PATHS could not be read out of qa/e2e/_no-paid-ai.ts');

  for (const seg of allowed) {
    const spends = getHandlerSpends(seg);
    assert.notEqual(spends, null, `the fence lets a GET through to /api/${seg}, which has no GET handler at all`);
    assert.equal(spends, false,
      `/api/${seg}'s GET handler calls xAI, and the fence passes GETs to it through. A spec would be BILLED for a request the `
      + 'fence was installed to refuse. Remove it from FREE_GET_PATHS.');
  }

  /* And the other direction: a route that spends in GET must never be in the exception list. */
  for (const seg of declared) {
    if (getHandlerSpends(seg) === true) {
      assert.ok(!allowed.includes(seg), `/api/${seg} spends in its GET handler and is in FREE_GET_PATHS`);
    }
  }
});

/* ── P2: the specs that stub a paid path must install the fence ─────────────────────────────────────────────────── */

const SPEC_DIR = join(ROOT, 'qa', 'e2e');
const specs = readdirSync(SPEC_DIR).filter((f) => f.endsWith('.spec.ts'));

/** A spec "stubs a paid path" if it registers a route whose pattern names one of the paid segments. */
function stubsPaidPath(src: string): string[] {
  const found = new Set<string>();
  for (const m of src.matchAll(/\.route\(\s*['"`]([^'"`]+)['"`]/g)) {
    const pattern = m[1];
    for (const seg of declared) if (new RegExp(`/api/${seg}(?:[/*?'"\`]|$)`).test(pattern)) found.add(seg);
  }
  return [...found];
}

test('P2. a spec that stubs a paid AI path also installs the fence, so a renamed path cannot slip past its glob', () => {
  const offenders: string[] = [];
  for (const f of specs) {
    const src = readFileSync(join(SPEC_DIR, f), 'utf8');
    const paid = stubsPaidPath(src);
    if (paid.length === 0) continue;
    /* A CALL, not a mention. `/installPaidAiFence/` also matches the import line, so a spec that imports the fence and never calls
       it passed this test - found by mutation (removing the call from arena-read-card left P2 green), which is the whole argument
       for running the control before trusting a green. */
    const calls = [...src.matchAll(/installPaidAiFence\s*\(/g)].length;
    if (calls === 0) offenders.push(`${f} (stubs ${paid.join(', ')})`);
  }
  assert.deepEqual(offenders, [],
    `${offenders.length} spec(s) stub a paid AI path by glob without installing the fence:\n  ${offenders.join('\n  ')}\n`
    + 'Each one keeps passing if the path is renamed - the glob stops matching, the request reaches the real route, and xAI bills '
    + 'for it. Add `await installPaidAiFence(page)` BEFORE the spec\'s own routes (Playwright matches the most recently '
    + 'registered handler first, so installing it last would swallow the stubs instead).');
});
