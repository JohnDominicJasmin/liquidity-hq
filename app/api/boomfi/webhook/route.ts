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
 *   - 500  verified, but it could NOT be written down. BoomFi's own guidance is
 *          "return 2xx only after a durable write"; a failed mark on their side
 *          is what keeps this event recoverable by Replay.
 *   - 200  written down (or already written down on an earlier delivery).
 *
 * THE ORGANISATION CHECK COMES AFTER THE RECORD, NOT BEFORE IT, and that order
 * is deliberate. The key is per organisation, so a delivery that verifies
 * against ours is already ours; BoomFi's docs still say to confirm `org_id`.
 * But nobody here has seen what that field holds - the dashboard shows a
 * "Merchant ID" with no `org_` prefix, the API reference shows ids with one.
 * Refusing before recording would mean a BOOMFI_ORG_ID in the wrong format
 * throws away the very body that shows the right one. So the delivery is
 * recorded first, and a mismatch is reported WITH the value that arrived. The
 * check is the gate for the entitlement step when that is written: nothing may
 * ever be granted on an event that fails it.
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

  // ── Organisation gate (see the header for why it sits here) ──────────────
  // An unset BOOMFI_ORG_ID fails this too: a missing setting must never read
  // as "every organisation is ours".
  if (!boomfiOrgMatches(event, ORG_ID)) {
    const nested = typeof event.org === 'object' && event.org !== null ? (event.org as { id?: unknown }).id : undefined;
    apiError('boomfi/webhook', new Error(
      `verified and recorded, but the organisation does not match - nothing may be granted on this event. ` +
      `event=${eventName ?? '(none)'} org_id=${text(event.org_id) ?? '(absent)'} org.id=${text(nested) ?? '(absent)'} ` +
      `BOOMFI_ORG_ID=${ORG_ID ? 'set' : 'UNSET'}`,
    ));
    return NextResponse.json({ received: true, recorded: true, ignored: 'org_mismatch' });
  }

  // Recorded, and deliberately not acted on. The reason string is what stops a
  // green delivery in BoomFi's dashboard being read as "the account unlocked".
  return NextResponse.json({ received: true, recorded: true, ignored: 'entitlement_not_implemented' });
}
