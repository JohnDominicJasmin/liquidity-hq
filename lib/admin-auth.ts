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
import type { User } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { userClient } from '@/lib/supabase-user';
import { bearerToken } from './bearerToken.ts';

export type AdminRole = 'owner' | 'staff';

// A user-scoped anon client, used only to resolve the bearer token to a user.
function anon(token: string) {
  return userClient(token);
}

// Emergency-bootstrap owners: server-only, comma-separated (NOT NEXT_PUBLIC_).
function bootstrapOwnerEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Whether an email is one of the emergency-bootstrap owners (ADMIN_EMAILS). */
export function isBootstrapOwnerEmail(email: string | null | undefined): boolean {
  return !!email && bootstrapOwnerEmails().includes(email.toLowerCase());
}

// Resolve a validated auth user to their admin role, or null if not an admin.
//  1. ADMIN_EMAILS is always treated as owner, and self-seeded into admin_users
//     (only writing when the row is missing/stale) so the table stays the source
//     of truth and the owner is never locked out.
//  2. Everyone else: looked up in admin_users. active row -> its role; else deny.
async function resolveRole(user: User): Promise<AdminRole | null> {
  const email = user.email?.toLowerCase() ?? null;

  /* Bootstrap owner requires a confirmed email. */
  if (email && user.email_confirmed_at && bootstrapOwnerEmails().includes(email)) {
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

/* The session's assurance level, read from the access token AFTER Auth has accepted that token (getUser above), so the claim is the
   server's own. 'aal2' means a second factor was checked for this session. Anything unreadable is not aal2. */
function assuranceLevel(token: string): string | null {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { aal?: unknown };
    return typeof claims.aal === 'string' ? claims.aal : null;
  } catch { return null; }
}

/** The second factor is required for every admin route. OPS_SECOND_FACTOR_OFF=1 is the way back in if the factor service itself is unavailable. */
function secondFactorRequired(): boolean {
  return process.env.OPS_SECOND_FACTOR_OFF !== '1';
}

export type AdminCtx = { user: User; token: string; role: AdminRole };
export type AdminOk = { ok: true } & AdminCtx;

// Returns the authenticated admin (with role), or a NextResponse (401/403).
export async function requireAdmin(req: Request): Promise<AdminOk | NextResponse> {
  const token = bearerToken(req.headers);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await anon(token).auth.getUser();
  const user = data?.user;
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = await resolveRole(user);
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  /* Told apart from "not an admin" only AFTER the role check, so a non-admin learns nothing new. */
  if (secondFactorRequired() && assuranceLevel(token) !== 'aal2') {
    return NextResponse.json({ error: 'Second factor required', code: 'MFA_REQUIRED' }, { status: 403 });
  }
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
