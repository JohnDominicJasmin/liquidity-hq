/* Headless LiqFeed (#811): mounted, streaming, rendering nothing.
 *
 * The failure this guards is silent in both directions. Move the early return
 * above a hook and React throws on the NEXT render, not this one - and the
 * effects that open the sockets and emit onClusters stop running, so the
 * chart's cluster lines quietly stop appearing while the card is already
 * invisible and nobody is looking at it. Drop the `headless` prop at the Arena
 * call site and 844px of duplicated card comes back.
 *
 * Neither shows up in a type check and neither has a rendered symptom on the
 * page the change was about.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), 'utf8');

/** Comments blanked, newlines kept - #785 twice over: a scanner that reads
 *  comments finds its own explanations, and a strip that eats newlines breaks
 *  every line number computed afterwards. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));
}

/** Everything a route ACTUALLY composes, as source text - not a codebase-wide
 *  search, a single-hop resolution bounded to what this one route file
 *  itself renders (2026-09-10, #1111 Pattern A).
 *
 *  ASSERTS THE PROPERTY, NOT THE LOCATION. The prior version of this file
 *  read app/liq/page.tsx directly, which was correct while that file
 *  contained the real markup - and silently wrong the moment #1111 collapsed
 *  it to a thin wrapper around LiqTerminal, with no <LiqFeed> tag of its own
 *  left to find. Three tests broke this same way in one day (the REALIZED
 *  label assertion, the typography ratchet, this one) - a test coupled to
 *  the INCIDENTAL FORM something currently takes, rather than the property
 *  that actually matters, fails when the form changes even though nothing
 *  regressed. This resolves the real target dynamically instead of
 *  hardcoding either the old shape (page.tsx has the markup) or the new one
 *  (components/LiqTerminal.tsx does) - whichever is true today is what gets
 *  read.
 *
 *  DELIBERATELY NOT A CODEBASE-WIDE GREP. A blind search for `<LiqFeed`
 *  anywhere would match a HEADLESS mount just as readily as a visible one -
 *  #925 was exactly a mount that existed but was headless, so "found
 *  somewhere" proves nothing on its own. Bounded to one hop, and to the
 *  EXACT Pattern-A wrapper shape - the WHOLE default-export function body is
 *  nothing but `return <X />;` (or `<X/>`), no other JSX, no branches. A
 *  loose `return <Tag` search would also match some unrelated inner return
 *  inside a large pre-collapse page (a loading branch, a ternary) and follow
 *  the wrong import; anchoring to the full function body rules that out.
 *  Matched, the wrapper's own file is skipped and the imported component's
 *  file is read instead - the wrapper never carries the mount, only what it
 *  delegates to does. Unmatched (a route that still contains its own
 *  markup, or a wrapper shaped some other way), the route file is read
 *  as-is, so this keeps working exactly like before for anything that
 *  hasn't collapsed. */
function routeComposedSource(...routeFile: string[]): string {
  const own = stripComments(read(...routeFile));
  const wrapper = own.match(
    /export\s+default\s+function\s+\w+\s*\([^)]*\)\s*\{\s*return\s*<(\w+)\s*\/>\s*;?\s*\}/,
  );
  if (!wrapper) return own;
  const tag = wrapper[1];
  const imp = own.match(new RegExp(`import\\s+${tag}\\s+from\\s+['"]@/([^'"]+)['"]`));
  if (!imp) return own;
  const composedPath = imp[1].split('/');
  const last = composedPath[composedPath.length - 1];
  if (!last.includes('.')) composedPath[composedPath.length - 1] = last + '.tsx';
  return stripComments(read(...composedPath));
}

const FEED = stripComments(read('components', 'LiqFeed.tsx'));
const GUARD = /if \(headless\) return null;/;
const HOOK = /\buse(?:Effect|LayoutEffect|State|Ref|Callback|Memo|Context|Reducer)\s*\(/g;

test('the headless guard exists at all', () => {
  assert.ok(GUARD.test(FEED),
    'components/LiqFeed.tsx no longer returns null for headless. Arena would render ' +
    'the 844px card the owner asked to remove (#811).');
});

test('every hook runs before the guard', () => {
  /* The whole correctness argument for #811. Returning early above a hook
     breaks hook order AND skips the effects that open the sockets, seed from
     localStorage and emit onClusters - the exact work headless mode exists to
     keep running. */
  const at = FEED.search(GUARD);
  assert.ok(at > 0);
  const after = [...FEED.slice(at).matchAll(HOOK)].map(m => m[0]);
  assert.deepEqual(after, [],
    `${after.length} hook(s) are called after the headless guard: ${after.join(', ')}. ` +
    'Move the guard below them - a headless LiqFeed that skips its effects stops ' +
    'feeding the chart, and the chart is the only reason it is still mounted.');
});

test('CONTROL: the hook scanner sees the hooks it is meant to be ordering', () => {
  /* Without this, a regex that matched nothing would report "0 hooks after the
     guard" and pass forever. */
  const at = FEED.search(GUARD);
  const before = [...FEED.slice(0, at).matchAll(HOOK)].map(m => m[0]);
  assert.ok(before.length >= 8,
    `only ${before.length} hooks found before the guard - the scanner is not matching ` +
    'this component, so the assertion above proves nothing');
  assert.ok(before.includes('useEffect('), 'no useEffect found before the guard');
});

test('Arena mounts it headless and /liq does not', () => {
  /* Two call sites, opposite requirements. /liq IS the liquidations page - the
     card is the product there - while Arena wants only what it collects.

     routeComposedSource() resolves what /liq ACTUALLY renders rather than
     assuming it's still written inline in app/liq/page.tsx - see that
     function's own comment for why (#1111 Pattern A, 2026-09-10: the route
     collapsed to a wrapper around LiqTerminal, which is where the real
     mount lives now). Arena has not collapsed this way, so its read is
     unaffected either way. */
  const arena = stripComments(read('app', 'arena', 'page.tsx'));
  const liq   = routeComposedSource('app', 'liq', 'page.tsx');

  const arenaTag = arena.match(/<LiqFeed[^>]*\/>/);
  assert.ok(arenaTag, 'Arena no longer mounts LiqFeed - the chart loses its cluster lines');
  assert.match(arenaTag[0], /\bheadless\b/,
    'Arena mounts LiqFeed visibly again: ' + arenaTag[0]);

  const liqTag = liq.match(/<LiqFeed[^>]*\/>/);
  assert.ok(liqTag, '/liq no longer mounts LiqFeed anywhere in what it actually composes');
  assert.doesNotMatch(liqTag[0], /\bheadless\b/,
    '/liq went headless, which hides the card that page exists for: ' + liqTag[0]);
});

test('Arena still passes onClusters, which is why it mounts this at all', () => {
  const arena = stripComments(read('app', 'arena', 'page.tsx'));
  const tag = arena.match(/<LiqFeed[^>]*\/>/)![0];
  assert.match(tag, /onClusters=/,
    'a headless LiqFeed with no onClusters is a websocket connection that feeds nothing');
});
