import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { apiError } from '@/lib/apiError';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { verifyWhopWebhook } from '@/lib/whop';

/* Whop webhook - THE RECORDING SHELL ONLY (#1567, Phase 1).
 *
 * This route proves a request is Whop's, writes it down, and does nothing with it. IT GRANTS NOTHING AND REVOKES NOTHING, and it
 * never touches the subscriptions table. That is on purpose, not a gap to fill in from memory: no real Whop payload has been seen, and
 * the last time this project acted on an inferred payload shape a successful payment revoked Pro (#1422). The decision about who is
 * Pro is written from a RECORDED event, and recording events is what this route is for. (The BoomFi webhook went the same way:
 * shell first, decision after a real delivery.)
 *
 * Every verified delivery is stored whole in `whop_webhook_events`. That row is both the evidence the decision will be built from and
 * the replay guard.
 *
 * STATUS CODES (Whop expects a 2xx within about 5 s and retries for about 71 hours):
 *   - 401  the request is not verifiably Whop's. Nothing is stored. One answer for every failure.
 *   - 400  verified, but the body is not a JSON object. Nothing to act on.
 *   - 500  verified, but it could NOT be written down. A non-2xx keeps the delivery retryable on Whop's side.
 *   - 200  written down, or already written down on an earlier delivery (a retry).
 *
 * THE COMPANY CHECK IS NOT HERE YET. Nobody has seen where a Whop payload carries the company id, so a check written now would be a
 * guess. It arrives with the decision (Phase 2), after the first real body shows the field - the order the BoomFi route followed.
 */

const SECRET = process.env.WHOP_WEBHOOK_SECRET ?? '';

/** A text column's worth of a field that is a string. Anything else is left null rather than coerced: the whole body is stored beside
 *  it, so a surprise in the shape is visible instead of papered over. */
const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export async function POST(req: NextRequest) {
  // The RAW body, read once. The signature is over these exact bytes; parsing and re-serialising first would change them.
  const rawBody = await req.text();

  const webhookId = req.headers.get('webhook-id');
  const verdict = verifyWhopWebhook({
    rawBody,
    id: webhookId,
    timestamp: req.headers.get('webhook-timestamp'),
    signature: req.headers.get('webhook-signature'),
    secret: SECRET,
  });
  // One answer for every failure. Which check refused is not the caller's business; /api/version's `whopWebhook` flag says whether the
  // secret is set.
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
  const data = typeof event.data === 'object' && event.data !== null && !Array.isArray(event.data) ? (event.data as Record<string, unknown>) : null;

  // ── Record, and let the same write be the replay guard ───────────────────
  // A retry of one message carries the same bytes and the same webhook-id; the hash of the raw body is the key. Different bytes with a
  // repeated webhook-id are still recorded (the evidence is kept), and the index on webhook_id makes them findable.
  const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  let sb: ReturnType<typeof getSupabaseAdmin>;
  try {
    sb = getSupabaseAdmin();
  } catch (e) {
    return apiError('whop/webhook', e);
  }
  const { data: firstSeen, error: recordErr } = await sb
    .from(T.whop_webhook_events)
    .insert({
      payload_hash: payloadHash,
      webhook_id: text(webhookId),
      // Searchable hints only. The documented event-type field is not confirmed against a real delivery, so these stay null when the
      // shape differs and `body` still has the truth.
      event: text(event.type) ?? text(event.event) ?? text(event.action),
      resource_id: text(data?.id) ?? text(event.id),
      body: event,
    })
    .select('payload_hash')
    .maybeSingle();

  // A duplicate key is the expected "already recorded" path, not a failure.
  if (recordErr && recordErr.code !== '23505') return apiError('whop/webhook', recordErr);
  if (!firstSeen) return NextResponse.json({ received: true, ignored: 'replay' });

  // Recorded, and deliberately not acted on. The reason string stops a green delivery in Whop's dashboard being read as "the account
  // unlocked".
  return NextResponse.json({ received: true, recorded: true, ignored: 'entitlement_not_implemented' });
}
