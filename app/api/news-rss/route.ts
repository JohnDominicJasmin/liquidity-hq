import { NextResponse } from 'next/server';

// Free RSS feeds — no API key, no rate limit
const FEEDS = [
  { url: 'https://feeds.reuters.com/reuters/topNews',      source: 'Reuters' },
  { url: 'https://feeds.reuters.com/reuters/worldNews',    source: 'Reuters World' },
  { url: 'https://feeds.reuters.com/reuters/businessNews', source: 'Reuters Business' },
  { url: 'https://feeds.apnews.com/rss/apf-topnews',      source: 'AP News' },
  { url: 'https://feeds.apnews.com/rss/apf-business',     source: 'AP Business' },
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk' },
  { url: 'https://cointelegraph.com/rss',                  source: 'CoinTelegraph' },
];

interface RSSItem {
  title: string;
  source: string;
  pubDate: number;
}

function extractCDATA(text: string): string {
  const m = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1].trim() : text.trim();
}

function parseRSS(xml: string, source: string): RSSItem[] {
  const items: RSSItem[] = [];
  const itemRx = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRx.exec(xml)) !== null) {
    const block = m[1];

    // Title — handle CDATA or plain
    const titleRaw = block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '';
    const title = extractCDATA(titleRaw);
    if (!title) continue;

    // pubDate
    const dateStr = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? '';
    const pubDate = dateStr ? Math.floor(new Date(dateStr).getTime() / 1000) : Math.floor(Date.now() / 1000);

    // Skip if date is invalid
    if (isNaN(pubDate) || pubDate <= 0) continue;

    items.push({ title, source, pubDate });
  }
  return items;
}

export async function GET() {
  const all: RSSItem[] = [];

  await Promise.allSettled(
    FEEDS.map(async ({ url, source }) => {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LiquidityHQ/1.0)' },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return;
        const xml = await res.text();
        all.push(...parseRSS(xml, source));
      } catch { /* skip failed feed */ }
    })
  );

  // Sort newest first, dedupe by title prefix
  all.sort((a, b) => b.pubDate - a.pubDate);
  const seen = new Set<string>();
  const deduped = all.filter(item => {
    const key = item.title.slice(0, 60).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return NextResponse.json({ items: deduped.slice(0, 60) });
}
