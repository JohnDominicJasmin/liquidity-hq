import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

// Honeypot catch-all for /api/admin and /api/admin/*. The real API moved to
// /api/ops/*. Any request here - GET, POST, whatever - is a scanner or a
// deliberate probe, never a real client (nothing in this app links here).
// Logs best-effort, then returns 404 like a route that never existed.
async function handle(req: Request): Promise<Response> {
  try {
    await getSupabaseAdmin().from(T.admin_audit_log).insert({
      actor_email: 'anonymous',
      action: 'honeypot_admin_api_hit',
      detail: { method: req.method, path: new URL(req.url).pathname },
    });
  } catch {
    // Best-effort - never let logging block the 404.
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
