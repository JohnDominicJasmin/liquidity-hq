// Supabase's raw ban error text ("User is banned", sometimes with a
// until-timestamp appended) leaks internal wording straight to the sign-in
// screen. Swap it for a message that tells the user what actually happened
// without echoing GoTrue's phrasing.
export function friendlyAuthError(message: string): string {
  if (/banned/i.test(message)) {
    return 'This account has been suspended. Contact support if you believe this is a mistake.';
  }
  return message;
}
