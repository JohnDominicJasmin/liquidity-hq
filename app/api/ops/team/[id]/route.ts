import { NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { withOwner } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/ops/team/[id] - change an admin's role or active flag (owner-only).
// You cannot change your own row, so an owner can't accidentally demote or
// deactivate themselves and get locked out.
export const PATCH = withOwner<[Ctx]>(async (req, { user }, { params }) => {
  const { id } = await params;
  if (id === user.id) {
    return NextResponse.json({ error: 'You cannot change your own admin role.' }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (body.role !== undefined) patch.role = body.role === 'owner' ? 'owner' : 'staff';
  if (body.active !== undefined) patch.active = !!body.active;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from(T.admin_users).update(patch).eq('user_id', id);
  if (error) return apiError('ops/team/[id]', error);

  await admin.from(T.admin_audit_log).insert({
    actor_email: user.email,
    action: 'admin_update',
    target_user_id: id,
    detail: patch,
  });

  return NextResponse.json({ ok: true });
});

// DELETE /api/ops/team/[id] - revoke admin access (owner-only). Removes the
// admin_users row only; it does NOT delete the person's Supabase auth account
// (they may still be a regular app user). You cannot remove yourself.
export const DELETE = withOwner<[Ctx]>(async (_req, { user }, { params }) => {
  const { id } = await params;
  if (id === user.id) {
    return NextResponse.json({ error: 'You cannot remove your own admin access.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from(T.admin_users).delete().eq('user_id', id);
  if (error) return apiError('ops/team/[id]', error);

  await admin.from(T.admin_audit_log).insert({
    actor_email: user.email,
    action: 'admin_remove',
    target_user_id: id,
    detail: {},
  });

  return NextResponse.json({ ok: true });
});
