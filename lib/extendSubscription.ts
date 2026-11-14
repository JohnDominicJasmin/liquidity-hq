import type { getSupabaseAdmin } from '@/lib/supabase-admin';

type Admin = ReturnType<typeof getSupabaseAdmin>;

/* THE ATOMIC SUBSCRIPTION EXTENSION (security / idempotency audit #1413; migration 20261106b, owner-approved 2026-11-14).
 *
 * The grant used to read the stored period end, compute the new one in JS and upsert it. Two DIFFERENT payments for one account landing together both read the same end
 * and the second write replaced the first: the customer paid twice and got one period. `lhq_extend_subscription` does the whole thing in ONE statement under the row lock,
 * so each caller extends from the other's result. This wrapper calls it and says plainly what happened.
 *
 * `unavailable` means the function does not exist on this database yet (the migration is applied per project). The CALLER then keeps its old read-compute-write path,
 * because a grant that fails is "paid and not Pro", which is worse than the race. Any other failure is `error`. */

const FN = process.env.NEXT_PUBLIC_APP_ENV === 'dev' ? 'lhq_dev_extend_subscription' : 'lhq_extend_subscription';

export type ExtendResult =
  | { kind: 'granted'; periodEnd: Date }
  | { kind: 'admin_grant' }
  | { kind: 'unavailable' }
  | { kind: 'error'; err: unknown };

export function isMissingFunction(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  return err.code === 'PGRST202' || err.code === '42883' || /could not find the function|function .* does not exist/i.test(err.message ?? '');
}

export async function extendSubscription(
  sb: Admin,
  a: { userId: string; add: { months?: number; days?: number }; plan: string | null; provider: 'whop' | 'boomfi'; now: Date },
): Promise<ExtendResult> {
  const { data, error } = await sb.rpc(FN, {
    p_user_id: a.userId,
    p_months: a.add.months ?? 0,
    p_days: a.add.days ?? 0,
    p_plan: a.plan,
    p_provider: a.provider,
    p_now: a.now.toISOString(),
  });
  if (error) return isMissingFunction(error) ? { kind: 'unavailable' } : { kind: 'error', err: error };
  const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string; period_end?: string | null } | null | undefined;
  if (!row || typeof row.outcome !== 'string') return { kind: 'error', err: new Error('lhq_extend_subscription returned no row') };
  if (row.outcome === 'admin_grant') return { kind: 'admin_grant' };
  if (row.outcome === 'granted' && row.period_end) {
    const periodEnd = new Date(row.period_end);
    if (!Number.isNaN(periodEnd.getTime())) return { kind: 'granted', periodEnd };
  }
  return { kind: 'error', err: new Error(`lhq_extend_subscription returned an unexpected outcome: ${String(row.outcome)}`) };
}
