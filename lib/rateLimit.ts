// Lightweight in-memory per-IP rate limiter for public (unauthenticated) API
// routes. Render runs this app as a single long-lived process, so an
// in-memory Map is sufficient - same pattern as the cooldown Map already
// used in app/api/telegram/alert/route.ts.

const buckets = new Map<string, { count: number; resetAt: number }>();

// Periodic sweep so the Map doesn't grow unbounded across many distinct IPs.
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (now > b.resetAt) buckets.delete(key);
  }
}, 5 * 60_000);

/** Returns true if the request is allowed, false if the limit was exceeded. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

export function getClientIp(req: Request): string {
  const h = req.headers;
  // x-forwarded-for is a comma-separated hop chain: client-claimed,
  // proxy1, proxy2, ... - anyone can put whatever they want in the LEFTMOST
  // entries by sending their own x-forwarded-for header directly, so reading
  // [0] (the old bug here) is trivially spoofable and defeats the per-IP
  // limits entirely. Render is the only proxy in front of this app (no CDN),
  // so the RIGHTMOST entry is the one hop we can trust - Render's own edge
  // appends the real connecting IP there, after any client-supplied prefix.
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return h.get('x-real-ip') ?? 'unknown';
}
