// Supabase's raw ban error text ("User is banned", sometimes with a
// until-timestamp appended) leaks internal wording straight to the sign-in
// screen. Swap it for a message that tells the user what actually happened
// without echoing GoTrue's phrasing.
export function friendlyAuthError(message: string): string {
  if (/banned/i.test(message)) {
    return 'This account has been suspended. Contact support if you believe this is a mistake.';
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
    return 'That is already your current password.';
  }
  if (/password should (be|contain)/i.test(message)) {
    return 'That password does not meet the requirements. Use at least 12 characters with an uppercase letter, a lowercase letter and a number.';
  }
  return message;
}
