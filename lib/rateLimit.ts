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
  return h.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? h.get('x-real-ip')
    ?? 'unknown';
}
