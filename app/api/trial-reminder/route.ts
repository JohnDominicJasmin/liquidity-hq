import { NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { checkCronAuth } from '@/lib/cronAuth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { selectAllRows } from '@/lib/selectAllRows';
import { sendTrialEndingEmail } from '@/lib/email';
import { trialReminderCutoff } from '@/lib/trialReminder';
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
  if (!checkCronAuth(req, { headerOnly: true })) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const admin = getSupabaseAdmin();
    const now = Date.now();
    const cutoff = trialReminderCutoff(now, WINDOW_DAYS);

    // role <> 'pro' so someone who already upgraded mid-trial is never nagged.
    // trial_reminder_sent_at null is only a pre-filter - the atomic claim below
    // is what actually guarantees one send.
    //
    // Paged (#1397) - a plain read stops at 1000 rows. Every page is read
    // before the first claim runs, which matters: the claim sets
    // trial_reminder_sent_at, the column this filter excludes on, so paging
    // between claims would shift the offsets and skip rows.
    const { data: due, error } = await selectAllRows('trial-reminder', 'user_id', () => admin
      .from(T.user_subscriptions)
      .select('user_id, trial_ends_at')
      .neq('role', 'pro')
      .not('trial_ends_at', 'is', null)
      .is('trial_reminder_sent_at', null)
      .gt('trial_ends_at', new Date(now).toISOString())
      .lte('trial_ends_at', cutoff));

    if (error) return apiError('trial-reminder', error);
    if (!due?.length) return NextResponse.json({ ok: true, sent: 0 });

    let sent = 0;
    for (const row of due) {
      /* THE ADDRESS IS CHECKED BEFORE THE CLAIM (B5/#5). The email lives in auth.users (not reachable through .from()); one lookup per due row is a handful a day. Only a CONFIRMED, NOT-BANNED address is mailed: a sign-up
         with someone else's address that was never confirmed used to get a "trial ending" email sent to that person. A skipped row keeps its claim free, so it is mailed once the address is confirmed (inside the window). */
      const { data: userRes } = await admin.auth.admin.getUserById(row.user_id);
      const u = userRes?.user;
      const email = u?.email;
      if (!email || !u?.email_confirmed_at) continue;
      const bannedUntil = (u as { banned_until?: string | null }).banned_until;
      if (bannedUntil && new Date(bannedUntil).getTime() > now) continue;

      // Claim, then send: the claim is what guarantees one send when two runs overlap.
      const { data: claimed } = await admin
        .from(T.user_subscriptions)
        .update({ trial_reminder_sent_at: new Date().toISOString() })
        .eq('user_id', row.user_id)
        .is('trial_reminder_sent_at', null)
        .select('user_id')
        .maybeSingle();
      if (!claimed) continue; // another run got there first

      const msLeft = new Date(row.trial_ends_at as string).getTime() - now;
      const daysLeft = Math.max(1, Math.ceil(msLeft / 86_400_000));
      if (await sendTrialEndingEmail({ to: email, daysLeft })) { sent++; continue; }
      /* THE CLAIM GOES BACK WHEN THE SEND FAILS (#5). It used to stay, so one Brevo failure meant this user was never reminded. The row is only a candidate while the trial has not ended (the read above filters on it), so a
         permanently failing address is retried each run only until its trial ends, not for ever. */
      await admin.from(T.user_subscriptions).update({ trial_reminder_sent_at: null }).eq('user_id', row.user_id);
    }

    return NextResponse.json({ ok: true, due: due.length, sent });
  } catch (e) {
    return apiError('trial-reminder', e);
  }
}
