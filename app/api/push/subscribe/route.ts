import { readJsonCapped, BODY_CAPS } from '@/lib/requestBody';
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { fetchAuthUser } from '@/lib/authUser';
import { validPushEndpoint, validPushKey } from '@/lib/pushEndpoint';
import { bearerToken } from '@/lib/bearerToken';
import { getEntitlementStatus } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';

/** Browsers or devices one account can receive push on. Past it, the oldest is dropped. */
const MAX_SUBSCRIPTIONS_PER_USER = 10;

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

async function getUser(req: NextRequest) {
  const token = bearerToken(req.headers);
  if (!token) return null;
  try {
    // #1397 review: this route WRITES with the service role on the strength of the token alone, so it asks Auth (fetchAuthUser): a signed-out,
    // banned or deleted account is refused at once, not when its token expires. A deliberate user action, so the round trip is cheap.
    return await fetchAuthUser(token);
  } catch { return null; }
}

// Save a new push subscription
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  const token = bearerToken(req.headers);
  if (!user || !token) return unauthorized();

  /* Push alerts are a Pro feature (the alert job and the test push already refuse other plans). An unreadable plan is our failure, not a "no". */
  const plan = await getEntitlementStatus(token, user.id);
  if (plan === 'unknown') return NextResponse.json({ error: 'Something went wrong. Try again.', code: 'UNAVAILABLE' }, { status: 503 });
  if (plan !== 'entitled') {
    return NextResponse.json({ error: 'PRO_REQUIRED', message: 'Push notifications are a Pro feature.' }, { status: 403 });
  }

  const capped = await readJsonCapped(req, BODY_CAPS.pushSubscribe);
  if (capped.tooLarge) return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  const body = capped.value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const { endpoint, keys } = body ?? {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'Missing endpoint or keys' }, { status: 400 });
  }
  /* The server later sends a request to this URL, so only an https URL on a real push service is stored (stored-SSRF fix, #1413). */
  const cleanEndpoint = validPushEndpoint(endpoint);
  const p256dh = validPushKey(keys.p256dh);
  const authKey = validPushKey(keys.auth);
  if (!cleanEndpoint || !p256dh || !authKey) {
    return NextResponse.json({ error: 'Invalid push subscription' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  /* An endpoint already stored for another account moves only to a caller holding the same keys, which is the same browser (signed in to
     a different account). Knowing the address alone moves nothing. */
  const { data: held, error: heldError } = await admin.from(T.push_subscriptions)
    .select('user_id, p256dh, auth').eq('endpoint', cleanEndpoint).maybeSingle();
  if (heldError) return apiError('push/subscribe', heldError);
  if (held && held.user_id !== user.id && (held.p256dh !== p256dh || held.auth !== authKey)) {
    return NextResponse.json({ error: 'Invalid push subscription' }, { status: 409 });
  }

  const { error } = await admin.from(T.push_subscriptions).upsert(
    { user_id: user.id, endpoint: cleanEndpoint, p256dh, auth: authKey },
    { onConflict: 'endpoint' }
  );

  if (error) return apiError('push/subscribe', error);

  /* The cap. The row just stored is never the one dropped, whatever its age. A failed read or delete is retried by the next subscribe. */
  const { data: mine } = await admin.from(T.push_subscriptions)
    .select('endpoint').eq('user_id', user.id).order('created_at', { ascending: false });
  const others = (Array.isArray(mine) ? mine : []).map(r => r.endpoint as string).filter(e => e !== cleanEndpoint);
  const excess = others.slice(MAX_SUBSCRIPTIONS_PER_USER - 1);
  if (excess.length) await admin.from(T.push_subscriptions).delete().eq('user_id', user.id).in('endpoint', excess);

  return NextResponse.json({ ok: true });
}

// Remove a push subscription (unsubscribe)
export async function DELETE(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return unauthorized();

  const capped = await readJsonCapped(req, BODY_CAPS.pushSubscribe);
  if (capped.tooLarge) return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  const body = capped.value as { endpoint?: unknown } | null;
  const { endpoint } = body ?? {};
  if (!endpoint) return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 });

  const admin = getSupabaseAdmin();
  await admin.from(T.push_subscriptions).delete().match({ user_id: user.id, endpoint });

  return NextResponse.json({ ok: true });
}
