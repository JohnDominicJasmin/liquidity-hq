import { readJsonCapped, BODY_CAPS } from '@/lib/requestBody';
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { fetchAuthUser } from '@/lib/authUser';
import { validPushEndpoint, validPushKey } from '@/lib/pushEndpoint';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

async function getUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
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
  if (!user) return unauthorized();

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
  const { error } = await admin.from(T.push_subscriptions).upsert(
    { user_id: user.id, endpoint: cleanEndpoint, p256dh, auth: authKey },
    { onConflict: 'endpoint' }
  );

  if (error) return apiError('push/subscribe', error);
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
