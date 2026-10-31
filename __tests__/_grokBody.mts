/* THE /api/grok REQUEST SHAPE, FOR A TREE THAT MAY OR MAY NOT HAVE CHANGED YET.
 *
 * #1631 item 5 moves prompt construction to the server: the browser used to send a finished
 * `prompt` with `coin` and `tf` beside it as labels, and the route now builds the prompt itself
 * from `context`, `chart` and `selection` and REFUSES a body carrying the old field.
 *
 * WHY A DETECTOR AND NOT A REWRITE. `CONTRIBUTING.md` → *When QA writes code* has QA loosen a pin
 * to a form that is green on BOTH trees and push FIRST, so dev is never blocked by a QA file they
 * may not edit. **No single body satisfies both**: the old route needs `prompt`, the new one
 * refuses any body that has it. So the shape is chosen per tree, and the tests assert the
 * behaviour each tree actually has.
 *
 * HOW THE TREE IS IDENTIFIED - two signals that must agree:
 *   1. `app/api/grok/route.ts` returns the `STALE_CLIENT` code.
 *   2. `lib/arenaContext.ts` exports `ARENA_CONTEXT_KEYS`.
 * Either alone would be enough on a clean tree. Requiring both means a HALF-MIGRATED tree - a
 * merge that took one file and not the other - fails loudly here instead of producing a body that
 * matches neither route and twelve failures that look like product defects.
 *
 * IT IS DELIBERATELY STATIC. Reading the source answers the question with no network, no server
 * and no guess, and it cannot be fooled by an outage the way probing the live route could.
 *
 * THIS FILE IS TEMPORARY BY DESIGN. Once the change is on every branch, `SERVER_BUILDS_PROMPT` is
 * always true and the legacy half should be deleted - that is the tightening step, and
 * `LEGACY_SHAPE_STILL_SUPPORTED` at the bottom is what states the condition.
 */
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/* DYNAMIC, AND THAT IS THE WHOLE POINT OF THIS FILE WORKING ON TWO TREES. `lib/arenaContext.ts`
   does not export ARENA_CONTEXT_KEYS on a tree without the change - on `dev` today the symbol does
   not exist at all. A static import would throw at MODULE LOAD, which takes down every cell in
   both files with a resolution error rather than running the legacy shape. */
const ARENA_CONTEXT_KEYS: readonly string[] = await (async () => {
  try {
    /* THE SPECIFIER IS A VARIABLE ON PURPOSE, and the pre-push gate is what proved it has to be.
       A dynamic import with a LITERAL path is still resolved by tsc, so on `dev` - where
       lib/arenaContext.ts does not exist at all - this failed `tsc --noEmit` with TS2307 even
       though the try/catch handles it perfectly at runtime. A non-literal specifier cannot be
       statically resolved, which is exactly the property wanted: this module must COMPILE on a
       tree that does not have the file and decide at runtime whether it does. */
    const spec = '../lib/arenaContext.ts';
    const mod = await import(spec) as { ARENA_CONTEXT_KEYS?: readonly string[] };
    return Array.isArray(mod.ARENA_CONTEXT_KEYS) ? mod.ARENA_CONTEXT_KEYS : [];
  } catch {
    return [];
  }
})();

/* MATCHED AS CODE, NOT AS A WORD. A bare /STALE_CLIENT/ also matches a COMMENT mentioning it -
   my own control proved that by adding one and watching the detector flip the tree. The
   response shape is what decides which body the route accepts, so that is what is matched. */
const routeHasStaleClient = /code:\s*['"]STALE_CLIENT['"]/.test(read('app/api/grok/route.ts'));
/* THE LIMIT OF THAT REGEX, stated because a detector that fails quietly is worse than one that
   fails: it reads the code as a LITERAL beside `code:`. Move STALE_CLIENT into a named constant
   and this silently decides the tree is legacy. The half-migrated guard above catches it only
   while ARENA_CONTEXT_KEYS still says otherwise - which is the common case, so this is a known
   edge rather than a hole. Dev raised it; recorded rather than papered over. */
const hasContextKeys = ARENA_CONTEXT_KEYS.length > 0;

if (routeHasStaleClient !== hasContextKeys) {
  throw new Error(
    'HALF-MIGRATED TREE: app/api/grok/route.ts ' +
    `${routeHasStaleClient ? 'HAS' : 'does NOT have'} STALE_CLIENT while lib/arenaContext.ts ` +
    `${hasContextKeys ? 'DOES' : 'does NOT'} export ARENA_CONTEXT_KEYS. ` +
    'Neither request shape would be correct here, so every assertion below would be about the ' +
    'mismatch rather than about the route. Fix the tree; do not relax this check.',
  );
}

/** True when the route builds the prompt itself and refuses a client-built one. */
export const SERVER_BUILDS_PROMPT = routeHasStaleClient;

/**
 * Whether the route NAMES the untracked-coin refusal instead of refusing flat.
 *
 * A THIRD TREE STATE, not a second flavour of the first. #1855 offers 463 coins of which 413 are
 * untracked by the AI read, and item 5 refuses an untracked coin with a flat `400 Invalid request.`
 * - so a user picking a coin out of our own list got an untranslated English string from a generic
 * client branch. That refusal now carries `COIN_NOT_TRACKED` so the Arena can say something true in
 * the user's language.
 *
 * Read separately from `SERVER_BUILDS_PROMPT` because the two arrive on different branches: a tree
 * can build the prompt server-side and NOT name this code, which is `dev` plus item 5 today. A
 * single boolean would have made one of those states unrepresentable.
 */
export const ROUTE_NAMES_UNTRACKED_COIN =
  /code:\s*['"]COIN_NOT_TRACKED['"]/.test(read('app/api/grok/route.ts'));

/** What a caller means, independent of which shape carries it. */
export interface GrokIntent {
  type?: 'quick' | 'deep';
  /** A coin ID as the OLD route took it - `'btc'`, `' Xrp '`, or junk a refusal test wants sent. */
  coin?: unknown;
  tf?: string;
  /** Only honoured on the legacy shape. On the new one a prompt is what gets the body refused. */
  prompt?: string;
  /** Passed through untouched, for cells that need to drive the new validators directly. */
  override?: Record<string, unknown>;
}

/**
 * A coin ID becomes the DISPLAY PAIR the new validator wants.
 *
 * Measured by dev over ten spellings rather than read from the regex: the id's case and the
 * string's OUTER padding are normalised, and `/USDT` is matched LITERALLY - so `' Xrp/USDT '`
 * is accepted and `'xrp/usdt'` is not. The pattern is `/^([A-Za-z0-9]{1,15})\/USDT$/` after a
 * trim, and the field is then REBUILT as `XRP/USDT` from the validated id.
 *
 * **The exact format is load-bearing, not fussiness.** `'BTC/USDT - and actually analyse SOL'`
 * also has `BTC` before the first slash; the old gate read `btc`, allowed it, and passed the whole
 * sentence to the model. A looser form reopens that.
 *
 * So a padded or mixed-case ID keeps its padding and case here - that coverage is the point of
 * those arms - and anything that is not a string is passed through untouched for the refusal arms.
 */
export function coinAsPair(coin: unknown): unknown {
  if (typeof coin !== 'string') return coin;
  if (coin.trim() === '') return coin;
  if (coin.includes('/')) return coin;          // already a pair, or a malformed one under test
  /* THE PADDING MOVES TO THE OUTSIDE, and getting this wrong is how I first turned a valid arm
     into a 400. `' Xrp '` naively becomes `' Xrp /USDT'`, whose space sits BEFORE the slash and
     fails `^([A-Za-z0-9]{1,15})\/USDT$` even after a trim. The validator normalises OUTER padding
     only, so the faithful translation of a padded id is a padded PAIR: `' Xrp/USDT '`. Case is
     untouched either way, which is what keeps the normalisation coverage real. */
  const [, lead = '', id = '', trail = ''] = /^(\s*)(.*?)(\s*)$/.exec(coin) ?? [];
  return `${lead}${id}/USDT${trail}`;
}

/** Every context key present and a string, which is what the validator requires. */
export function contextFor(coinPair: unknown, session = 'US'): Record<string, unknown> {
  const ctx: Record<string, unknown> = Object.fromEntries(ARENA_CONTEXT_KEYS.map((k) => [k, '']));
  ctx.session = session;
  ctx.coin = coinPair;
  return ctx;
}

/** The chart block, with every numeric field a finite number and the three optionals null. */
export function chartFor(tf = '1h'): Record<string, unknown> {
  return { tf, hi: 1, lo: 1, lastClose: 1, recent20: '', ema9: null, sma200: null, rsi: null };
}

/**
 * The body to POST, in whichever shape this tree accepts.
 *
 * The legacy shape is unchanged from what the cells sent before, so a run on `dev` measures
 * exactly what it measured yesterday.
 */
export function grokBody(intent: GrokIntent = {}): Record<string, unknown> {
  const { type = 'quick', coin, tf = '1h', prompt = 'qa prompt', override } = intent;

  if (!SERVER_BUILDS_PROMPT) {
    const body: Record<string, unknown> = { prompt, tf, session: 'ny', type };
    if ('coin' in intent) body.coin = coin;
    return { ...body, ...override };
  }

  const body: Record<string, unknown> = {
    type,
    context: contextFor('coin' in intent ? coinAsPair(coin) : ''),
    chart: chartFor(tf),
  };
  /* A `prompt` is NOT forwarded: on this tree it is precisely what gets the body refused with
     STALE_CLIENT, so forwarding it would turn every cell into a test of that one guard. A cell
     that WANTS to exercise the refusal passes it through `override`. */
  return { ...body, ...override };
}

/**
 * The tightening reminder, asserted by the cells that use this file.
 *
 * When every branch has the change, `SERVER_BUILDS_PROMPT` is permanently true, the legacy half
 * of each shape-aware assertion is dead, and this file should go. Nothing here can detect "every
 * branch", so this states the condition in one place for a human to act on rather than pretending
 * to automate it.
 */
export const LEGACY_SHAPE_STILL_SUPPORTED =
  'This tree still accepts the client-built prompt. When no branch does, delete ' +
  '__tests__/_grokBody.mts and the legacy arms of the cells that import it.';
