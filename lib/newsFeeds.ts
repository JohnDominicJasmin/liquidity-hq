// Feed list + RSS parsing, extracted from app/api/news-rss/route.ts so the
// scheduled ingest route (app/api/news/ingest) can reach it directly instead
// of making an HTTP call back to this app's own origin.

export const FEEDS = [
  // ── Global breaking / geopolitical ──────────────────────────────────────
  { url: 'https://feeds.reuters.com/reuters/topNews',          source: 'Reuters',          cat: 'geo'    },
  { url: 'https://feeds.reuters.com/reuters/worldNews',        source: 'Reuters World',    cat: 'geo'    },
  { url: 'https://feeds.reuters.com/reuters/businessNews',     source: 'Reuters Business', cat: 'macro'  },
  { url: 'https://feeds.apnews.com/rss/apf-topnews',           source: 'AP News',          cat: 'geo'    },
  { url: 'https://feeds.apnews.com/rss/apf-business',          source: 'AP Business',      cat: 'macro'  },
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',        source: 'BBC World',        cat: 'geo'    },
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml',     source: 'BBC Business',     cat: 'macro'  },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml',          source: 'Al Jazeera',       cat: 'geo'    },
  // ── US political breaking news - fastest on Trump/policy/tariffs ────────
  { url: 'https://moxie.foxnews.com/google-publisher/politics.xml', source: 'Fox News Politics', cat: 'geo' },
  { url: 'https://feeds.nbcnews.com/nbcnews/public/news',      source: 'NBC News',         cat: 'geo'    },
  { url: 'https://rss.politico.com/politics-news.xml',         source: 'Politico',         cat: 'geo'    },
  // ── TruthSocial - Trump's primary platform (Mastodon RSS) ───────────────
  { url: 'https://truthsocial.com/@realDonaldTrump.rss',        source: 'TruthSocial',      cat: 'geo'    },
  // ── Crypto news ─────────────────────────────────────────────────────────
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk',         cat: 'crypto' },
  { url: 'https://cointelegraph.com/rss',                   source: 'CoinTelegraph',    cat: 'crypto' },
  { url: 'https://decrypt.co/feed',                         source: 'Decrypt',          cat: 'crypto' },
  { url: 'https://www.theblock.co/rss.xml',                 source: 'The Block',        cat: 'crypto' },
  { url: 'https://cryptoslate.com/feed/',                   source: 'CryptoSlate',      cat: 'crypto' },
  { url: 'https://bitcoinmagazine.com/.rss/full/',          source: 'Bitcoin Magazine', cat: 'crypto' },
];

export interface RSSItem {
  title:   string;
  source:  string;
  pubDate: number;
  link?:   string;
  image?:  string;   // thumbnail URL from <media:content>, <enclosure>, or description <img>
  cat:     'geo' | 'macro' | 'crypto';
}

function extractCDATA(text: string): string {
  const m = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1].trim() : text.trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

// RSS titles carry HTML/XML entities (curly quotes, en/em dashes, &amp; etc.)
// that render as literal "&#8216;" text in plain-text contexts like desktop
// Notifications, which don't parse HTML - decode them here before display.
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

function extractLink(block: string): string | undefined {
  // Prefer <link> that's not an <atom:link>
  // RSS uses bare <link>URL</link> or <link href="..."/>
  const plain = block.match(/<link>(?:<!\[CDATA\[)?(https?:\/\/[^\s<"]+?)(?:\]\]>)?<\/link>/i)?.[1];
  if (plain) return plain.trim();
  const href = block.match(/<link[^>]+href=["'](https?:\/\/[^"']+)["']/i)?.[1];
  if (href) return href.trim();
  // guid is often the article URL
  const guid = block.match(/<guid[^>]*>(?:<!\[CDATA\[)?(https?:\/\/[^\s<"]+?)(?:\]\]>)?<\/guid>/i)?.[1];
  if (guid) return guid.trim();
  return undefined;
}

function extractImage(block: string): string | undefined {
  // 1. <media:content url="..." medium="image" .../>
  const mc = block.match(/<media:content[^>]+url=["']([^"']+)["'][^>]*(?:medium=["']image["']|type=["']image[^"']*["'])/i)?.[1]
          ?? block.match(/<media:content[^>]+url=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i)?.[1];
  if (mc) return mc;
  // 2. <media:thumbnail url="..."/>  (BBC)
  const mt = block.match(/<media:thumbnail[^>]+url=["'](https?:\/\/[^"']+)["']/i)?.[1];
  if (mt) return mt;
  // 3. <enclosure url="..." type="image/..."/>
  const enc = block.match(/<enclosure[^>]+type=["']image\/[^"']*["'][^>]+url=["'](https?:\/\/[^"']+)["']/i)?.[1]
           ?? block.match(/<enclosure[^>]+url=["'](https?:\/\/[^"']+)["'][^>]+type=["']image\/[^"']*["']/i)?.[1];
  if (enc) return enc;
  // 4. First <img src="..."> inside <description> CDATA
  const desc = block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? '';
  const img = desc.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i)?.[1];
  if (img) return img;
  return undefined;
}

export function parseRSS(xml: string, source: string, cat: RSSItem['cat']): RSSItem[] {
  const items: RSSItem[] = [];
  const itemRx = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRx.exec(xml)) !== null) {
    const block = m[1];

    const titleRaw = block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '';
    const title = decodeEntities(extractCDATA(titleRaw));
    if (!title) continue;

    const dateStr = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? '';
    const pubDate = dateStr ? Math.floor(new Date(dateStr).getTime() / 1000) : Math.floor(Date.now() / 1000);
    if (isNaN(pubDate) || pubDate <= 0) continue;

    const link  = extractLink(block);
    const image = extractImage(block);

    items.push({ title, source, pubDate, link, image, cat });
  }
  return items;
}

// Fetches every feed concurrently, tolerating individual failures, then sorts
// newest-first and drops same-story duplicates across sources.
export async function fetchAllFeeds(): Promise<RSSItem[]> {
  const all: RSSItem[] = [];

  await Promise.allSettled(
    FEEDS.map(async ({ url, source, cat }) => {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LiquidityHQ/1.0; +https://liquidity-hq.com)' },
          signal: AbortSignal.timeout(6000),
          next: { revalidate: 0 },
        });
        if (!res.ok) return;
        const xml = await res.text();
        all.push(...parseRSS(xml, source, cat as RSSItem['cat']));
      } catch { /* skip failed feed silently */ }
    })
  );

  all.sort((a, b) => b.pubDate - a.pubDate);
  const seen = new Set<string>();
  const deduped = all.filter(item => {
    const key = item.title.slice(0, 60).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.slice(0, 150);
}

export interface FinnhubArticle {
  headline?: string;
  summary?:  string;
  source?:   string;
  datetime?: number;
  image?:    string;
}

export async function fetchFinnhubCategory(category: 'crypto' | 'general'): Promise<FinnhubArticle[]> {
  const key = process.env.FINNHUB_KEY ?? '';
  if (!key) return [];
  try {
    const qs = category === 'general' ? 'category=general&minId=0' : 'category=crypto';
    const r = await fetch(`https://finnhub.io/api/v1/news?${qs}&token=${key}`, {
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data as FinnhubArticle[] : [];
  } catch {
    return [];
  }
}
