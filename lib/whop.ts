/* Is this request really from Whop? (#1567, Phase 1)
 *
 * Only the verification lives here. What an event MEANS for a subscription is deliberately not written: no real Whop payload has been
 * recorded yet, and the last time this project inferred a payload's shape a successful payment revoked Pro (#1422). That half waits for
 * a real event, which the recording route (app/api/whop/webhook/route.ts) exists to capture.
 *
 * The scheme is Standard Webhooks (standardwebhooks.com), which Whop uses:
 *   - Headers `webhook-id` (stable across retries of one message), `webhook-timestamp` (Unix seconds) and `webhook-signature`: a
 *     space-separated list of `v1,<base64>` entries (more than one while a secret is being rotated).
 *   - signed content = `${webhook-id}.${webhook-timestamp}.${raw request body}`, the raw bytes as received.
 *   - signature = base64( HMAC-SHA256( key, signed content ) ). The key is the secret: if it starts with `whsec_` the rest is base64 and
 *     decodes to the key bytes.
 *   - A timestamp outside a tolerance (5 minutes) is refused, so a captured request cannot be replayed later. Duplicates are a separate
 *     question (the route's replay guard).
 *
 * Verified against the specification's published test vector (see the CONTROL tests QA writes): secret
 * `whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw`, id `msg_p5jXN8AQM9LWM0D4loKWxJek`, timestamp `1614265330`, body `{"test": 2432232314}`
 * gives `v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=`.
 *
 * THE SECRET (per PM reading Whop's documentation, 2026-10-17): it starts with `ws_` and is used AS-IS, as the key string itself, not decoded and
 * not stripped of the prefix. So the RAW reading is the primary one. Two other readings stay as fallbacks because the real dashboard value was
 * not seen: a `whsec_` prefix (the Standard Webhooks default) means the rest is base64 and decodes to the key; and a secret that is valid
 * base64 is also tried decoded. Accepting a fallback does not weaken anything: forging a valid signature needs the secret under any reading.
 * The first real delivery reports which reading verified (never the secret), so the extra readings can be removed once it is known.
 *
 * FAILS CLOSED IN EVERY DIRECTION. No secret, a header missing, a timestamp that is not plain digits, a stale timestamp, no `v1` entry,
 * a signature of the wrong length: each returns a reason and never throws (a thrown error becomes a 500, which tells a caller their input
 * got further than a 401 would).
 */
import crypto from 'crypto';

/** The specification's example window. */
export const WHOP_TIMESTAMP_TOLERANCE_S = 300;

export type WhopVerifyFailure =
  | 'no_secret'
  | 'missing_headers'
  | 'bad_timestamp'
  | 'stale_timestamp'
  | 'no_v1_signature'
  | 'bad_signature';

export type WhopVerifyResult =
  | { ok: true; secretReading: 'whsec-base64' | 'raw-utf8' | 'raw-base64' }
  | { ok: false; reason: WhopVerifyFailure };

/** The key bytes a secret string can stand for, in the order they are tried. */
export function whopSecretKeys(secret: string | undefined | null): Array<{ reading: 'whsec-base64' | 'raw-utf8' | 'raw-base64'; key: Buffer }> {
  const s = (secret ?? '').trim();
  if (!s) return [];
  // Standard Webhooks default form: `whsec_` + base64 of the key bytes.
  if (s.startsWith('whsec_')) {
    const body = s.slice('whsec_'.length);
    const key = Buffer.from(body, 'base64');
    return key.length ? [{ reading: 'whsec-base64', key }] : [];
  }
  const out: Array<{ reading: 'whsec-base64' | 'raw-utf8' | 'raw-base64'; key: Buffer }> = [{ reading: 'raw-utf8', key: Buffer.from(s, 'utf8') }];
  // Only a string that is genuinely base64 is also tried decoded; anything else has one reading.
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length % 4 === 0) {
    const decoded = Buffer.from(s, 'base64');
    if (decoded.length) out.push({ reading: 'raw-base64', key: decoded });
  }
  return out;
}

export function verifyWhopWebhook(opts: {
  rawBody: string;
  id: string | null | undefined;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  secret: string | null | undefined;
  nowMs?: number;
  toleranceS?: number;
}): WhopVerifyResult {
  const keys = whopSecretKeys(opts.secret);
  if (keys.length === 0) return { ok: false, reason: 'no_secret' };

  const id = (opts.id ?? '').trim();
  const timestamp = (opts.timestamp ?? '').trim();
  const header = (opts.signature ?? '').trim();
  if (!id || !timestamp || !header) return { ok: false, reason: 'missing_headers' };

  /* Digits only. Number() would accept '1e9', ' 12 ' and '0x10', and the string that was signed is the header exactly as sent. */
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'bad_timestamp' };
  const nowS = (opts.nowMs ?? Date.now()) / 1000;
  const tolerance = opts.toleranceS ?? WHOP_TIMESTAMP_TOLERANCE_S;
  if (Math.abs(nowS - Number(timestamp)) > tolerance) return { ok: false, reason: 'stale_timestamp' };

  // `v1,<base64>` entries; any other version is ignored, and a header with no v1 entry is refused.
  const candidates: Buffer[] = [];
  for (const part of header.split(/\s+/)) {
    const comma = part.indexOf(',');
    if (comma < 0) continue;
    if (part.slice(0, comma) !== 'v1') continue;
    const sig = Buffer.from(part.slice(comma + 1), 'base64');
    if (sig.length === 32) candidates.push(sig); // an HMAC-SHA256 is exactly 32 bytes
  }
  if (candidates.length === 0) return { ok: false, reason: 'no_v1_signature' };

  const signed = Buffer.from(`${id}.${timestamp}.${opts.rawBody}`, 'utf8');
  for (const { reading, key } of keys) {
    const expected = crypto.createHmac('sha256', key).update(signed).digest();
    for (const sig of candidates) {
      // Equal lengths are guaranteed above, which timingSafeEqual requires.
      if (crypto.timingSafeEqual(expected, sig)) return { ok: true, secretReading: reading };
    }
  }
  return { ok: false, reason: 'bad_signature' };
}
