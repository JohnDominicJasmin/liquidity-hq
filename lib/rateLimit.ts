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

// RFC 1918 + loopback - Render's own internal network hop shows up in
// x-forwarded-for as one of these (observed live: "...,  172.68.225.26,
// 10.29.78.132" - a 10.x.x.x address, matching the internal address Render's
// own boot log prints for the instance itself), not a real client address.
function isPrivateIp(ip: string): boolean {
  if (/^10\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^127\./.test(ip)) return true;
  if (ip === '::1') return true;
  return false;
}

export function getClientIp(req: Request): string {
  const h = req.headers;
  // x-forwarded-for is a comma-separated hop chain. Client-supplied content
  // can only ever be a PREFIX of what we see - each proxy in front of this
  // app appends its own observed connecting IP rather than replacing the
  // header, so the trailing hops are the ones we can trust regardless of
  // what a caller stuffs into their own request.
  //
  // This used to assume exactly one trusted proxy (Render) and read the
  // rightmost hop outright. Live testing found a real 3-hop chain -
  // [client, an intermediate edge, Render's own internal instance IP] - so
  // the rightmost hop was actually Render's private network address, the
  // SAME value for every caller. That silently merged every distinct
  // client into one shared rate-limit bucket, which is how a client could
  // send far more than the stated per-IP limit and never get blocked: the
  // limiter was real, it just was not keyed by IP at all in practice.
  //
  // Fix: walk from the right and skip past private/internal addresses:
  // spoof-resistant for the same reason as before (only trailing,
  // proxy-appended hops are trusted), and no longer assumes a fixed chain
  // length.
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map(s => s.trim()).filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i--) {
      if (!isPrivateIp(hops[i])) return hops[i];
    }
    if (hops.length) return hops[hops.length - 1];
  }
  return h.get('x-real-ip') ?? 'unknown';
}
