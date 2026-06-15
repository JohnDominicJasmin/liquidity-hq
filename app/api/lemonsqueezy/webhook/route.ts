import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? '';

function verifySignature(payload: string, signature: string): boolean {
  if (!SECRET) return false;
  const digest = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(digest, 'hex'));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get('x-signature') ?? '';
  const payload = await req.text();

  if (!verifySignature(payload, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(payload);
  const eventName: string = event.meta?.event_name ?? '';
  const attrs = event.data?.attributes ?? {};
  const userId: string | undefined = event.meta?.custom_data?.user_id;

  if (!userId) return NextResponse.json({ received: true });

  const sb = getSupabaseAdmin();
  const isActive = attrs.status === 'active';

  switch (eventName) {
    case 'subscription_created':
    case 'subscription_updated':
    case 'subscription_payment_success': {
      await sb.from('user_subscriptions').upsert({
        user_id:            userId,
        role:               isActive ? 'pro' : 'free',
        ls_subscription_id: String(event.data?.id ?? ''),
        ls_customer_id:     String(attrs.customer_id ?? ''),
        ls_status:          attrs.status ?? '',
        current_period_end: attrs.renews_at ?? attrs.ends_at ?? null,
        updated_at:         new Date().toISOString(),
      }, { onConflict: 'user_id' });
      break;
    }
    case 'subscription_cancelled':
    case 'subscription_expired': {
      await sb.from('user_subscriptions').upsert({
        user_id:    userId,
        role:       'free',
        ls_status:  attrs.status ?? eventName.replace('subscription_', ''),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      break;
    }
  }

  return NextResponse.json({ received: true });
}
