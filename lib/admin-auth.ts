// Server-side admin gate. This is the REAL security boundary for /api/ops/*
// (the /api/admin/* path is a honeypot, not this guard's concern).
//
// Membership + roles live in the admin_users table (managed from the /ops Team
// page), NOT in an env var. ADMIN_EMAILS remains only as an emergency bootstrap
// owner, so you can never lock yourself out even if the table is empty/unreadable.
//
// The app has no server session/cookie and no proxy(middleware), so every admin
// route validates the bearer token via Supabase Auth, then resolves the user's
// role BEFORE any privileged work. Passwords live in Supabase Auth, never here.
import { NextResponse } from 'next/server';
import { createClient, type User } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export type AdminRole = 'owner' | 'staff';

// A user-scoped anon client, used only to resolve the bearer token to a user.
function anon(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  );
}

// Emergency-bootstrap owners: server-only, comma-separated (NOT NEXT_PUBLIC_).
function bootstrapOwnerEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

// Resolve a validated auth user to their admin role, or null if not an admin.
//  1. ADMIN_EMAILS is always treated as owner, and self-seeded into admin_users
//     (only writing when the row is missing/stale) so the table stays the source
//     of truth and the owner is never locked out.
//  2. Everyone else: looked up in admin_users. active row -> its role; else deny.
async function resolveRole(user: User): Promise<AdminRole | null> {
  const email = user.email?.toLowerCase() ?? null;

  if (email && bootstrapOwnerEmails().includes(email)) {
    // Best-effort self-seed; getSupabaseAdmin() is inside the try so a missing
    // service-role key (or table hiccup) never blocks the bootstrap owner.
    try {
      const admin = getSupabaseAdmin();
      const { data } = await admin.from(T.admin_users)
        .select('role, active').eq('user_id', user.id).maybeSingle();
      if (!data || !data.active || data.role !== 'owner') {
        await admin.from(T.admin_users).upsert(
          { user_id: user.id, email, role: 'owner', active: true },
          { onConflict: 'user_id' },
        );
      }
    } catch { /* ignore - bootstrap owner is allowed regardless */ }
    return 'owner';
  }

  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin.from(T.admin_users)
      .select('role, active').eq('user_id', user.id).maybeSingle();
    if (data && data.active) return data.role === 'owner' ? 'owner' : 'staff';
  } catch { /* missing key / table / transient -> deny (fail closed) */ }
  return null;
}

export type AdminCtx = { user: User; token: string; role: AdminRole };
export type AdminOk = { ok: true } & AdminCtx;

// Returns the authenticated admin (with role), or a NextResponse (401/403).
export async function requireAdmin(req: Request): Promise<AdminOk | NextResponse> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await anon(token).auth.getUser();
  const user = data?.user;
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = await resolveRole(user);
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return { ok: true, user, token, role };
}

type AdminHandler<Rest extends unknown[]> =
  (req: Request, ctx: AdminCtx, ...rest: Rest) => Response | Promise<Response>;

// Wrap a route so the admin guard is applied BY CONSTRUCTION - no code path
// reaches `handler` without passing requireAdmin first. `Rest` forwards Next's
// route context (e.g. { params } on a [id] segment).
//
//   export const GET = withAdmin(async (req, { user, role }) => { ... });
export function withAdmin<Rest extends unknown[] = []>(handler: AdminHandler<Rest>) {
  return async (req: Request, ...rest: Rest): Promise<Response> => {
    const gate = await requireAdmin(req);
    if (gate instanceof NextResponse) return gate;
    return handler(req, { user: gate.user, token: gate.token, role: gate.role }, ...rest);
  };
}

// Same as withAdmin, but additionally requires role === 'owner'. Use for
// privileged actions staff must not perform (managing the admin team).
export function withOwner<Rest extends unknown[] = []>(handler: AdminHandler<Rest>) {
  return async (req: Request, ...rest: Rest): Promise<Response> => {
    const gate = await requireAdmin(req);
    if (gate instanceof NextResponse) return gate;
    if (gate.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return handler(req, { user: gate.user, token: gate.token, role: gate.role }, ...rest);
  };
}
