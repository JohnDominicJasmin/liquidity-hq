import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { apiError } from '@/lib/apiError';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

function isBannedError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'user_banned' || /banned/i.test(error.message ?? '');
}

const userIdByEmailFn = process.env.NEXT_PUBLIC_APP_ENV === 'dev'
  ? 'lhq_dev_user_id_by_email'
  : 'lhq_user_id_by_email';

// POST /api/auth/ban-reason { email, password }
// Re-verifies the password server-side before ever looking at ban_reason -
// this is the ownership proof. A bare client-supplied email with no proof
// would let anyone probe whether an arbitrary address is banned and why;
// only calls that fail signInWithPassword with a genuine ban error (i.e.
// the password was right) get a reason back. Anything else - wrong
// password, no such account, not actually banned - returns null, same
// shape either way, so the response itself never distinguishes them.
export async function POST(req: NextRequest) {
  // This route runs a REAL signInWithPassword per call - unlike the public
  // data routes (20/min per IP is fine for a price lookup), a caller here is
  // trying a live credential, so the same limit would make this a
  // credential-stuffing endpoint. Tighter than those, in line with the other
  // auth-adjacent routes (telegram/test, telegram/link-code) at 5/min.
  // TEMP-DEBUG round 2: fix didn't resolve it - comparing xff across several
  // requests to see which hop actually stays stable. Sanitized (see prior
  // commit's log-injection note) - remove after.
  const _sanitizeForLog = (s: string | null) => (s ?? '').replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 200);
  const _dbgKey = getClientIp(req);
  console.log(`[TEMP-DEBUG3 ban-reason] resolvedKey=${_sanitizeForLog(_dbgKey)} xff="${_sanitizeForLog(req.headers.get('x-forwarded-for'))}" cfConnectingIp="${_sanitizeForLog(req.headers.get('cf-connecting-ip'))}" trueClientIp="${_sanitizeForLog(req.headers.get('true-client-ip'))}"`);
  if (!rateLimit(`ban-reason:${_dbgKey}`, 5, 60_000)) {
    return NextResponse.json({ reason: null }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return NextResponse.json({ reason: null });

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (!isBannedError(error)) return NextResponse.json({ reason: null });

  try {
    const admin = getSupabaseAdmin();
    const { data: userId, error: idErr } = await admin.rpc(userIdByEmailFn, { p_email: email });
    if (idErr || !userId) return NextResponse.json({ reason: null });

    const { data: sub } = await admin
      .from(T.user_subscriptions)
      .select('ban_reason')
      .eq('user_id', userId)
      .maybeSingle();

    return NextResponse.json({ reason: sub?.ban_reason ?? null });
  } catch (e) {
    return apiError('auth/ban-reason', e);
  }
}
