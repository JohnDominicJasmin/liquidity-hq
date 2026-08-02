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

export function getClientIp(req: Request): string {
  const h = req.headers;

  // This app sits behind Cloudflare in front of Render - two proxy hops, not
  // one. cf-connecting-ip is Cloudflare's own purpose-built header for this
  // exact problem: it's the client IP Cloudflare itself observed on the
  // incoming connection, and Cloudflare overwrites any client-supplied value
  // for this header before setting its own - unlike x-forwarded-for, which a
  // client can prepend to freely. Confirmed live (TEMP-DEBUG round 3): this
  // header carries the same value that stayed constant across a whole burst
  // of requests from one real client, while every other candidate did not
  // (see below). true-client-ip is Cloudflare Enterprise's equivalent name
  // for the same value - checked as a second source, not because either
  // alone was in doubt.
  const cf = h.get('cf-connecting-ip') ?? h.get('true-client-ip');
  if (cf) return cf;

  // Fallback for any request that somehow reaches this app without going
  // through Cloudflare (e.g. a future infra change, or local testing against
  // Render directly). x-forwarded-for's hop count turned out NOT to be the
  // fixed 2 this originally assumed:
  //
  // Live testing found 3 hops - [client, a Cloudflare edge machine, Render's
  // own internal instance IP] - and, worse, the MIDDLE hop varies request to
  // request even from the same real client (Cloudflare's anycast network
  // routes different requests to different edge machines), so it can never
  // be a stable per-client rate-limit key regardless of which position it's
  // read from. Only cf-connecting-ip is both stable and unspoofable here.
  //
  // This fallback path just skips Render's own known-private trailing hop
  // and returns whatever's left - it will NOT reliably separate distinct
  // clients the way the primary path does, but it is strictly better than
  // returning Render's own IP for every caller, which is what silently
  // shipped before this fix (every distinct client shared one bucket, so
  // the limiter never actually triggered per-IP).
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
