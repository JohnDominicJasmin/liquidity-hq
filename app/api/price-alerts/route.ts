import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { createClient } from '@supabase/supabase-js';
import { T } from '@/lib/tables';
import { hasProFeatures } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

async function getUser(token: string) {
  const { data } = await sb(token).auth.getUser();
  return data.user ?? null;
}

export async function GET(req: NextRequest) {
  /* 401, not an empty 200. This used to answer `{ alerts: [] }` to anyone,
     which exposed nothing - the list really was empty - but it was the only
     one of the three user-data routes to do so: /api/hypotheses and
     /api/settings both 401. An unauthenticated caller receiving 200 from a
     user-data endpoint stops being harmless the moment someone adds a default
     or a shared row, and the inconsistency is exactly what makes that easy to
     miss. Found by QA's BOLA suite. Callers already handle 401 from the two
     sibling routes, and the client only requests this when signed in. */
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await sb(token)
    .from(T.price_alerts)
    .select('*')
    .eq('user_id', user.id)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return apiError('price-alerts', error);
  return NextResponse.json({ alerts: data ?? [] });
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Price alerts are delivered over Telegram, which the alert cron only sends
  // to Pro/trial users (checkPriceAlerts filters on proUserIds). Creation used
  // to be ungated, so a free user's alert saved successfully and then silently
  // never fired - it read as a broken feature rather than a locked one. Gate
  // creation instead, so the paywall is honest and visible up front.
  if (!(await hasProFeatures(token, user.id))) {
    return NextResponse.json({ error: 'PRO_REQUIRED', message: 'Price alerts are a Pro feature.' }, { status: 403 });
  }

  const body = await req.json();
  const { coin, target_price, direction, label } = body;
  if (!coin || !target_price || !direction)
    return NextResponse.json({ error: 'coin, target_price, direction required' }, { status: 400 });

  const { data, error } = await sb(token)
    .from(T.price_alerts)
    .insert({ coin, target_price: parseFloat(target_price), direction, label: label ?? '', user_id: user.id })
    .select()
    .single();

  if (error) return apiError('price-alerts', error);
  return NextResponse.json({ alert: data });
}

export async function PATCH(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Same gate as POST: editing an alert is using the feature, so a free user
  // reactivating or re-pointing an old alert would otherwise walk straight
  // around the creation paywall. GET and DELETE stay open on purpose - reading
  // and removing your OWN rows is not the paid feature, and blocking DELETE
  // would trap a lapsed trial user with alerts they cannot clear.
  if (!(await hasProFeatures(token, user.id))) {
    return NextResponse.json({ error: 'PRO_REQUIRED', message: 'Price alerts are a Pro feature.' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if (body.target_price !== undefined) patch.target_price = parseFloat(body.target_price);
  if (body.direction !== undefined)    patch.direction    = body.direction;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

  /* maybeSingle, not single - see the same fix in app/api/hypotheses/[id].
     .eq('user_id') is the ownership filter, so patching someone else's alert
     matches zero rows, and single() reported that as PGRST116 which apiError
     turned into a 500. Authorization denials were indistinguishable from server
     faults in the logs. */
  const { data, error } = await sb(token)
    .from(T.price_alerts)
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .maybeSingle();

  if (error) return apiError('price-alerts', error);
  // 404 rather than 403 so the response is not an existence oracle for ids.
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ alert: data });
}

export async function DELETE(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  /* .select() so we can tell "deactivated a row" from "matched nothing".
     Without it this answered `{ ok: true }` to a delete aimed at someone else's
     alert, having changed nothing - Supabase reports success for an UPDATE that
     matches zero rows. Never a security hole, and QA's suite proved the row
     survives, but "ok" for a no-op is the same ambiguity as the 500 above, just
     pointing the other way. Not flagged as a defect; fixed for consistency with
     PATCH so both say what actually happened. */
  const { data, error } = await sb(token)
    .from(T.price_alerts)
    .update({ active: false })
    .eq('id', id)
    .eq('user_id', user.id) // ownership check - prevents deleting other users' alerts
    .select('id');

  if (error) return apiError('price-alerts', error);
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
