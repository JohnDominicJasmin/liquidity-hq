import { timingSafeEqual } from 'crypto';

// Lightweight in-memory per-IP rate limiter for public (unauthenticated) API
// routes. Render runs this app as a single long-lived process, so an
// in-memory Map is sufficient - same pattern as the cooldown Map already
// used in app/api/telegram/alert/route.ts.

type Bucket = { count: number; resetAt: number; limit: number };
/* globalThis-backed so every compiled copy of this module (routes, instrumentation) shares one table, see lib/apiCache.ts. */
const rl = ((globalThis as { __lhqRateLimit?: { buckets: Map<string, Bucket>; overflow: Map<string, Bucket> } }).__lhqRateLimit ??= { buckets: new Map(), overflow: new Map() });
const buckets = rl.buckets;

/* Hard cap on live buckets (#1397). The sweep below only drops EXPIRED buckets, and a flood of distinct keys (one per IP per route) inside one
   window is all live. 20,000 is far past any real concurrent-visitor count here.

   WHICH bucket goes when the cap is hit matters (two rounds of security review on this change). Dropping the oldest regardless would let a flood of
   throwaway keys flush the buckets that are BLOCKING someone. So eviction looks only at the oldest EVICT_SCAN buckets (O(1), never a full scan on the
   request path) and takes the first that is expired or still under its limit; a bucket at its limit is never evicted. If those oldest few are all
   live blockers, nothing is evicted and the NEW key goes into a small separate OVERFLOW table (OVERFLOW_MAX, oldest dropped) so it is still counted and
   limited: refusing it would let an attacker who parks 20,000 blocked keys lock every new visitor out of every rate-limited route, and leaving it
   untracked would hand that visitor an unlimited rate. A flood can only churn the overflow table, never the parked blockers. */
const MAX_BUCKETS = 20_000;
const EVICT_SCAN = 64;
const OVERFLOW_MAX = 1_000;
const overflow = rl.overflow;

/** Live bucket count, for lib/memWatch.ts. */
export function _bucketCount(): number {
  return buckets.size + overflow.size;
}

// Periodic sweep so the Map doesn't grow unbounded across many distinct IPs.
// unref'd so importing this module doesn't keep a plain `node --test` process
// alive forever - the Next server process stays alive regardless, since it
// has its own event loop work, so this is no behaviour change there. Guarded
// because edge runtimes and the browser have no `unref`, and a bare call
// would throw there.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (now > b.resetAt) buckets.delete(key);
  }
  for (const [key, b] of overflow) {
    if (now > b.resetAt) overflow.delete(key);
  }
}, 5 * 60_000);
(sweep as { unref?: () => void }).unref?.();

/** Returns true if the request is allowed, false if the limit was exceeded. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? overflow.get(key);
  if (!b || now > b.resetAt) {
    buckets.delete(key);
    overflow.delete(key);
    if (buckets.size >= MAX_BUCKETS) {
      let victim: string | null = null;
      let seen = 0;
      for (const [k, v] of buckets) {
        if (now > v.resetAt || v.count < v.limit) { victim = k; break; }
        if (++seen >= EVICT_SCAN) break;
      }
      if (victim === null) {
        // the oldest few are all live blockers: track the new key in the overflow table instead of evicting one of them
        overflow.set(key, { count: 1, resetAt: now + windowMs, limit });
        while (overflow.size > OVERFLOW_MAX) {
          const oldest = overflow.keys().next();
          if (oldest.done) break;
          overflow.delete(oldest.value);
        }
        return true;
      }
      buckets.delete(victim);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs, limit });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

// RFC 1918 + loopback - kept only as a last-resort fallback below, see why
// it's not the primary signal in the comment on getClientIp.
function isPrivateIp(ip: string): boolean {
  if (/^10\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^127\./.test(ip)) return true;
  if (ip === '::1') return true;
  return false;
}

/* THE CLIENT IP FOR A RATE-LIMIT KEY (security audit #1413, S8).
 *
 * The app sits behind Cloudflare in front of Render, and the Render origin also answers directly (liquidity-hq.onrender.com), so a request can arrive with ANY headers a caller likes.
 * cf-connecting-ip / true-client-ip are only the real client IP when Cloudflare set them; on a direct request they are whatever the caller sent, which let a caller pick a fresh
 * rate-limit key on every request. So those two headers are trusted ONLY when the request proves it came through Cloudflare: Cloudflare is configured to add a secret header
 * (x-origin-auth) and the same value is in the ORIGIN_AUTH_SECRET environment variable; the value is compared in constant time.
 *
 * Without a matching secret the Cloudflare headers are ignored and the key is the rightmost public hop of x-forwarded-for, which is the address the platform itself appended
 * (a client can only prepend to that header, never add to its right end). Through Cloudflare that is a Cloudflare edge address (shared, so the limit is coarser there), directly it is
 * the real client.
 *
 * TRANSITION: while ORIGIN_AUTH_SECRET is not set at all, the old behaviour is kept (trust the Cloudflare headers) so deploying this before Cloudflare is configured does not
 * collapse every visitor onto a shared edge address. Setting the variable and the Cloudflare rule is what turns the protection on.
 *
 * IPv6 is bucketed by its /64, since one customer holds a whole /64 and could otherwise rotate through addresses inside it. */
export function normalizeIp(ip: string): string {
  const v = ip.trim().toLowerCase();
  if (!v.includes(':')) return v;                       // IPv4
  if (v.startsWith('::ffff:') && v.includes('.')) return v.slice(7); // IPv4-mapped
  const [headRaw, tailRaw] = v.split('::');
  const head = headRaw ? headRaw.split(':') : [];
  const tail = tailRaw !== undefined && tailRaw ? tailRaw.split(':') : [];
  const groups = v.includes('::') ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head;
  if (groups.length < 4) return v;
  return groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

function originSecretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function getClientIp(req: Request, env: Record<string, string | undefined> = process.env): string {
  const h = req.headers;
  const expected = env.ORIGIN_AUTH_SECRET;
  const trustCloudflare = !expected || originSecretMatches(h.get('x-origin-auth'), expected);

  if (trustCloudflare) {
    const cf = h.get('cf-connecting-ip') ?? h.get('true-client-ip');
    if (cf) return normalizeIp(cf);
  }

  // The rightmost PUBLIC hop: the platform's own appended address, skipping its known-private trailing hop.
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map(x => x.trim()).filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i--) {
      if (!isPrivateIp(hops[i])) return normalizeIp(hops[i]);
    }
    if (hops.length) return normalizeIp(hops[hops.length - 1]);
  }
  const real = h.get('x-real-ip');
  return real ? normalizeIp(real) : 'unknown';
}
