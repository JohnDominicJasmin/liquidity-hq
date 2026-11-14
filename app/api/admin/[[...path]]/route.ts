import { NextResponse } from 'next/server';
import { getClientIp } from '@/lib/rateLimit';
import { logHoneypotHit } from '@/lib/honeypot';

// Honeypot catch-all for /api/admin and /api/admin/*. The real API moved to
// /api/ops/*. Any request here - GET, POST, whatever - is a scanner or a
// deliberate probe, never a real client (nothing in this app links here).
// Records ONE bounded line in the server log (lib/honeypot.ts) - never the real
// admin audit log, which an attacker-chosen path used to be written into - then
// returns 404 like a route that never existed. The answer is identical either way.
async function handle(req: Request): Promise<Response> {
  logHoneypotHit('admin_api', {
    method: req.method,
    path: new URL(req.url).pathname,
    ip: getClientIp(req),
    ua: req.headers.get('user-agent'),
  });
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
