import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* `ok: false` answered with an HTTP 200.
 *
 * Four of these sat in the telegram routes. The Pro branch in test/route.ts had
 * already been fixed once, with the reason written directly above it -
 *
 *   "it used to answer 200 with an error body, so any caller checking res.ok
 *    read the rejection as success"
 *
 * - and the same shape was left in place three lines further down, plus in
 * bot-info. Fixing instances is what let that happen; this asserts the rule.
 *
 * Found by QA's entitlements spec on its first run, via the assertion they
 * nearly did not write: an unauthenticated caller must be turned away AS
 * unauthenticated. Production has TELEGRAM_BOT_TOKEN set so the worst one never
 * fired there - it fired on CI and staging, the environments we test on. */

const dir = fileURLToPath(new URL('../app/api/telegram/', import.meta.url));

/* Matches a NextResponse.json(...) whose body object contains ok: false, and
   captures everything after that body up to the closing paren - which is where
   an options object carrying `status` would be. Bodies here are flat, no nested
   braces, so the non-greedy character class is sufficient and stays readable.

   No `s` flag - it is unavailable at this tsconfig target, and unnecessary:
   every part that has to cross a line break is a character class, which matches
   newlines already. Nothing here relies on `.`. */
const RESPONSE = /NextResponse\.json\(\s*\{[^{}]*\bok:\s*false[^{}]*\}([^;]*?)\)/g;

const routes = readdirSync(dir, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => `${e.name}/route.ts`);

test('a failing telegram response never answers 200', async (t) => {
  assert.ok(routes.length > 0, 'no telegram routes found - has the directory moved?');

  for (const route of routes) {
    await t.test(route, () => {
      const src = readFileSync(dir + route, 'utf8');
      for (const [call, tail] of src.matchAll(RESPONSE)) {
        assert.match(
          tail, /status:\s*\d{3}/,
          `${route} returns ok: false with no status, so it answers 200 and any ` +
          `caller checking res.ok reads the failure as success:\n\n${call.trim()}\n`,
        );
      }
    });
  }
});

/* The one that was reachable without credentials. Everything above is about
   honest status codes; this is about not answering an anonymous caller at all.
   The server-config check must sit BELOW the auth check, or an unauthenticated
   request learns whether this server has a bot configured. */
test('telegram/test does not answer an unauthenticated caller', () => {
  /* Comments are stripped first. The route explains this ordering in a comment
     that necessarily names TELEGRAM_BOT_TOKEN above the auth check, and a naive
     indexOf reads that prose as the check itself - which it did, and failed. */
  const src  = readFileSync(dir + 'test/route.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const auth = src.indexOf("'Sign in required'");
  const cfg  = src.indexOf('process.env.TELEGRAM_BOT_TOKEN');

  assert.ok(auth > 0 && cfg > 0, 'route no longer has the checks this asserts about');
  assert.ok(
    cfg > auth,
    'the TELEGRAM_BOT_TOKEN check has moved back above the auth check - an ' +
    'anonymous caller can again learn whether the server has a bot configured',
  );
});
