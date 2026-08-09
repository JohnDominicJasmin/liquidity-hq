/* Did signup actually give this account its trial?
 *
 * `lhq_grant_signup_trial` is a trigger on `auth.users` that inserts the
 * subscription row in the same transaction as the account. It works, and it is
 * enabled on both projects - verified 2026-08-08. So this is not a fix for a
 * broken trigger.
 *
 * It exists because of what happens if that ever stops being true. #127:
 *
 *   getEntitlement() reads a missing row as `free`, correctly and silently.
 *   A user who signed up and got no trial is indistinguishable from a user
 *   whose trial ended, and from a user who simply did not convert. The symptom
 *   is a missing customer.
 *
 * Nothing would notice. Drop the trigger in a migration and the next hundred
 * signups quietly get no Pro trial, with no error, no log line and nothing in
 * the UI that differs.
 *
 * The one place already positioned to see it is the welcome-email route, which
 * every signup hits and which already reads that row. It just could not tell
 * the two silences apart:
 *
 *   claimed === null  because the email was already sent   -> normal, ignore
 *   claimed === null  because THERE IS NO ROW              -> #127, shout
 *
 * Both returned `{ ok: true, sent: false }`.
 */

export type WelcomeClaim =
  /** Row claimed by this call - first time, send the email. */
  | 'send'
  /** Row exists, welcome_email_sent_at already set. The common repeat call. */
  | 'already-sent'
  /** No subscription row for this user at all. The trigger did not run. */
  | 'missing-subscription-row';

/**
 * Classify the outcome of the atomic claim.
 *
 * Split out from the route so the distinction is testable without a database -
 * the whole defect is that two different states produced one response, and a
 * pure function is where that can be pinned.
 *
 * @param claimed   whether `UPDATE … WHERE welcome_email_sent_at IS NULL`
 *                  matched a row
 * @param rowExists whether a subscription row exists at all. Only meaningful
 *                  when `claimed` is false; the caller should not pay for the
 *                  lookup otherwise.
 */
export function classifyWelcomeClaim(claimed: boolean, rowExists: boolean): WelcomeClaim {
  if (claimed) return 'send';
  return rowExists ? 'already-sent' : 'missing-subscription-row';
}

/** The message reported when a signup produced no trial row. Written out here
 *  so the text a future reader finds in GlitchTip says what to do about it. */
export function missingRowReport(userId: string): string {
  return (
    `Signup produced no ${'user_subscriptions'} row for user ${userId}. ` +
    'The lhq_grant_signup_trial trigger on auth.users did not run, so this ' +
    'account has NO 14-day trial and getEntitlement() will read it as free - ' +
    'silently, and identically to a user whose trial ended. Check the trigger ' +
    'exists on this project before assuming it is one account. See issue #127.'
  );
}
