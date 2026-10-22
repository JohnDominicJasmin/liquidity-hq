import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { sendWelcomeEmail } from '@/lib/email';
import { T } from '@/lib/tables';
import { classifyWelcomeClaim, missingRowReport } from '@/lib/signupIntegrity';
import { fetchAuthUser, getUserCompat } from '@/lib/authUser';

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

  /* #1397: SIGNED_IN fires on every page load of a signed-in user, and the email goes out once per account. So the token is checked locally,
     and once welcome_email_sent_at is set there is nothing to do: no Auth round trip. Only an account still waiting for its email (the
     first sign-in, or a missing row) takes the full path below, with Auth's own view of the address as before. */
  const { data: { user: local } } = await getUserCompat(token);
  if (!local) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const admin = getSupabaseAdmin();
    const { data: done } = await admin
      .from(T.user_subscriptions)
      .select('welcome_email_sent_at')
      .eq('user_id', local.id)
      .maybeSingle();
    if ((done as { welcome_email_sent_at?: string | null } | null)?.welcome_email_sent_at) {
      return NextResponse.json({ ok: true, sent: false, outcome: classifyWelcomeClaim(false, true) });
    }

    const user = await fetchAuthUser(token);
    if (!user?.email || user.id !== local.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
