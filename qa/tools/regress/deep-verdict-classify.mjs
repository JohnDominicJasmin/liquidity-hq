/* How to read the outcome of a Deep Research monitor run (#1631). Pure, so it can be tested without billing a call.
 *
 * SEPARATE FROM deep-verdict-monitor.mjs because that file runs its CLI at import - argv parsing, env loading and a
 * process.exit(2) when no base URL is given - so a test importing it would EXECUTE the monitor instead of reading it.
 * A rule worth testing has to live somewhere a test can reach without side effects.
 */
/* ── WHAT THE OUTCOME MEANS ──────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Keyed on `/api/grok`'s own typed `code` first and on the status only as a fallback, because the code is what the route commits to
 * and the status is shared between unrelated causes - 503 is both FEATURE_DISABLED (somebody turned it off) and PLAN_UNKNOWN (the
 * entitlement read failed), and neither is the feature being broken.
 *
 * `BAD_ANSWER` IS A PRODUCT FAILURE AND MUST STAY EXIT 1. It is the honest refusal #1651 added: the model was called, billed and
 * refunded, and produced nothing the app would accept as a verdict. That is precisely the 2026-10-23 incident this monitor exists
 * for, so it is not infrastructure and must never be softened into one. */
export const CANNOT_RUN_CODES = {
  /* Found by the control cell in __tests__/deepVerdictMonitorClassification.test.mts on its FIRST run, not by reading: I enumerated
     the route's codes with a grep that paired `code:` against `status:` on the same line, and this one is 401 with the code on a line
     of its own. Six of seven is what a careful read produced. */
  AUTH_REQUIRED: 'the test account is not signed in - the token expired or E2E_USER_A_* is wrong',
  FEATURE_DISABLED: 'the Arena is switched off server-side - a deliberate state, not a regression',
  PLAN_UNKNOWN: 'the entitlement read failed, so the route never reached the model',
  RATE_LIMIT: 'this account has spent its daily Deep reads, or the global cap is reached',
  COIN_LOCKED: 'the test account is not entitled to this coin',
  COIN_REQUIRED: 'the route rejected this body - THIS TOOL is out of date, not the product',
  /* Added for #1631 item 5, and found the same way AUTH_REQUIRED was: by the control cell, not by
     reading. `/api/grok` builds the prompt server-side now and refuses a body carrying the old
     client-built `prompt` field with this code.

     IT IS A CANNOT-RUN, NOT A FAILED VERDICT, and the distinction is the whole reason it belongs
     here. The product's own remedy is "reload the page" - a stale browser tab, or in this tool's
     case a request builder that has not caught up. Bucketing it as a FAIL would report the model as
     having answered badly when the model was never called, which is the one conclusion a monitor
     must not reach on its own obsolescence. */
  STALE_CLIENT: 'this tool sent the old request shape - the route builds the prompt itself now, so THIS TOOL is out of date',
  /* #1855. The coin selector offers 463 instruments; the AI read is tracked for about 50 of them,
     and validation refuses the rest before the plan is read.

     A CANNOT-RUN, FOR A DIFFERENT REASON FROM THE ONES ABOVE. Nothing was spent, no model was
     called, and - unlike every other code here - A RETRY WILL NEVER HELP: the coin is not going to
     become tracked by asking again. A monitor that buckets this as a failed verdict reports the
     model as having answered badly about a coin it was never asked about. */
  COIN_NOT_TRACKED: 'this coin has no AI read - it is in the selector but not in the tracked set, so retrying cannot help',
};

/**
 * @param {{ status?: number, code?: string, parseable: boolean, networkError?: string }} o
 * @returns {{ exit: 0|1|2, label: string, reason: string }}
 */
export function classifyOutcome(o) {
  if (o.networkError) {
    return { exit: 2, label: 'CANNOT RUN', reason: `the request did not complete: ${o.networkError}` };
  }
  if (o.parseable) return { exit: 0, label: 'PASS', reason: 'a verdict the app itself would accept' };

  if (o.code && Object.prototype.hasOwnProperty.call(CANNOT_RUN_CODES, o.code)) {
    return { exit: 2, label: 'CANNOT RUN', reason: `${o.code}: ${CANNOT_RUN_CODES[o.code]}` };
  }
  if (o.code === 'BAD_ANSWER') {
    return { exit: 1, label: 'FAIL', reason: 'BAD_ANSWER: the model was called and returned nothing the app accepts as a verdict' };
  }
  /* Status-only fallbacks, for the paths that carry no code. 401 and 403 are this tool's own credentials and entitlement. */
  if (o.status === 401 || o.status === 403) {
    return { exit: 2, label: 'CANNOT RUN', reason: `HTTP ${o.status}: the test account could not authorise - check E2E_USER_A_*` };
  }
  if (o.status === 400) {
    return { exit: 2, label: 'CANNOT RUN', reason: 'HTTP 400: the route refused this request body. THIS TOOL is out of date - the ' +
      'request contract moved (see #1631 item 5: the server is taking over prompt assembly)' };
  }
  if (o.status === 429) {
    return { exit: 2, label: 'CANNOT RUN', reason: 'HTTP 429: rate limited or out of daily reads' };
  }
  /* Everything else fails loudly. An unhandled 500, or a 200 carrying a body nobody predicted, is the feature not working - and a
     monitor that quietly reclassifies the unknown as weather is how a real regression goes unreported. */
  return {
    exit: 1,
    label: 'FAIL',
    reason: `HTTP ${o.status}${o.code ? ` code=${o.code}` : ' (no code)'}: no parseable verdict, and this is not one of the ` +
      'enumerated can-not-run conditions, so it is being reported as the feature being broken',
  };
}

