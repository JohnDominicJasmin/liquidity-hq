import { NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { withAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { decideWhopEvent, readWhopPayment, whopCompanyMatches } from '@/lib/whopEntitlement';
import { WHOP_APPLIED_EVENT, WHOP_PENDING_CLAIM_EVENT, WHOP_RETRY_EVENT } from '@/lib/whopGrant';

export const dynamic = 'force-dynamic';

/* GET /api/ops/whop/deliveries (#1630 GO-LIVE 3): READ-ONLY visibility into the recent Whop payment deliveries, for an admin.
 *
 * For each stored payment.succeeded delivery: the plan id, amount and currency it carries, whether it carries a payer email (a boolean, never the
 * address), what the unlock's rules decide for it NOW with this environment's settings (a dry run: nothing is written), whether the company check
 * passes, and the state of its three small rows: applied (Pro was given for this payment), a pending claim (paid, waiting for the payer's account),
 * a retry (refused for a settings reason, being re-run hourly for 7 days).
 *
 * There is deliberately NO "re-run" or "grant" action here: the owner's rule is that Pro is never applied by hand. A settings fix reaches a
 * refused payment through the hourly retry (lib/whopGrant.ts retryRefusedWhopDeliveries), by the same rules as the webhook. */
const LIMIT = 50;

export const GET = withAdmin(async () => {
  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin
    .from(T.whop_webhook_events)
    .select('payload_hash, resource_id, received_at, body')
    .eq('event', 'payment.succeeded')
    .order('received_at', { ascending: false })
    .limit(LIMIT);
  if (error) return apiError('ops/whop/deliveries', error);

  const ids = [...new Set((rows ?? []).map(r => r.resource_id).filter((v): v is string => typeof v === 'string' && v.length > 0))];
  const markers = new Map<string, { applied: boolean; pendingClaim: boolean; retry: { reason: string | null; firstRefusedAt: string | null; attempts: number } | null }>();
  if (ids.length) {
    const { data: ms, error: mErr } = await admin
      .from(T.whop_webhook_events)
      .select('event, resource_id, body')
      .in('event', [WHOP_APPLIED_EVENT, WHOP_PENDING_CLAIM_EVENT, WHOP_RETRY_EVENT])
      .in('resource_id', ids);
    if (mErr) return apiError('ops/whop/deliveries', mErr);
    for (const m of ms ?? []) {
      const id = String(m.resource_id);
      const cur = markers.get(id) ?? { applied: false, pendingClaim: false, retry: null };
      if (m.event === WHOP_APPLIED_EVENT) cur.applied = true;
      if (m.event === WHOP_PENDING_CLAIM_EVENT) cur.pendingClaim = true;
      if (m.event === WHOP_RETRY_EVENT) {
        const b = (typeof m.body === 'object' && m.body !== null ? m.body : {}) as { reason?: unknown; first_refused_at?: unknown; attempts?: unknown };
        cur.retry = {
          reason: typeof b.reason === 'string' ? b.reason : null,
          firstRefusedAt: typeof b.first_refused_at === 'string' ? b.first_refused_at : null,
          attempts: typeof b.attempts === 'number' ? b.attempts : 0,
        };
      }
      markers.set(id, cur);
    }
  }

  const deliveries = (rows ?? []).map(r => {
    const event = (typeof r.body === 'object' && r.body !== null ? r.body : {}) as Record<string, unknown>;
    const p = readWhopPayment(event);
    const d = decideWhopEvent(event, process.env);
    const id = typeof r.resource_id === 'string' ? r.resource_id : null;
    return {
      paymentId: id,
      receivedAt: r.received_at ?? null,
      planId: p?.planId ?? null,
      amount: p?.amount ?? null,
      currency: p?.currency ?? null,
      hasPayerEmail: !!p?.payerEmail,
      // The decision NOW, without the payer email it carries for a grant.
      decisionNow: d.kind === 'grant' ? { kind: 'grant', plan: d.plan } : { kind: d.kind, reason: d.reason },
      companyMatches: p ? whopCompanyMatches(p, process.env.WHOP_COMPANY_ID) : null,
      ...(id ? markers.get(id) ?? { applied: false, pendingClaim: false, retry: null } : { applied: false, pendingClaim: false, retry: null }),
    };
  });

  return NextResponse.json({ deliveries, limit: LIMIT });
});
