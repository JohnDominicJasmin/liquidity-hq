/* ACCOUNTS NOBODY CONFIRMED ARE REMOVED AFTER A DAY (owner item #20, PM decision 2026-11-25). Run by the daily purge job with the service
 * role. IT DELETES ACCOUNTS, so every doubt keeps the account: it must be unconfirmed, never signed in, older than 24 hours, an
 * email sign-up that nobody invited or banned, and have nothing of its own in our tables. A failed read removes nothing. */
import type { getSupabaseAdmin } from './supabase-admin.ts';
import { T } from './tables.ts';

/** The caller hands in the service-role client. */
export type AdminClient = ReturnType<typeof getSupabaseAdmin>;

export const UNCONFIRMED_AFTER_MS = 24 * 60 * 60 * 1000;
/** The most one run removes; the rest wait for the next day. */
export const MAX_REMOVALS_PER_RUN = 500;
const PAGE = 1000;
const MAX_PAGES = 100;
const CHUNK = 100;

/** The trial claim the sign-up trigger writes (not in lib/tables.ts: no other code reads it). */
const TRIAL_CLAIMS = T.user_subscriptions.replace(/user_subscriptions$/, 'trial_claims');

export interface AuthAccount {
  id: string;
  created_at?: string | null;
  email_confirmed_at?: string | null;
  phone_confirmed_at?: string | null;
  confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  invited_at?: string | null;
  banned_until?: string | null;
  app_metadata?: { provider?: string; providers?: string[] } | null;
}

export function isStaleUnconfirmed(user: AuthAccount, nowMs: number): boolean {
  if (user.email_confirmed_at || user.phone_confirmed_at || user.confirmed_at || user.last_sign_in_at) return false;
  if (user.invited_at || user.banned_until) return false;
  const providers = user.app_metadata?.providers ?? [user.app_metadata?.provider];
  if (!providers.length || providers.some(p => p !== 'email')) return false;
  const created = Date.parse(user.created_at ?? '');
  return Number.isFinite(created) && nowMs - created > UNCONFIRMED_AFTER_MS;
}

/** Tables whose row means the account has something of its own. `user_subscriptions` is judged separately (every sign-up gets a row). */
const OWN_ROWS: ReadonlyArray<readonly [table: string, column: string]> = [
  [T.user_settings, 'user_id'], [T.user_onboarding, 'user_id'], [T.user_status, 'user_id'], [T.muted_alerts, 'user_id'],
  [T.price_alerts, 'user_id'], [T.push_subscriptions, 'user_id'], [T.telegram_link_codes, 'user_id'], [T.trades, 'user_id'],
  [T.hypotheses, 'user_id'], [T.hypothesis_evidence, 'user_id'], [T.grok_usage, 'user_id'], [T.ai_call_log, 'user_id'],
  [T.admin_users, 'user_id'], [T.admin_audit_log, 'target_user_id'],
];

/** What the sign-up itself and the scheduled jobs write. Any other value in the subscription row keeps the account. */
const SIGNUP_COLUMNS = new Set(['user_id', 'role', 'trial_ends_at', 'updated_at', 'trial_reminder_sent_at']);

export function isUntouchedSubscription(row: Record<string, unknown>): boolean {
  return row.role === 'free' && Object.entries(row).every(([column, value]) => SIGNUP_COLUMNS.has(column) || value === null);
}

type Removal = 'removed' | 'failed' | 'skipped' | 'removed_claim_left';

/** One account, with the two rows its sign-up wrote.
 *
 *  - Its subscription row goes first: the database refuses to delete an account that still has one (no cascade on dev; prod's rule is not
 *    known, and this works either way). If the account then cannot be deleted, the row is put back exactly as it was read.
 *  - ITS TRIAL WAS NEVER USED, so the claim it made goes too, or signing up again would get none. Only AFTER the account is gone, so a
 *    failed run never costs an account its claim. The claim is found by what was read beforehand (the database blanks its account id on
 *    delete), and only a claim left with no account is removed. */
async function removeAccount(admin: AdminClient, id: string): Promise<Removal> {
  const claims = await admin.from(TRIAL_CLAIMS).select('normalized_email').eq('first_user_id', id);
  if (claims.error) return 'failed';
  const subs = await admin.from(T.user_subscriptions).select('*').eq('user_id', id);
  if (subs.error) return 'failed';
  const rows = (subs.data ?? []) as Record<string, unknown>[];
  if (rows.some(row => !isUntouchedSubscription(row))) return 'skipped'; // used since the list was taken

  if (rows.length) {
    const gone = await admin.from(T.user_subscriptions).delete().eq('user_id', id).eq('role', 'free');
    if (gone.error) return 'failed';
  }
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    if (rows.length) {
      const back = await admin.from(T.user_subscriptions).insert(rows);
      if (back.error) console.error(`[unconfirmed-accounts] a sign-up row could not be put back: ${back.error.message}`);
    }
    return 'failed';
  }
  const emails = ((claims.data ?? []) as { normalized_email: string }[]).map(c => c.normalized_email);
  if (emails.length) {
    const cleared = await admin.from(TRIAL_CLAIMS).delete().in('normalized_email', emails).is('first_user_id', null);
    if (cleared.error) {
      console.error(`[unconfirmed-accounts] a trial claim could not be removed: ${cleared.error.message}`);
      return 'removed_claim_left';
    }
  }
  return 'removed';
}

export interface PurgeResult { candidates: number; kept: number; removed: number; failed: number }

export async function purgeUnconfirmedAccounts(admin: AdminClient, opts: { nowMs?: number; dryRun?: boolean } = {}): Promise<PurgeResult> {
  const nowMs = opts.nowMs ?? Date.now();

  const stale: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) throw new Error(`account list failed: ${error.message}`);
    for (const user of data.users) if (isStaleUnconfirmed(user as AuthAccount, nowMs)) stale.push(user.id);
    if (data.users.length < PAGE) break;
  }

  const used = new Set<string>();
  for (let i = 0; i < stale.length; i += CHUNK) {
    const ids = stale.slice(i, i + CHUNK);
    const subs = await admin.from(T.user_subscriptions).select('*').in('user_id', ids);
    if (subs.error) throw new Error(`${T.user_subscriptions} read failed: ${subs.error.message}`);
    for (const row of (subs.data ?? []) as Record<string, unknown>[]) if (!isUntouchedSubscription(row)) used.add(row.user_id as string);
    for (const [table, column] of OWN_ROWS) {
      // The batch is only counted. When it has rows, each account is counted on its own to see whose they are.
      const batch = await admin.from(table).select(column, { count: 'exact', head: true }).in(column, ids);
      if (batch.error) throw new Error(`${table} read failed: ${batch.error.message}`);
      if (batch.count === 0) continue;
      if (batch.count == null) throw new Error(`${table} read gave no count`);
      for (const id of ids) {
        if (used.has(id)) continue;
        const one = await admin.from(table).select(column, { count: 'exact', head: true }).eq(column, id);
        if (one.error || one.count == null) throw new Error(`${table} read failed: ${one.error?.message ?? 'no count'}`);
        if (one.count > 0) used.add(id);
      }
    }
  }

  const removable = stale.filter(id => !used.has(id));
  let removed = 0, failed = 0;
  if (!opts.dryRun) {
    for (const id of removable.slice(0, MAX_REMOVALS_PER_RUN)) {
      // Read again just before deleting: the person may have confirmed since the list was taken.
      const now = await admin.auth.admin.getUserById(id);
      if (now.error || !now.data.user || !isStaleUnconfirmed(now.data.user as AuthAccount, nowMs)) continue;
      const outcome = await removeAccount(admin, id);
      if (outcome === 'removed') removed++;
      else if (outcome === 'failed') failed++;
      else if (outcome === 'removed_claim_left') { removed++; failed++; }
    }
  }
  return { candidates: removable.length, kept: used.size, removed, failed };
}
