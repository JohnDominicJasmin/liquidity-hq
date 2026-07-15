import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

async function getUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const { data: { user } } = await getSupabaseAdmin().auth.getUser(token);
    return user ?? null;
  } catch { return null; }
}

// Save a new push subscription
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const { endpoint, keys } = body ?? {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'Missing endpoint or keys' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from(T.push_subscriptions).upsert(
    { user_id: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    { onConflict: 'endpoint' }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Remove a push subscription (unsubscribe)
export async function DELETE(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const { endpoint } = body ?? {};
  if (!endpoint) return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 });

  const admin = getSupabaseAdmin();
  await admin.from(T.push_subscriptions).delete().match({ user_id: user.id, endpoint });

  return NextResponse.json({ ok: true });
}
