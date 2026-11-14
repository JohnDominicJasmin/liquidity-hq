import type { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { apiError } from '@/lib/apiError';
import { isBootstrapOwnerEmail } from '@/lib/admin-auth';

type Admin = ReturnType<typeof getSupabaseAdmin>;

/* ADMIN AUDIT TRAIL, CHECKED (security audit #1413, S10). The audit insert used to be fire and forget: the mutation had already happened and, if the insert failed, nothing was
 * logged and no one was told. The insert's error is now checked: a failure is reported to GlitchTip with the action name (never the row), and the caller learns it through the
 * return value so the response can say the change was made but not logged. */
export interface AuditRow {
  actor_email: string | null | undefined;
  action: string;
  target_user_id?: string;
  detail?: Record<string, unknown>;
}

export async function writeAdminAudit(admin: Admin, row: AuditRow): Promise<boolean> {
  try {
    const { error } = await admin.from(T.admin_audit_log).insert({
      actor_email: row.actor_email ?? null,
      action: row.action,
      target_user_id: row.target_user_id ?? null,
      detail: row.detail ?? {},
    });
    if (!error) return true;
    apiError('ops/audit-log', new Error(`audit insert FAILED for action ${row.action}: ${error.message}`));
  } catch (err) {
    apiError('ops/audit-log', new Error(`audit insert threw for action ${row.action}: ${(err as Error)?.message ?? String(err)}`));
  }
  return false;
}

/** Whether this account is an admin (an active admin_users row, or a bootstrap owner email). Fails closed: if the lookup itself fails, the account is treated as protected. */
export async function isProtectedAdminTarget(admin: Admin, userId: string): Promise<boolean> {
  try {
    const { data: row, error } = await admin.from(T.admin_users).select('active').eq('user_id', userId).maybeSingle();
    if (error) return true;
    if (row?.active) return true;
    const { data: au, error: auErr } = await admin.auth.admin.getUserById(userId);
    if (auErr) return true;
    return isBootstrapOwnerEmail(au?.user?.email);
  } catch {
    return true;
  }
}
