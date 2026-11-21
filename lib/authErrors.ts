import type { LabelKey } from '@/lib/labelKeys';
// Supabase's raw ban error text ("User is banned", sometimes with a
// until-timestamp appended) leaks internal wording straight to the sign-in
// screen. Swap it for a message that tells the user what actually happened
// without echoing GoTrue's phrasing.
type TFn = (key: LabelKey, vars?: Record<string, string | number>) => string;

/* `t` is optional on purpose (#1185): called without it the English text comes back exactly as before; the pages pass their label function so ko / zh / ru / ar visitors read it in their language. */
export function friendlyAuthError(message: string, t?: TFn): string {
  const L = (key: LabelKey, en: string) => (t ? t(key) : en);
  /* GoTrue's raw "Email not confirmed" left a user with an expired confirmation link guessing; the sign-in screen now says what to do and offers a resend (isEmailNotConfirmed). */
  if (isEmailNotConfirmed(message)) return L('AUTH_ERR_EMAIL_NOT_CONFIRMED', 'Please confirm your email first. Check your inbox, or resend the confirmation email.');
  if (/banned/i.test(message)) {
    return L('AUTH_ERR_SUSPENDED', 'This account has been suspended. Contact support if you believe this is a mistake.');
  }
  /* GoTrue spells out its password policy by listing the raw character sets -
     "Password should contain at least one character of each:
     abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789." -
     which lands on the sign-up screen as a wall of alphabet.

     The client now checks the same policy before submitting (see
     lib/passwordPolicy.ts), so this should be unreachable. It stays as a
     backstop for the case that actually bites: someone changes the policy in
     the Supabase dashboard and not in the code, and this is the only thing
     standing between that and the user seeing the alphabet again. */
  /* "New password should be different from the old password." also matches the
     policy pattern below, and was rewritten into the rules message - false, and
     it lands right after a password change that timed out (#1512), when a retry
     with the same password is exactly how the user learns the change went
     through. Checked first, so it gets its own message. */
  if (/should be different from the old password/i.test(message)) {
    return L('AUTH_ERR_SAME_PASSWORD', 'That is already your current password.');
  }
  if (/password should (be|contain)/i.test(message)) {
    return L('AUTH_ERR_PASSWORD_POLICY', 'That password does not meet the requirements. Use at least 12 characters with an uppercase letter, a lowercase letter and a number.');
  }
  return message;
}

/** GoTrue's answer to a password sign-in on an account whose email link was never clicked. */
export function isEmailNotConfirmed(message: string): boolean {
  return /email not confirmed/i.test(message);
}
