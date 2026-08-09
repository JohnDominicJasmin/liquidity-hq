import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { apiError } from '@/lib/apiError';
import { reportHealth } from '@/lib/apiHealth';

const CMC_KEY = process.env.CMC_API_KEY ?? '';
const BASE    = 'https://pro-api.coinmarketcap.com';

function cmcHeaders() {
  return { 'X-CMC_PRO_API_KEY': CMC_KEY, 'Accept': 'application/json' };
}

interface CmcBody { status?: { error_code?: number; error_message?: string }; data?: unknown[] }

/* CMC reports its own failures INSIDE the body - quota exhausted, bad key,
   plan does not include this endpoint - and this route has always passed that
   body straight through as a 200 without checking either the HTTP status or
   `status.error_code`. So an expired key looks to every caller like a normal
   response that happens to contain nothing useful.
   Health is read from the payload for exactly that reason. The pass-through
   behaviour is deliberately left alone here (changing what this route returns
   would ripple into every caller) - the point is that it stops being silent. */
function reportCmc(source: string, res: Response, body: unknown, items?: number): void {
  const status = (body as CmcBody)?.status;
  const code = status?.error_code ?? 0;
  const ok = res.ok && code === 0;
  reportHealth(
    source, 'market', ok,
    ok ? (items != null ? `${items} items` : 'ok')
       : status?.error_message ?? `HTTP ${res.status}`,
    items,
  );
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

/* Shared edge cache (#177). CMC is CREDIT-METERED, so an uncached call is
   not just latency, it is money - this route was calling upstream on every
   page load.

   `r.ok` gates it deliberately: CMC returns its error bodies as JSON and this
   route forwards them verbatim, so caching unconditionally would pin a
   "rate limit exceeded" payload at the edge for five minutes and take the
   feature down for everyone. Errors stay uncached and retry immediately. */
const CMC_CACHE = (ok: boolean) =>
  ok ? { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } : undefined;

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
      reportCmc('cmc:global-metrics', r, d);
      return NextResponse.json(d, { headers: CMC_CACHE(r.ok) });
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
      reportCmc('cmc:listings', r, d, (d as CmcBody)?.data?.length);
      return NextResponse.json(d, { headers: CMC_CACHE(r.ok) });
    }

    return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
  } catch (e) {
    return apiError('cmc', e, 500, 'CMC fetch failed');
  }
}
