import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

async function getUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const { data: { user } } = await getSupabaseAdmin().auth.getUser(token);
    return user ?? null;
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pubKey  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privKey = process.env.VAPID_PRIVATE_KEY;
  const email   = process.env.VAPID_EMAIL;
  if (!pubKey || !privKey || !email) {
    return NextResponse.json({ error: 'VAPID not configured' }, { status: 503 });
  }

  const admin = getSupabaseAdmin();
  const { data: subs } = await admin
    .from(T.push_subscriptions)
    .select('*')
    .eq('user_id', user.id);

  if (!subs?.length) {
    return NextResponse.json({ error: 'No subscriptions found for this user' }, { status: 404 });
  }

  webpush.setVapidDetails(email, pubKey, privKey);

  const payload = JSON.stringify({
    title: 'LiquidityHQ',
    body:  'Push notifications are working.',
    tag:   'lhq-test',
    url:   '/settings',
  });

  const expired: string[] = [];
  await Promise.allSettled(
    subs.map(async (sub: { endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err: unknown) {
        if ((err as { statusCode?: number }).statusCode === 410) expired.push(sub.endpoint);
      }
    })
  );

  if (expired.length > 0) {
    await admin.from(T.push_subscriptions).delete().in('endpoint', expired);
  }

  return NextResponse.json({ ok: true, sent: subs.length - expired.length });
}
