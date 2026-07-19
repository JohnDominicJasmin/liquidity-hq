// Server-side admin gate. This is the REAL security boundary for /api/ops/*
// (the /api/admin/* path is a honeypot, not this guard's concern).
// The app has no server session/cookie and no middleware, so every admin route
// must call requireAdmin() itself: validate the bearer token via Supabase Auth,
// then check the email against the ADMIN_EMAILS allowlist BEFORE any service-role
// query runs. Never import the service-role client from a client component - it
// only ever runs inside these guarded route handlers.
import { NextResponse } from 'next/server';
import { createClient, type User } from '@supabase/supabase-js';

// A user-scoped anon client, used only to resolve the bearer token to a user.
// Never touches RLS-protected data with elevated rights - that's the admin client.
function anon(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  );
}

// ADMIN_EMAILS is a server-only, comma-separated allowlist (NOT NEXT_PUBLIC_).
function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}

export type AdminOk = { ok: true; user: User; token: string };

// Returns the authenticated admin user, or a NextResponse (401/403) to return
// immediately. Usage in a route handler:
//
//   const gate = await requireAdmin(req);
//   if (gate instanceof NextResponse) return gate;
//   const { user } = gate; // guaranteed admin from here on
export async function requireAdmin(req: Request): Promise<AdminOk | NextResponse> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await anon(token).auth.getUser();
  const user = data?.user;
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { ok: true, user, token };
}

type AdminCtx = { user: User; token: string };
type AdminHandler<Rest extends unknown[]> =
  (req: Request, ctx: AdminCtx, ...rest: Rest) => Response | Promise<Response>;

// Wrap an admin route handler so the guard is applied BY CONSTRUCTION - there is
// no code path that reaches `handler` without passing requireAdmin first. Prefer
// this over calling requireAdmin by hand in each route, so a newly-added
// /api/ops/* route physically cannot forget the check:
//
//   export const GET = withAdmin(async (req, { user }) => { ... });
//
// `Rest` forwards whatever Next.js passes after `req` (e.g. the { params }
// route context on a dynamic segment like [id]/route.ts) straight through:
//
//   export const GET = withAdmin(async (req, { user }, { params }) => {
//     const { id } = await params;
//   });
export function withAdmin<Rest extends unknown[] = []>(handler: AdminHandler<Rest>) {
  return async (req: Request, ...rest: Rest): Promise<Response> => {
    const gate = await requireAdmin(req);
    if (gate instanceof NextResponse) return gate;
    return handler(req, { user: gate.user, token: gate.token }, ...rest);
  };
}
