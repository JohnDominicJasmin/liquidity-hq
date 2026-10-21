import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { claimPendingForAccount } from '@/lib/whopGrant';
import { userClient } from '@/lib/supabase-user';

export const dynamic = 'force-dynamic';

/* POST /api/whop/claim (#1567). Called by AuthProvider on a real sign-in (the same moment as the welcome-email check), with the user's token.
 *
 * A buyer who paid on Whop BEFORE they had a LiquidityHQ account (or before their address was confirmed) has a paid payment that the webhook
 * could not give to anyone. The webhook left a pending claim for that email. This route is the other half: it grants every pending paid
 * Whop payment for the CALLER'S confirmed email, once each, by the same rules as the webhook (lib/whopGrant.ts). No manual step.
 *
 * WHO CAN CLAIM WHAT: only the account whose CONFIRMED email equals the payer's email. The email is read from the verified token's user, never
 * from the request body, so a caller cannot name someone else's address. An unconfirmed address claims nothing.
 *
 * WHAT IT SAYS: only how many payments it applied. It does not say whether a claim existed, why one was refused, or anything about a payment,
 * so it cannot be used to ask "did someone with this email pay?". Refusals and errors are reported (GlitchTip) with ids, never emails.
 *
 * SAFE TO CALL ANY NUMBER OF TIMES: a claim is taken by deleting its pending row, which succeeds for one caller only. */
export async function POST(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = userClient(token);
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Per account, not per address: a page reload loop must not become a table scan loop.
  if (!rateLimit(`whop-claim:${user.id}:${getClientIp(req)}`, 10, 60_000)) return NextResponse.json({ granted: 0 }, { status: 429 });
  // No confirmed email, nothing to claim. Answered like "nothing to claim" so the caller learns nothing.
  if (!user.email || !user.email_confirmed_at) return NextResponse.json({ granted: 0 });

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    return apiError('whop/claim', e);
  }
  const r = await claimPendingForAccount(admin, { userId: user.id, email: user.email });
  if (r.refused.length > 0) apiError('whop/claim', new Error(`NEEDS MANUAL REVIEW, claim refused for account ${user.id}: ${r.refused.join(', ')}`));
  if (r.error && r.granted === 0) return apiError('whop/claim', r.error);
  return NextResponse.json({ granted: r.granted });
}
