import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { apiError } from '@/lib/apiError';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { sendWelcomeEmail } from '@/lib/email';
import { T } from '@/lib/tables';
import { classifyWelcomeClaim, missingRowReport } from '@/lib/signupIntegrity';

export const dynamic = 'force-dynamic';

// POST /api/auth/welcome-email
// Called from AuthProvider on every SIGNED_IN event, for every signup method
// (password, magic-link, Google) - all three converge on the same auth.users
// insert, so there's no reliable "is this really new" signal on the client.
// Idempotency instead lives here: welcome_email_sent_at is claimed atomically
// (UPDATE ... WHERE ... IS NULL), so however many times this gets called for
// an account, the email itself only ever goes out once.
export async function POST(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const admin = getSupabaseAdmin();
    // The signup trigger (lhq_grant_signup_trial) inserts this row in the same
    // transaction as auth.users, so by the time a client can be signed in and
    // calling this route, the row already exists - .maybeSingle() still guards
    // gracefully if that's ever not true.
    const { data: claimed, error } = await admin
      .from(T.user_subscriptions)
      .update({ welcome_email_sent_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('welcome_email_sent_at', null)
      .select('user_id')
      .maybeSingle();

    if (error) return apiError('auth/welcome-email', error);

    if (!claimed) {
      /* `claimed` is null for two completely different reasons, and this route
         used to answer both with `{ ok: true, sent: false }`:

           - the row exists and the email already went out  -> normal
           - THERE IS NO ROW                                -> #127

         The second means the signup trigger did not run, so the account has no
         14-day trial - and nothing anywhere would say so, because
         getEntitlement() reads a missing row as `free` exactly as it reads an
         expired trial. This route is the only code every signup passes through
         that already looks at that row, so it is where the difference can be
         noticed at all. */
      const { data: row } = await admin
        .from(T.user_subscriptions)
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();

      const outcome = classifyWelcomeClaim(false, !!row);
      if (outcome === 'missing-subscription-row') {
        // Reported, not thrown. The user is signed in and their session is
        // fine; failing their first request would turn a silent defect into a
        // broken signup. Loud where it needs to be loud - GlitchTip - and
        // invisible where the user is concerned.
        apiError('auth/welcome-email', new Error(missingRowReport(user.id)));
      }

      return NextResponse.json({ ok: true, sent: false, outcome });
    }

    const sent = await sendWelcomeEmail({ to: user.email });
    return NextResponse.json({ ok: true, sent });
  } catch (e) {
    return apiError('auth/welcome-email', e);
  }
}
