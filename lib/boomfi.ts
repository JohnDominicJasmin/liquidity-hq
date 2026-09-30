/* Is this request really from BoomFi? (#861, Phase 1b)
 *
 * Only the verification lives here so far. What an event MEANS for a
 * subscription is deliberately not written yet: BoomFi publishes the event
 * names and a table of field conventions but no example payload, and the last
 * time this project inferred a payload's shape a successful payment revoked
 * Pro (#1422). That half waits for a real event.
 *
 * Everything below is from BoomFi's own page, docs.boomfi.xyz/webhooks/
 * verify-signatures, not carried over from the Lemon Squeezy handler - the two
 * schemes share nothing:
 *
 *   - "RSA PKCS#1 v1.5 signature over SHA-256": a PUBLIC key, so there is no
 *     shared secret to leak and an HMAC compare would verify nothing.
 *   - Headers `X-BoomFi-Timestamp` (Unix seconds) and `X-BoomFi-Signature`
 *     (Base64).
 *   - `message = timestamp + "." + raw_request_body`, the raw bytes as received.
 *     Re-serialising the JSON changes the bytes and the signature stops matching.
 *   - Reject a timestamp "outside your freshness window (for example +/-5
 *     minutes)". BoomFi re-signs a retry with a new timestamp, so freshness
 *     stops a captured request being replayed later but says nothing about
 *     duplicates - those need their own guard in the route.
 *   - After verifying, "Confirm org_id (or org.id) matches your organisation".
 *
 * FAILS CLOSED IN EVERY DIRECTION. No key configured, a key that is not RSA, a
 * header missing, a timestamp that is not a plain integer, a signature that is
 * not the right length: each returns a reason and never throws. A thrown error
 * becomes a 500, and a 500 tells a caller their input got further than a 401
 * would.
 */
import crypto from 'crypto';

/** BoomFi's own example window. */
export const BOOMFI_TIMESTAMP_TOLERANCE_S = 300;

/** The key as BoomFi documents loading it from an environment variable: a
 *  single-line value carries its line breaks as the two characters `\n`. */
export function normalizeBoomfiPublicKey(raw: string | undefined | null): string {
  return (raw ?? '').replace(/\\n/g, '\n').trim();
}

export type BoomfiVerifyFailure =
  | 'no_public_key'
  | 'bad_public_key'
  | 'missing_headers'
  | 'bad_timestamp'
  | 'stale_timestamp'
  | 'bad_signature';

export type BoomfiVerifyResult = { ok: true } | { ok: false; reason: BoomfiVerifyFailure };

export function verifyBoomfiWebhook(opts: {
  rawBody: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  publicKeyPem: string | null | undefined;
  nowMs?: number;
  toleranceS?: number;
}): BoomfiVerifyResult {
  const pem = normalizeBoomfiPublicKey(opts.publicKeyPem);
  if (!pem) return { ok: false, reason: 'no_public_key' };

  const signature = (opts.signature ?? '').trim();
  const timestamp = (opts.timestamp ?? '').trim();
  if (!signature || !timestamp) return { ok: false, reason: 'missing_headers' };

  /* Digits only. Number() would accept '1e9', ' 12 ' and '0x10', and the string
     that was signed is the header exactly as sent. */
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'bad_timestamp' };
  const nowS = (opts.nowMs ?? Date.now()) / 1000;
  const tolerance = opts.toleranceS ?? BOOMFI_TIMESTAMP_TOLERANCE_S;
  if (Math.abs(nowS - Number(timestamp)) > tolerance) return { ok: false, reason: 'stale_timestamp' };

  let key: crypto.KeyObject;
  try {
    key = crypto.createPublicKey(pem);
  } catch {
    return { ok: false, reason: 'bad_public_key' };
  }
  /* The algorithm is fixed by us, not read from the key. Without this a key of
     another type would be verified under that type's rules instead. */
  if (key.asymmetricKeyType !== 'rsa') return { ok: false, reason: 'bad_public_key' };

  try {
    const ok = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${timestamp}.${opts.rawBody}`, 'utf8'),
      { key, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(signature, 'base64'),
    );
    return ok ? { ok: true } : { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
}

/** Does a verified event belong to our organisation? BoomFi documents both
 *  `org_id` and `org.id`. An unset expected id is a refusal, not a pass: a
 *  missing setting must not turn into "every organisation is ours". */
export function boomfiOrgMatches(body: unknown, expectedOrgId: string | undefined | null): boolean {
  const expected = (expectedOrgId ?? '').trim();
  if (!expected || typeof body !== 'object' || body === null) return false;
  const b = body as { org_id?: unknown; org?: unknown };
  const nested = typeof b.org === 'object' && b.org !== null ? (b.org as { id?: unknown }).id : undefined;
  const actual = typeof b.org_id === 'string' ? b.org_id : typeof nested === 'string' ? nested : '';
  return actual !== '' && actual === expected;
}
