import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { apiError } from '@/lib/apiError';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

const KEY  = process.env.FINNHUB_KEY ?? '';
const BASE = 'https://finnhub.io/api/v1';

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

// Still intentionally unauthenticated (public news, called for signed-out
// visitors too) - a bearer token is attached when the caller happens to be
// signed in (see NewsProvider.tsx) so a quota spike is attributable to an
// account, not just an IP, without requiring auth to use it.
async function attributedUser(req: NextRequest): Promise<string> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return 'anon';
  try {
    const { data } = await sb(token).auth.getUser();
    return data.user?.id ?? 'anon';
  } catch {
    return 'anon';
  }
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!rateLimit(`finnhub:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }
  const user = await attributedUser(req);
  console.log(`[finnhub] ip=${ip} user=${user} type=${req.nextUrl.searchParams.get('type')}`);

  if (!KEY) {
    return NextResponse.json({ error: 'FINNHUB_KEY not configured' }, { status: 500 });
  }

  const type = req.nextUrl.searchParams.get('type');

  try {
    if (type === 'crypto') {
      const r = await fetch(`${BASE}/news?category=crypto&token=${KEY}`, {
        next: { revalidate: 60 },
      });
      return NextResponse.json(await r.json());
    }

    if (type === 'general') {
      const r = await fetch(`${BASE}/news?category=general&minId=0&token=${KEY}`, {
        next: { revalidate: 60 },
      });
      return NextResponse.json(await r.json());
    }

    if (type === 'calendar') {
      const from = req.nextUrl.searchParams.get('from') ?? '';
      const to   = req.nextUrl.searchParams.get('to')   ?? '';
      const r = await fetch(
        `${BASE}/calendar/economic?from=${from}&to=${to}&token=${KEY}`,
        { next: { revalidate: 3600 } }
      );
      return NextResponse.json(await r.json());
    }

    return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
  } catch (e) {
    return apiError('news/finnhub', e, 500, 'Finnhub fetch failed');
  }
}
