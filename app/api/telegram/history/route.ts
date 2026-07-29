import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRecentFires } from '@/lib/alertHistory';

export const dynamic = 'force-dynamic';

// Sign-in required. This is the Pro-tier alert stream, and it used to be fully
// open - anyone who knew the URL could poll it and read the whole feed. It also
// carried per-user price alerts (coin + target price) until the alert cron
// stopped pushing them; that part is fixed at the source, but the feed still
// has no per-user scoping, so it should not be readable by the whole internet.
export async function GET(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ fires: [] }, { status: 401 });

  const { data } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  ).auth.getUser();
  if (!data.user) return NextResponse.json({ fires: [] }, { status: 401 });

  return NextResponse.json({ fires: getRecentFires() });
}
