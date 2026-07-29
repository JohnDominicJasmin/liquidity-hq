import { NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { checkCronAuth } from '@/lib/cronAuth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { sendTrialEndingEmail } from '@/lib/email';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

// Cron-only. Emails anyone whose 14-day Pro trial is nearly over.
//
// Why this exists: the trial START is announced twice (welcome email, plus the
// always-visible TrialBanner countdown), but the END was completely silent -
// the banner simply vanished and every Pro feature locked with no explanation.
// A user who signed up, got busy, and came back weeks later found a downgraded
// account and no record that a trial had ever run. This is the only notice
// that reaches someone who is NOT currently signed in, which is exactly the
// person the banner cannot help.
//
// Scheduling: run once daily. The window below is 2 days wide, so the exact
// hour does not matter and a missed day still catches everyone - but the job
// MUST be registered on cron-job.org with the x-cron-secret header, or it
// simply never runs (checkCronAuth fails closed by design). See
// docs/INFRASTRUCTURE.md.
const WINDOW_DAYS = 2;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const admin = getSupabaseAdmin();
    const now = Date.now();
    const cutoff = new Date(now + WINDOW_DAYS * 86_400_000).toISOString();

    // role <> 'pro' so someone who already upgraded mid-trial is never nagged.
    // trial_reminder_sent_at null is only a pre-filter - the atomic claim below
    // is what actually guarantees one send.
    const { data: due, error } = await admin
      .from(T.user_subscriptions)
      .select('user_id, trial_ends_at')
      .neq('role', 'pro')
      .not('trial_ends_at', 'is', null)
      .is('trial_reminder_sent_at', null)
      .gt('trial_ends_at', new Date(now).toISOString())
      .lte('trial_ends_at', cutoff);

    if (error) return apiError('trial-reminder', error);
    if (!due?.length) return NextResponse.json({ ok: true, sent: 0 });

    let sent = 0;
    for (const row of due) {
      // Claim first, send second. If the send fails we do NOT roll the claim
      // back: a trial reminder is worth strictly less than the risk of looping
      // on a permanently-failing address and hammering Brevo every run. Same
      // trade-off the welcome email makes.
      const { data: claimed } = await admin
        .from(T.user_subscriptions)
        .update({ trial_reminder_sent_at: new Date().toISOString() })
        .eq('user_id', row.user_id)
        .is('trial_reminder_sent_at', null)
        .select('user_id')
        .maybeSingle();
      if (!claimed) continue; // another run got there first

      // The email lives in auth.users, which is not reachable through .from().
      // Per-user lookup is fine here: this is a handful of rows a day, not a
      // scan - and it keeps the address out of any table we query in bulk.
      const { data: userRes } = await admin.auth.admin.getUserById(row.user_id);
      const email = userRes?.user?.email;
      if (!email) continue;

      const msLeft = new Date(row.trial_ends_at as string).getTime() - now;
      const daysLeft = Math.max(1, Math.ceil(msLeft / 86_400_000));
      if (await sendTrialEndingEmail({ to: email, daysLeft })) sent++;
    }

    return NextResponse.json({ ok: true, due: due.length, sent });
  } catch (e) {
    return apiError('trial-reminder', e);
  }
}
