import { NextResponse } from 'next/server';
import { withOwner } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { sendAdminAddedEmail } from '@/lib/email';
import type { SupabaseClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Supabase Auth has no getUserByEmail; page through admin listUsers to find one.
async function findUserByEmail(admin: SupabaseClient, email: string) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return null;
    const hit = data.users.find(u => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 1000) break;
  }
  return null;
}

// GET /api/ops/team - list all admins (owner-only).
export const GET = withOwner(async () => {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from(T.admin_users)
    .select('user_id, email, role, active, created_at')
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ admins: data ?? [] });
});

// POST /api/ops/team - add a staff/owner (owner-only).
// Body: { email, password, role }. Creates a pre-confirmed Supabase auth user if
// the email is new (so they can log in immediately), or grants admin access to an
// existing account without touching its password. Passwords live in Supabase
// Auth, never in our tables.
export const POST = withOwner(async (req, { user }) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const role = body.role === 'owner' ? 'owner' : 'staff';

  if (!/.+@.+\..+/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Reuse an existing account if the email is already registered; otherwise
  // create a fresh pre-confirmed one with the given password.
  let userId: string;
  let passwordSet: boolean;
  const existing = await findUserByEmail(admin, email);
  if (existing) {
    userId = existing.id;
    passwordSet = false;
  } else {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) {
      return NextResponse.json({ error: created.error?.message ?? 'Could not create user.' }, { status: 400 });
    }
    userId = created.data.user.id;
    passwordSet = true;
  }

  const { error: upErr } = await admin.from(T.admin_users).upsert(
    { user_id: userId, email, role, active: true, created_by: user.id },
    { onConflict: 'user_id' },
  );
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Best-effort heads-up email to the added admin. Never blocks the add: if the
  // provider is unconfigured or fails, emailSent is just false.
  const emailSent = await sendAdminAddedEmail({ to: email, role, invitedBy: user.email });

  await admin.from(T.admin_audit_log).insert({
    actor_email: user.email,
    action: 'admin_add',
    target_user_id: userId,
    detail: { email, role, passwordSet, emailSent },
  });

  return NextResponse.json({ ok: true, user_id: userId, email, role, passwordSet, emailSent });
});
