import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { T } from '@/lib/tables';

// Honeypot catch-all for /api/admin and /api/admin/*. The real API moved to
// /api/ops/*. Any request here - GET, POST, whatever - is a scanner or a
// deliberate probe, never a real client (nothing in this app links here).
// Logs best-effort, then returns 404 like a route that never existed.
async function handle(req: Request): Promise<Response> {
  const ip = getClientIp(req);
  // A scanner hitting this in a loop was writing an unbounded, unauthenticated
  // row per request into the real audit log - a cheap way to bury genuine
  // admin actions under noise, or to grow the table without limit. The route
  // still answers every request with the same 404 either way - rate limiting
  // only stops the WRITE, so the honeypot still looks identical to a route
  // that never existed.
  if (!rateLimit(`admin-honeypot:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    // supabase-js resolves { data, error } on a DB-level failure rather than
    // throwing - must check `error` explicitly or a silent failure here is
    // invisible forever. Logged, not thrown: never let logging block the 404.
    const { error } = await getSupabaseAdmin().from(T.admin_audit_log).insert({
      actor_email: 'anonymous',
      action: 'honeypot_admin_api_hit',
      detail: { method: req.method, path: new URL(req.url).pathname, ip },
    });
    if (error) console.error('[honeypot] admin_audit_log insert failed:', error.message);
  } catch (err) {
    console.error('[honeypot] admin_audit_log insert threw:', err);
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
