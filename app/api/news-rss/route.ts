import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { fetchAllFeeds, type RSSItem } from '@/lib/newsFeeds';

let cache: { ts: number; items: RSSItem[] } | null = null;
const CACHE_TTL = 30 * 1000; // 30 seconds - fast refresh for breaking news

export async function GET(req: NextRequest) {
  if (!rateLimit(`news-rss:${getClientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }
  // Serve from cache if fresh
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json({ items: cache.items });
  }

  const items = await fetchAllFeeds();
  cache = { ts: Date.now(), items };

  return NextResponse.json({ items });
}
