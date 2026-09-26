/* The FIRST outbound call this app makes to LemonSqueezy's REST API (#1396).
 *
 * Everything LS until now has been INBOUND (the webhook) or a browser redirect
 * (checkout URLs). Cancelling a subscription needs an authenticated server->LS
 * call, so this is a new, small, single-purpose client. It is deliberately NOT a
 * general SDK: one function, cancel, because that is all #1396 needs.
 *
 * OBSERVED on qa 2026-09-26 (owner's real signed-in cancel, verified by QA on
 * #1396): `DELETE /v1/subscriptions/{id}` returns HTTP 200 with the WHOLE
 * subscription object - `status: 'cancelled'`, `cancelled: true`,
 * `ends_at` = the renewal date - and LS then fires webhooks cancelled -> updated
 * -> updated within ~1.2 s. The row after is pro / cancelled / same id / period
 * end = ends_at, so the webhook side (Fix A/B) holds under a real cancel. This
 * function still FAILS CLOSED on anything it does not expect (non-2xx, an
 * unreadable body, or a 2xx whose status is not 'cancelled') and writes NOTHING.
 *
 * IT NEVER RETURNS OR LOGS THE RESPONSE BODY. That body is a full subscription
 * object: it carries the customer's NAME, EMAIL, card brand + last four, and
 * customer/order/store ids (QA #1435). Only an allow-list of non-personal fields
 * (status, cancelled, ends_at, product/variant name) ever leaves this module, so
 * a cancel cannot leak a customer into a log or into GlitchTip.
 */

const LS_API_BASE = 'https://api.lemonsqueezy.com/v1';

/** Server-only. Never NEXT_PUBLIC: this is a secret and must not reach the
 *  client bundle. Unset on prod today (no live products), set on qa (test).
 *  Optional `env` bag so configuredFlags can compute the /api/version `lsApi`
 *  flag from the SAME read the cancel route gates on (#282). */
function apiKey(env?: Record<string, string | undefined>): string {
  const v = env ? env.LEMONSQUEEZY_API_KEY : process.env.LEMONSQUEEZY_API_KEY;
  return v ?? '';
}

export function isLsApiConfigured(env?: Record<string, string | undefined>): boolean {
  return apiKey(env).trim().length > 0;
}

export interface CancelResult {
  ok: boolean;
  /** A MACHINE reason for the caller to log/report - never shown to the user, and
   *  never carrying the response body (see the module header). */
  reason: string;
  /** HTTP status from LS, for the capture log. */
  status: number;
  /** ── Allow-listed, non-personal fields, for the capture log on BOTH success
   *  and failure (QA #1435). NEVER the customer name/email/card/ids. ── */
  lsStatus: string | null;
  cancelled: boolean | null;
  endsAt: string | null;
  productName: string | null;
  variantName: string | null;
}

/** How long to wait for LS before failing closed. The user is watching a button;
 *  a hung outbound call - including a hung body read - must not hang the request.
 *  The AbortController below covers BOTH the fetch and the `.text()` read. */
const LS_TIMEOUT_MS = 10_000;

/** Machine-safe reason strings only. redact() strips secret shapes from an error
 *  MESSAGE (never the response body, which is not logged at all). */
function redact(s: string): string {
  return s
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
    .replace(/\beyJ[A-Za-z0-9._-]{10,}/g, '[redacted-jwt]')
    .replace(/(api[_-]?key["':\s]*)[A-Za-z0-9._-]{8,}/gi, '$1[redacted]')
    .slice(0, 300);
}

interface SafeFields {
  lsStatus: string | null;
  cancelled: boolean | null;
  endsAt: string | null;
  productName: string | null;
  variantName: string | null;
}

const NO_FIELDS: SafeFields = { lsStatus: null, cancelled: null, endsAt: null, productName: null, variantName: null };

/** Parse ONLY the allow-listed, non-personal fields out of the response body.
 *  Everything else in the subscription object - name, email, card, ids - is
 *  never read, so it can never be returned or logged. Returns all-null when the
 *  body is not parseable. */
function extractSafeFields(raw: string): SafeFields {
  try {
    const j = JSON.parse(raw) as {
      data?: { attributes?: {
        status?: unknown; cancelled?: unknown; ends_at?: unknown;
        product_name?: unknown; variant_name?: unknown;
      } };
    };
    const a = j?.data?.attributes;
    if (!a || typeof a !== 'object') return { ...NO_FIELDS };
    return {
      lsStatus:    typeof a.status === 'string' ? a.status : null,
      cancelled:   typeof a.cancelled === 'boolean' ? a.cancelled : null,
      endsAt:      typeof a.ends_at === 'string' ? a.ends_at : null,
      productName: typeof a.product_name === 'string' ? a.product_name : null,
      variantName: typeof a.variant_name === 'string' ? a.variant_name : null,
    };
  } catch {
    return { ...NO_FIELDS };
  }
}

function fail(reason: string, status: number, fields: SafeFields = NO_FIELDS): CancelResult {
  return { ok: false, reason, status, ...fields };
}

/**
 * Cancel a LemonSqueezy subscription by id.
 *
 * `DELETE /v1/subscriptions/{id}` cancels at period end - the subscription keeps
 * `status: 'cancelled'` and access until `ends_at` (OBSERVED 2026-09-26), which
 * is the owner's 2026-08-08 rule and what the webhook side (Fix A/B) writes. This
 * function does NOT touch the database: the resulting webhook is the single
 * writer of the row.
 *
 * FAILS CLOSED: any transport error, non-2xx, unreadable body, or a 2xx whose
 * status is not 'cancelled' returns ok:false with a machine `reason` (no body),
 * and the caller must make no state change.
 */
export async function cancelSubscription(subscriptionId: string): Promise<CancelResult> {
  const key = apiKey();
  if (!key) return fail('ls_api_key_unset', 0);
  if (!subscriptionId) return fail('no_subscription_id', 0);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), LS_TIMEOUT_MS);
  try {
    const res = await fetch(`${LS_API_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
      signal: ctl.signal,
    });
    const raw = await res.text().catch(() => '');
    clearTimeout(timer);

    if (!res.ok) {
      // Do NOT parse or log an error body - fail closed with the status only.
      return fail(`ls_status_${res.status}`, res.status);
    }

    const fields = extractSafeFields(raw);
    if (fields.lsStatus === null) {
      // 2xx but no readable status: cannot confirm the cancel. Fail closed.
      return fail('ok_status_unparsable_body', res.status, fields);
    }
    if (fields.lsStatus !== 'cancelled') {
      return fail(`ok_but_status_${fields.lsStatus}`, res.status, fields);
    }
    return { ok: true, reason: 'cancelled', status: res.status, ...fields };
  } catch (e) {
    // Covers the fetch AND the body read (both under the abort signal). Unknown
    // outcome - fail closed; the webhook remains the source of truth if it landed.
    clearTimeout(timer);
    return fail(`fetch_failed:${redact(e instanceof Error ? e.message : String(e))}`, 0);
  }
}
