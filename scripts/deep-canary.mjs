/* THE DEEP CANARY (#1631). One real Deep read a day, against a deployed environment.
 *
 * #1594 exists because Deep failed for up to five weeks and nothing noticed. The daily health check
 * does NOT close that: its own header says so. /api/health asks "did the database answer and were the
 * venues callable", and it was green throughout those five weeks. The only thing that can tell you Deep
 * works is calling Deep.
 *
 * ── THREE OUTCOMES, AND UNKNOWN IS NOT HEALTHY ────────────────────────────────────────────────────
 *
 *   OK       a Deep read came back and parsed into the contract
 *   FAIL     Deep answered and the answer was not usable, or our request was refused as malformed
 *   UNKNOWN  could not measure - no credential, service asleep, quota exhausted, plan read down
 *
 * The UNKNOWN set is the whole design. A canary that reports FAIL when the fixture ran out of quota
 * gets muted within a week, and a muted canary is worse than none because it reads as covered. So
 * every "we never got to ask Deep" case is UNKNOWN, and UNKNOWN never closes the issue either - a
 * measurement that did not happen is not evidence of health.
 *
 * ── WHY IT CANNOT WATCH PRODUCTION YET ────────────────────────────────────────────────────────────
 *
 * Deep is auth-gated (deliberately - "prevents unauthenticated API burn") and billed per call. Running
 * it needs a real signed-in account. Measured 2026-11-08:
 *
 *   - the DEV database has two Pro fixtures, and this canary is pinned to the one that cannot lapse
 *   - PRODUCTION has exactly one Pro account and it is the OWNER'S OWN
 *
 * So a prod canary would spend the owner's money and burn his 10/day Deep quota under his name. That
 * is his call, not ours. Until he creates a prod test account, point this at staging - which shares
 * the dev database, so the dev fixture works there.
 *
 * ── WHAT IT ASSERTS: THE CONTRACT, NEVER THE CONTENT ──────────────────────────────────────────────
 *
 * A verdict of BULLISH on a day BTC fell is not a defect, and a canary that thought so would fail at
 * random. So it checks the SHAPE: HTTP 200, `result.signal` one of the five, `result.confidence` a
 * number in 0-100. Nothing about which signal, nothing about the prose.
 *
 * ── TWO THINGS THAT WOULD MAKE IT LIE, AND WHAT STOPS THEM ───────────────────────────────────────
 *
 * 1. A STALE REQUEST BODY. /api/grok requires ALL of ARENA_CONTEXT_KEYS - "EVERY FIELD IS REQUIRED",
 *    and a missing one is a flat 400. Hardcoding 61 field names here would make this file a second
 *    definition of that interface, and the day someone adds field 62 the canary starts 400ing and
 *    reports Deep as broken. So the body is GENERATED from the exported constant. Adding a field
 *    cannot stale it.
 *
 * 2. BILLING THE WRONG ACCOUNT. The credential is a secret this script cannot see the contents of in
 *    review, and if it ever pointed at the owner's account the canary would quietly spend his quota
 *    every morning. So after signing in it reads the `sub` out of the returned JWT and REFUSES to call
 *    Deep unless it matches the pinned fixture id. Not a security check - the server does that - but a
 *    "whose money is this" check, which nothing else performs.
 *
 * The coin and timeframe are chosen to keep entitlement OUT of the measurement: `btc` is on the Free
 * coin list so the coin ladder cannot refuse it whatever the plan read says, and `4h` is not one of
 * the gated fast timeframes. A refusal therefore means Deep, not a plan. QA's standing note applies -
 * this fixture is an admin grant with plan NULL and must never be used to assert anything about
 * payment or plan entitlement.
 */
import { ARENA_CONTEXT_KEYS, parseArenaContext, parseArenaChart, parseSelection } from '../lib/arenaContext.ts';
import { COINS } from '../lib/coins.ts';
import { ARENA_TFS } from '../lib/limits.ts';

const BASE        = (process.env.CANARY_BASE_URL ?? '').replace(/\/+$/, '');
const SB_URL      = (process.env.CANARY_SUPABASE_URL ?? '').replace(/\/+$/, '');
const SB_ANON     = process.env.CANARY_SUPABASE_ANON_KEY ?? '';
const EMAIL       = process.env.CANARY_FIXTURE_EMAIL ?? '';
const PASSWORD    = process.env.CANARY_FIXTURE_PASSWORD ?? '';
/* Pinned, per QA: the OTHER dev Pro fixture carries current_period_end 2026-11-27 and would start
   reading as a Deep failure that morning. This one is an admin grant with no end date. */
const FIXTURE_ID  = process.env.CANARY_FIXTURE_USER_ID ?? '9489f7cf-3d9f-4f1e-8648-c5611562d466';

const COIN = 'btc';
const TF   = '4h';

const SIGNALS = ['BULLISH', 'LEAN BULLISH', 'FLAT', 'LEAN BEARISH', 'BEARISH'];

/* Budgets are SEPARATE on purpose. Staging is on Render's free plan: it sleeps when idle and the first
   request after that can take the better part of a minute. Sharing one deadline with the Deep call
   means a cold start eats the budget and the canary reports a Deep timeout for a sleeping service. */
const WAKE_TIMEOUT_MS = 90_000;
const WAKE_ATTEMPTS   = 3;
const AUTH_TIMEOUT_MS = 20_000;
const DEEP_TIMEOUT_MS = 180_000;

const out = [];
const log = (s) => { out.push(s); console.log(s); };

/** OK | FAIL | UNKNOWN, with the reason and whatever we learned on the way. */
function verdict(state, reason, extra = {}) {
  return { state, reason, ...extra };
}

async function timed(url, init, ms, label) {
  const started = Date.now();
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal, cache: 'no-store' });
    return { res, ms: Date.now() - started };
  } catch (e) {
    /* The message only - never the init. A thrown fetch error can carry the request headers, and this
       one carries a bearer token (the Playwright suite leaked exactly that, #1651 notes). */
    return { error: e instanceof Error ? e.message : String(e), ms: Date.now() - started, label };
  } finally {
    clearTimeout(id);
  }
}

/** The `sub` claim, read WITHOUT verifying the signature - we are asking "whose account", not "is this valid". */
function subjectOf(jwt) {
  try {
    const body = jwt.split('.')[1];
    if (!body) return null;
    const json = Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const sub = JSON.parse(json).sub;
    return typeof sub === 'string' ? sub : null;
  } catch { return null; }
}

/* ── The request body, generated rather than written out ──────────────────────────────────────── */
function buildBody() {
  if (!COINS.includes(COIN)) {
    throw new Error(`the canary's coin '${COIN}' is not in COINS - the registry changed under it`);
  }
  if (!ARENA_TFS.includes(TF)) {
    throw new Error(`the canary's timeframe '${TF}' is not in ARENA_TFS - the registry changed under it`);
  }
  const context = {};
  for (const key of ARENA_CONTEXT_KEYS) context[key] = 'unavailable';
  // The three the parser checks beyond "is a string".
  context.coin    = `${COIN.toUpperCase()}/USDT`;   // rebuilt by the server from this id; exact shape required
  context.session = 'canary';                        // must be non-empty
  return {
    type: 'deep',
    context,
    chart: {
      tf: TF,
      // number-or-null is accepted for these three; null is the honest value for a request with no chart behind it
      ema9: null, sma200: null, rsi: null,
      hi: 1, lo: 1, lastClose: 1,
      recent20: 'unavailable',
    },
    selection: [],
  };
}

/* THE BODY IS CHECKED AGAINST THE REAL PARSERS BEFORE ANY MONEY IS SPENT.
 *
 * /api/grok validates with exactly these three functions, and they are importable, so the canary can
 * ask them rather than discovering a 400 after a sign-in. The point is WHEN it finds out: a stale body
 * is our bug, and learning that from a refused HTTP call means the canary has already woken a service
 * and authenticated to be told its own request was malformed. This also means a contract change is
 * reported as "the canary is stale" rather than as a Deep outage, which are different alarms.
 *
 * It runs on every invocation, including --selfcheck, which does only this and exits - so CI can
 * verify the canary still speaks the current contract without spending a Deep read. */
function validateBody(body) {
  const checks = [
    ['context',   parseArenaContext(body.context)],
    ['chart',     parseArenaChart(body.chart)],
    ['selection', parseSelection(body.selection)],
  ];
  for (const [name, r] of checks) {
    if (!r.ok) return `the generated ${name} is not accepted by the route's own parser: ${r.reason}`;
  }
  return null;
}

/* ── Run ──────────────────────────────────────────────────────────────────────────────────────── */
async function run() {
  log(`fields in generated context: ${ARENA_CONTEXT_KEYS.length} (from ARENA_CONTEXT_KEYS)`);

  /* Build and validate FIRST. A stale request body is the one failure mode that would otherwise be
     discovered only after waking a service, signing in and being handed a 400. */
  let body;
  try { body = buildBody(); }
  catch (e) { return verdict('FAIL', `the canary could not build a valid request: ${e.message}`); }
  const invalid = validateBody(body);
  if (invalid) {
    return verdict('FAIL', `${invalid} The request contract has changed and this canary is measuring nothing until it is updated. No Deep read was spent finding this out.`);
  }
  log(`request body validated against the route's own parsers (context, chart, selection)`);
  if (process.argv.includes('--selfcheck')) {
    return verdict('OK', 'selfcheck only: the canary still speaks the current request contract. No Deep read was made, so this says nothing about whether Deep works.');
  }

  for (const [name, v] of [['CANARY_BASE_URL', BASE], ['CANARY_SUPABASE_URL', SB_URL],
                           ['CANARY_SUPABASE_ANON_KEY', SB_ANON], ['CANARY_FIXTURE_EMAIL', EMAIL],
                           ['CANARY_FIXTURE_PASSWORD', PASSWORD]]) {
    if (!v) {
      return verdict('UNKNOWN', `${name} is not set, so no Deep read was attempted. This is not a pass: the canary has never run against this environment.`);
    }
  }
  log(`target: ${BASE}`);

  /* 1. WAKE IT UP, on its own budget. /api/version is cheap, unauthenticated, and already the thing
        this project trusts to say what a service is serving. */
  let woke = null;
  for (let i = 1; i <= WAKE_ATTEMPTS; i++) {
    const r = await timed(`${BASE}/api/version`, {}, WAKE_TIMEOUT_MS, 'wake');
    if (r.res?.ok) {
      woke = await r.res.json().catch(() => ({}));
      log(`awake after ${i} attempt(s) in ${r.ms}ms - serving commit ${woke.commit ?? '?'} on branch ${woke.branch ?? '?'}`);
      break;
    }
    log(`wake attempt ${i}/${WAKE_ATTEMPTS}: ${r.error ? `error ${r.error}` : `HTTP ${r.res.status}`} after ${r.ms}ms`);
  }
  if (!woke) {
    return verdict('UNKNOWN', `the service never answered /api/version in ${WAKE_ATTEMPTS} attempts of ${WAKE_TIMEOUT_MS}ms, so Deep was never asked. A sleeping or down service is not a Deep failure.`);
  }

  /* 2. SIGN IN as the fixture. */
  const auth = await timed(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SB_ANON },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }, AUTH_TIMEOUT_MS, 'auth');
  if (auth.error)     return verdict('UNKNOWN', `the sign-in request to Supabase failed: ${auth.error}. Deep was never asked.`);
  if (!auth.res.ok)   return verdict('UNKNOWN', `sign-in was refused with HTTP ${auth.res.status}. The fixture credential is probably stale or the account changed. Deep was never asked.`);
  const token = (await auth.res.json().catch(() => ({}))).access_token;
  if (typeof token !== 'string' || !token) {
    return verdict('UNKNOWN', 'sign-in returned 200 with no access_token. Deep was never asked.');
  }

  /* 3. WHOSE ACCOUNT IS THIS. Refuse rather than bill someone we did not mean to. */
  const sub = subjectOf(token);
  if (sub !== FIXTURE_ID) {
    return verdict('UNKNOWN',
      `the credential signed in as ${sub ?? 'an unreadable subject'}, not the pinned fixture ${FIXTURE_ID}. ` +
      `Refusing to spend a Deep read on an account this canary was not pinned to - fix the secret rather than the pin.`);
  }
  log(`signed in as the pinned fixture ${FIXTURE_ID}`);

  /* 4. THE DEEP READ, on its own budget now the service is warm. */
  const deep = await timed(`${BASE}/api/grok`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }, DEEP_TIMEOUT_MS, 'deep');

  if (deep.error) {
    return verdict('UNKNOWN', `the Deep request did not complete within ${DEEP_TIMEOUT_MS}ms (${deep.error}). The service was awake, so this is a slow or hung read rather than a cold start - but a timeout is not an answer, so it is not a FAIL either.`, { ms: deep.ms });
  }

  const status = deep.res.status;
  const json   = await deep.res.json().catch(() => null);
  const code   = json?.code ?? null;
  log(`POST /api/grok -> HTTP ${status}${code ? ` code=${code}` : ''} in ${deep.ms}ms`);

  /* 5. CLASSIFY. The split that matters: "Deep gave a bad answer" is a FAIL, "we never got to ask"
        is UNKNOWN. 429 and 503 PLAN_UNKNOWN are the two that look like failures and are not. */
  if (status === 429) {
    return verdict('UNKNOWN', `the fixture's Deep quota is exhausted (HTTP 429${code ? ` ${code}` : ''}), so no read was made. Not a Deep failure.`, { ms: deep.ms });
  }
  if (status === 503 && code === 'PLAN_UNKNOWN') {
    return verdict('UNKNOWN', 'the plan read failed (503 PLAN_UNKNOWN), so the request was refused before reaching Deep. Not a Deep failure.', { ms: deep.ms });
  }
  if (status === 401 || status === 403) {
    return verdict('UNKNOWN', `the Deep call was rejected as unauthenticated (HTTP ${status}) even though sign-in succeeded. Not a Deep failure.`, { ms: deep.ms });
  }
  if (status === 400) {
    /* Our fault, and worth an alarm: a 400 means the request contract moved and the canary is no
       longer measuring anything. Generated fields cannot cause this; the chart or the body shape can. */
    return verdict('FAIL', `/api/grok refused the canary's request as invalid (HTTP 400${code ? ` ${code}` : ''}). The request contract has changed and this canary is measuring nothing until it is updated.`, { ms: deep.ms });
  }
  if (status === 502 && code === 'BAD_ANSWER') {
    /* THE FAILURE THIS WHOLE THING EXISTS FOR: Deep ran, was billed, and produced nothing usable. */
    return verdict('FAIL', 'Deep answered and the answer could not be read as a verdict (502 BAD_ANSWER). This is the silent failure #1594 was written about: the user pays for a read and sees an error.', { ms: deep.ms });
  }
  if (status !== 200) {
    return verdict('FAIL', `Deep returned HTTP ${status}${code ? ` code=${code}` : ''}.`, { ms: deep.ms, head: JSON.stringify(json ?? {}).slice(0, 300) });
  }

  /* 6. THE CONTRACT. */
  const result = json?.result;
  if (!result || typeof result !== 'object') {
    return verdict('FAIL', 'Deep returned HTTP 200 with no `result` object.', { ms: deep.ms, head: JSON.stringify(json ?? {}).slice(0, 300) });
  }
  if (!SIGNALS.includes(result.signal)) {
    return verdict('FAIL', `Deep returned HTTP 200 but \`result.signal\` was ${JSON.stringify(result.signal)}, which is not one of the five verdicts.`, { ms: deep.ms });
  }
  if (typeof result.confidence !== 'number' || !Number.isFinite(result.confidence)
      || result.confidence < 0 || result.confidence > 100) {
    return verdict('FAIL', `Deep returned HTTP 200 and a valid signal, but \`result.confidence\` was ${JSON.stringify(result.confidence)} rather than a number in 0-100.`, { ms: deep.ms });
  }

  const used = json?.usage?.deep_used, limit = json?.usage?.deep_limit;
  log(`contract satisfied: signal=${result.signal} confidence=${result.confidence} citations=${Array.isArray(result.citations) ? result.citations.length : 0}`);
  return verdict('OK',
    `a Deep read completed in ${(deep.ms / 1000).toFixed(1)}s and parsed into the contract (signal and a 0-100 confidence). Fixture quota now ${used ?? '?'}/${limit ?? '?'}.`,
    { ms: deep.ms });
}

const v = await run().catch((e) => verdict('UNKNOWN', `the canary itself threw before reaching a verdict: ${e instanceof Error ? e.message : String(e)}`));

log('');
log(`STATE=${v.state}`);
log(`REASON=${v.reason}`);

if (process.env.GITHUB_OUTPUT) {
  const { appendFileSync } = await import('node:fs');
  /* FLATTENED TO ONE LINE. GITHUB_OUTPUT is `key=value` per line, so a reason carrying a newline would
     not merely truncate - the remainder would be parsed as further key=value pairs, letting an upstream
     error message define step outputs. Reasons here are written as single lines, but several interpolate
     a thrown error's message, and that text is not ours. */
  const flat = (s) => String(s).replace(/[\r\n]+/g, ' ').slice(0, 1500);
  appendFileSync(process.env.GITHUB_OUTPUT, `state=${flat(v.state)}\nreason=${flat(v.reason)}\n`);
}
if (process.env.CANARY_LOG_FILE) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.CANARY_LOG_FILE, out.join('\n') + '\n');
}
// Exit 0 for OK and UNKNOWN: "could not measure" must not turn the job red, or the red stops meaning
// anything. FAIL is the only non-zero.
process.exit(v.state === 'FAIL' ? 1 : 0);
