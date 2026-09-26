/* The FIRST outbound call this app makes to LemonSqueezy's REST API (#1396).
 *
 * Everything LS until now has been INBOUND (the webhook) or a browser redirect
 * (checkout URLs). Cancelling a subscription needs an authenticated server->LS
 * call, so this is a new, small, single-purpose client. It is deliberately NOT a
 * general SDK: one function, cancel, because that is all #1396 needs.
 *
 * DOCUMENTED, NOT OBSERVED. The request/response shape below is from LS's
 * published API docs, NOT from a delivery we have captured (the test API key
 * lives only in Render's qa env and no seat may handle it, so the first REAL
 * call on qa is itself the capture - QA runs it, #1396). Because of that this
 * client FAILS CLOSED on anything it does not expect: any non-2xx status, or a
 * body it cannot read, returns ok:false and the caller writes NOTHING. It also
 * returns the status and a REDACTED body so the first real call is logged as the
 * capture without ever putting the key or a token in the log.
 */

const LS_API_BASE = 'https://api.lemonsqueezy.com/v1';

/** Server-only. Never NEXT_PUBLIC: this is a secret and must not reach the
 *  client bundle. Unset on prod today (no live products), set on qa (test). */
function apiKey(): string {
  return process.env.LEMONSQUEEZY_API_KEY ?? '';
}

export function isLsApiConfigured(): boolean {
  return apiKey().length > 0;
}

export interface CancelResult {
  ok: boolean;
  /** 'cancelled' when LS accepted it; otherwise a machine reason for the caller
   *  to log/report - never shown to the user verbatim. */
  reason: string;
  /** HTTP status from LS, for the capture log. */
  status: number;
  /** The subscription's status as LS reports it AFTER the call, when readable
   *  (documented: 'cancelled'). null when the body could not be parsed. */
  lsStatus: string | null;
  /** ends_at from the response when present (documented: access continues to
   *  this date). null when absent/unreadable. */
  endsAt: string | null;
}

/** Strip anything secret-shaped from a value before it can reach a log.
 *  Belt-and-braces: the body should not contain the key, but a mistaken echo,
 *  a bearer token, or a signed URL must never be logged. */
function redact(s: string): string {
  return s
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
    .replace(/\beyJ[A-Za-z0-9._-]{10,}/g, '[redacted-jwt]')
    .replace(/(api[_-]?key["':\s]*)[A-Za-z0-9._-]{8,}/gi, '$1[redacted]')
    .slice(0, 600);
}

/**
 * Cancel a LemonSqueezy subscription by id.
 *
 * DOCUMENTED behaviour (to be confirmed by QA's first real qa run, #1396):
 * `DELETE /v1/subscriptions/{id}` cancels at period end - the subscription keeps
 * `status: 'cancelled'` and access until `ends_at`, matching the owner's
 * 2026-08-08 rule and what the webhook side (Fix A/B) already writes. This
 * function does NOT touch the database: the resulting webhook is the single
 * writer of the row.
 *
 * FAILS CLOSED: any transport error, non-2xx, or unreadable body returns
 * ok:false with a redacted, length-capped capture in `reason`, and the caller
 * must make no state change.
 */
export async function cancelSubscription(subscriptionId: string): Promise<CancelResult> {
  const key = apiKey();
  if (!key) {
    return { ok: false, reason: 'ls_api_key_unset', status: 0, lsStatus: null, endsAt: null };
  }
  if (!subscriptionId) {
    return { ok: false, reason: 'no_subscription_id', status: 0, lsStatus: null, endsAt: null };
  }

  let res: Response;
  try {
    res = await fetch(`${LS_API_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
    });
  } catch (e) {
    // Network/DNS/timeout: unknown outcome. Fail closed - the cancel may or may
    // not have reached LS, so make no state change and let the user retry; the
    // webhook remains the source of truth if it did land.
    return { ok: false, reason: `fetch_failed:${redact(e instanceof Error ? e.message : String(e))}`, status: 0, lsStatus: null, endsAt: null };
  }

  const raw = await res.text().catch(() => '');
  if (!res.ok) {
    return { ok: false, reason: `ls_status_${res.status}:${redact(raw)}`, status: res.status, lsStatus: null, endsAt: null };
  }

  // 2xx. Parse defensively; a 2xx with an unreadable body still fails closed,
  // because we cannot confirm the subscription is actually cancelled.
  let lsStatus: string | null = null;
  let endsAt: string | null = null;
  try {
    const json = JSON.parse(raw) as { data?: { attributes?: { status?: unknown; ends_at?: unknown } } };
    const attrs = json?.data?.attributes;
    if (attrs && typeof attrs.status === 'string') lsStatus = attrs.status;
    if (attrs && typeof attrs.ends_at === 'string') endsAt = attrs.ends_at;
  } catch {
    return { ok: false, reason: `ok_status_unparsable_body:${redact(raw)}`, status: res.status, lsStatus: null, endsAt: null };
  }

  // Documented success is status 'cancelled'. Anything else on a 2xx is
  // unexpected - surface it (fail closed) rather than assume success.
  if (lsStatus !== 'cancelled') {
    return { ok: false, reason: `ok_but_status_${lsStatus ?? 'missing'}`, status: res.status, lsStatus, endsAt };
  }

  return { ok: true, reason: 'cancelled', status: res.status, lsStatus, endsAt };
}
