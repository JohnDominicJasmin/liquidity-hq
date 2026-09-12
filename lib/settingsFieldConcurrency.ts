// #1202: the accept rule for per-field settings write arbitration between
// two devices - pure, environment-agnostic, extracted (#1223) so it can be
// tested directly rather than only proven by one live two-device pass.
// app/api/settings/route.ts is the only real caller.
//
// PM/DevOps's correction on #1202's original draft: "no known-as-of" must
// NOT mean "no conflict" - a client that has never synced a field, where
// the server already holds a confirmed value for it, is REJECTED, not
// accepted. Getting that backwards lets a stale, never-synced local edit
// stomp a newer confirmed write from another device, which is the exact
// bug this mechanism exists to close.
//
// Accepted iff `serverTs` is null/undefined (nobody has ever confirmed a
// value for this field - nothing to conflict with) OR `clientTs` is
// present AND is at or after `serverTs`.
export function shouldAcceptFieldWrite(
  serverTs: string | null | undefined,
  clientTs: string | null | undefined,
): boolean {
  const serverMs = serverTs ? Date.parse(serverTs) : NaN;
  const clientMs = clientTs ? Date.parse(clientTs) : NaN;
  return !Number.isFinite(serverMs) || (Number.isFinite(clientMs) && clientMs >= serverMs);
}
