import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { apiError } from '@/lib/apiError';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { verifyBoomfiWebhook, boomfiOrgMatches } from '@/lib/boomfi';

/* BoomFi webhook - THE SHELL ONLY (#861, Phase 1b).
 *
 * This route proves a request is BoomFi's, proves it is about our organisation,
 * writes it down, and then does nothing with it. IT GRANTS NOTHING AND REVOKES
 * NOTHING. That is on purpose, not a gap to fill in from memory:
 *
 * BoomFi documents its event NAMES and a table of field conventions, and
 * publishes no example payload for any of them. The decision that matters here
 * - who is Pro - depends on the real body: where the account id we bind to the
 * link comes back, how a payment points at its subscription, where the paid
 * period ends. The last time this project inferred a payload's shape, a
 * successful payment revoked Pro (#1422). So the decision is written from a
 * recorded event, and recording events is what this shell is for.
 *
 * Every verified delivery is stored whole in `boomfi_webhook_events`. That row
 * is both the evidence the decision will be built from and the replay guard.
 *
 * STATUS CODES ARE CHOSEN FOR BOOMFI'S DELIVERY MODEL, which is not Lemon
 * Squeezy's. BoomFi documents no automatic retry - a delivery that gets a
 * non-2xx is marked failed and waits for someone to press Replay. So:
 *
 *   - 401  the request is not verifiably BoomFi's. Nothing is stored.
 *   - 400  verified, but the body is not a JSON object. Nothing to act on.
 *   - 403  verified, but for another organisation or none we can name. Reported.
 *   - 500  verified and ours, but it could NOT be written down. BoomFi's own
 *          guidance is "return 2xx only after a durable write"; a failed mark
 *          on their side is what keeps this event recoverable by Replay.
 *   - 200  written down (or already written down on an earlier delivery).
 */

const PUBLIC_KEY = process.env.BOOMFI_WEBHOOK_PUBLIC_KEY ?? '';
const ORG_ID = process.env.BOOMFI_ORG_ID ?? '';

/** A text column's worth of a field that is documented as a string. Anything
 *  else is left null rather than coerced: the whole body is stored beside it,
 *  so a surprise in the shape is visible instead of papered over. */
const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export async function POST(req: NextRequest) {
  // The RAW body, read once. The signature is over these exact bytes; parsing
  // and re-serialising first would change them.
  const rawBody = await req.text();

  const verdict = verifyBoomfiWebhook({
    rawBody,
    signature: req.headers.get('x-boomfi-signature'),
    timestamp: req.headers.get('x-boomfi-timestamp'),
    publicKeyPem: PUBLIC_KEY,
  });
  // One answer for every failure. Which check refused is not the caller's
  // business; /api/version's `boomfiWebhook` flag says whether the key is set.
  if (!verdict.ok) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Body is not JSON' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body is not a JSON object' }, { status: 400 });
  }

  // The signature proves BoomFi sent it with the key we hold. BoomFi's docs
  // still say to confirm the organisation, and an unset BOOMFI_ORG_ID must
  // refuse rather than accept everything.
  if (!boomfiOrgMatches(body, ORG_ID)) {
    return apiError(
      'boomfi/webhook',
      new Error(`verified event is not for our organisation - not recording. configured=${ORG_ID ? 'yes' : 'NO (BOOMFI_ORG_ID unset)'}`),
      403,
      'Organisation mismatch',
    );
  }

  const event = body as Record<string, unknown>;
  const eventName = text(event.event);

  // ── Record, and let the same write be the replay guard ───────────────────
  // A BoomFi retry is re-signed with a new timestamp, so the signature cannot
  // identify a repeat. No event id is documented in the body either. The hash
  // of the raw body is the one thing a repeat of the same delivery shares.
  const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const sb = getSupabaseAdmin();
  const { data: firstSeen, error: recordErr } = await sb
    .from(T.boomfi_webhook_events)
    .insert({
      payload_hash: payloadHash,
      event: eventName,
      resource_id: text(event.id),
      resource_status: text(event.status),
      body: event,
    })
    .select('payload_hash')
    .maybeSingle();

  // A duplicate key is the expected "already recorded" path, not a failure.
  if (recordErr && recordErr.code !== '23505') return apiError('boomfi/webhook', recordErr);
  if (!firstSeen) return NextResponse.json({ received: true, ignored: 'replay' });

  // Recorded, and deliberately not acted on. The reason string is what stops a
  // green delivery in BoomFi's dashboard being read as "the account unlocked".
  return NextResponse.json({ received: true, recorded: true, ignored: 'entitlement_not_implemented' });
}
