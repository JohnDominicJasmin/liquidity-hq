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
     card is the product there - while Arena wants only what it collects. */
  const arena = stripComments(read('app', 'arena', 'page.tsx'));
  const liq   = stripComments(read('app', 'liq', 'page.tsx'));

  const arenaTag = arena.match(/<LiqFeed[^>]*\/>/);
  assert.ok(arenaTag, 'Arena no longer mounts LiqFeed - the chart loses its cluster lines');
  assert.match(arenaTag[0], /\bheadless\b/,
    'Arena mounts LiqFeed visibly again: ' + arenaTag[0]);

  const liqTag = liq.match(/<LiqFeed[^>]*\/>/);
  assert.ok(liqTag, '/liq no longer mounts LiqFeed');
  assert.doesNotMatch(liqTag[0], /\bheadless\b/,
    '/liq went headless, which hides the card that page exists for: ' + liqTag[0]);
});

test('Arena still passes onClusters, which is why it mounts this at all', () => {
  const arena = stripComments(read('app', 'arena', 'page.tsx'));
  const tag = arena.match(/<LiqFeed[^>]*\/>/)![0];
  assert.match(tag, /onClusters=/,
    'a headless LiqFeed with no onClusters is a websocket connection that feeds nothing');
});
