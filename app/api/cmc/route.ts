import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { apiError } from '@/lib/apiError';

const CMC_KEY = process.env.CMC_API_KEY ?? '';
const BASE    = 'https://pro-api.coinmarketcap.com';

function cmcHeaders() {
  return { 'X-CMC_PRO_API_KEY': CMC_KEY, 'Accept': 'application/json' };
}

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

// Still intentionally unauthenticated (public market data, called for
// signed-out visitors too) - a bearer token is attached when the caller
// happens to be signed in (see MarketProvider.tsx) so a quota spike is
// attributable to an account, not just an IP, without requiring auth to use it.
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
  if (!rateLimit(`cmc:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }
  const user = await attributedUser(req);
  console.log(`[cmc] ip=${ip} user=${user} type=${req.nextUrl.searchParams.get('type')}`);

  if (!CMC_KEY) {
    return NextResponse.json({ error: 'CMC_API_KEY not configured' }, { status: 500 });
  }

  const type = req.nextUrl.searchParams.get('type');

  try {
    if (type === 'global') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const r = await fetch(`${BASE}/v1/global-metrics/quotes/latest`, {
        headers: cmcHeaders(),
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timer);
      const d = await r.json();
      return NextResponse.json(d);
    }

    if (type === 'altseason') {
      // Fetch top 100 by market cap with 90-day % change
      const r = await fetch(
        `${BASE}/v1/cryptocurrency/listings/latest?limit=100&sort=market_cap&convert=USD`,
        {
          headers: cmcHeaders(),
          next: { revalidate: 300 },  // cache 5 min - 90d data doesn't move fast
        }
      );
      const d = await r.json();
      return NextResponse.json(d);
    }

    return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
  } catch (e) {
    return apiError('cmc', e, 500, 'CMC fetch failed');
  }
}
