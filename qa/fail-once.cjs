// QA tooling, not app code.
//
// Forces exactly ONE outgoing fetch to fail with a given HTTP status, then
// lets every request after it - including a retry of the identical URL -
// through untouched. For proving "a fix recovers in the same process
// without a restart" against real client-library retry behaviour, which a
// broken-env-var or killed-process test can't isolate (a restart resets
// ALL module state, so it "recovers" whether or not the fix under test is
// what actually did it).
//
// Usage: NODE_OPTIONS="--require ./qa/fail-once.cjs" alongside the app's own
// env vars, then call the route under test twice in the same running
// process - once while armed (forces the failure), once after (passes
// through for real).
//
//   FAIL_ONCE_MATCH  substring(s) the request URL must ALL contain, comma-
//                    separated. Default matches #1295's own repro:
//                    app_config's alert_cooldown row.
//   FAIL_ONCE_STATUS  HTTP status to answer with. Default 504.
//
// WHY 504 BY DEFAULT, NOT A REJECTED PROMISE OR A GENERIC 500 -
// found the hard way testing #1295 (the alert-cooldown hydrate latch):
// @supabase/postgrest-js 2.106.2 retries a GET/HEAD/OPTIONS request up to 3
// times (1s/2s/4s backoff) on a REJECTED fetch or on HTTP 503/520 - so
// simulating those gets silently absorbed by the client before the app
// ever sees an error, proving nothing about the app's own retry-latch
// logic. 504 is NOT in that retried set, which is also what production's
// real incident actually returned - so it's the status that reaches the
// app's own error handling instead of the client's.
//
// If a future failure mode needs a genuinely rejected fetch (DNS failure,
// connection refused) rather than an HTTP status, swap the resolved
// Response below for a rejected Promise - just know postgrest-js will
// retry that shape on its own for GET/HEAD/OPTIONS.
const MATCH = (process.env.FAIL_ONCE_MATCH ?? 'app_config,alert_cooldown').split(',').map(s => s.trim());
const STATUS = Number(process.env.FAIL_ONCE_STATUS ?? 504);

const realFetch = globalThis.fetch;
let armed = true;

globalThis.fetch = function failOnceFetch(input, init) {
  const url = typeof input === 'string' ? input : input?.url ?? '';
  if (armed && MATCH.every(m => url.includes(m))) {
    armed = false;
    console.log(`[fail-once] forcing one ${STATUS} for:`, url);
    return Promise.resolve(new Response('', { status: STATUS, statusText: 'fail-once' }));
  }
  return realFetch(input, init);
};

console.log(`[fail-once] armed - next request matching [${MATCH.join(', ')}] gets a ${STATUS} once`);
