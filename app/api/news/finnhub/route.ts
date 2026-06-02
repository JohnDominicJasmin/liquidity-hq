import { NextRequest, NextResponse } from 'next/server';

const KEY  = process.env.FINNHUB_KEY ?? '';
const BASE = 'https://finnhub.io/api/v1';

export async function GET(req: NextRequest) {
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
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Finnhub fetch failed' },
      { status: 500 }
    );
  }
}
