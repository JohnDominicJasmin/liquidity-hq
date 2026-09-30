/* #1342 sweep: while auth is still resolving, GrokChat must show a spinner and no-op on send - not the
 * "Sign in" branch, which bounced a signed-in user to the login modal if a send (or the auto-open
 * `grok-chat` event) landed in the token-resolve window (same class as #1335's runStrategy). Fix is in
 * components/GrokChat.tsx (a8f1af54).
 *
 * STRUCTURE ONLY, and that is deliberate, not an oversight: unlike TradeJournal's fix, this one has no
 * standalone function to call - `authLoading` is `AuthProvider`'s own React state
 * (components/AuthProvider.tsx), derived from a real `getSession()` resolve inside a provider, not an
 * exported function. There is no DOM test library in this repo to render the provider and drive its
 * timing (adding one is not QA's call - same limit __tests__/alertsMuteLoadTimeout.test.mts and
 * __tests__/tradeJournalLoadError.test.mts hit). What IS real and already proven elsewhere: that
 * `useAuth().loading` genuinely starts `true` and is genuinely unresolved during a real token fetch - that
 * is AuthProvider's whole documented contract (see its own comments on #377/#727), not something this fix
 * introduces or this file needs to re-derive. What this file checks is narrower and fully mechanical: GIVEN
 * that fact, does GrokChat's source route it to a spinner and a no-op, and never to the sign-in branch.
 *
 * WHAT THIS DOES NOT PROVE: that the spinner is RENDERED, or that a send during the resolve window looks
 * right on screen - that needs a browser. Not written here; the natural follow-up is a Playwright spec
 * alongside this file and __tests__/tradeJournalLoadError.test.mts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const source = stripComments(read('components/GrokChat.tsx'));

function anchorOnce(src: string, needle: string, label: string): number {
  const n = src.split(needle).length - 1;
  assert.equal(n, 1, `${label}: anchor occurs ${n} time(s), expected exactly 1 - re-read the current source`);
  return src.indexOf(needle);
}

/* ── the hook: authLoading exists and is read alongside user ── */

test('S1. GrokChat destructures both `user` and `loading` (as `authLoading`) from useAuth - not `user` alone', () => {
  anchorOnce(source, 'const { user, loading: authLoading } = useAuth();', 'the useAuth destructure');
});

/* ── sendMsg: the gate order ── */

test('S2. sendMsg checks authLoading BEFORE the !user check, and no-ops (returns) rather than opening the login modal', () => {
  const loadingAt = anchorOnce(source, 'if (authLoading) return;', 'the authLoading early return');
  const userCheckAt = anchorOnce(source, 'if (!user) {', 'the !user check');
  assert.ok(loadingAt < userCheckAt, 'the !user check runs before the authLoading check - a signed-in user whose token has not landed would still hit the login-modal branch');
  // Both must be inside the same function (sendMsg) and close enough together that nothing else
  // (a fetch, a state update) can run between "still resolving" and "decide": no unrelated statement
  // sits between the two checks.
  const between = source.slice(loadingAt + 'if (authLoading) return;'.length, userCheckAt).trim();
  assert.equal(between, '', `something runs between the two checks: "${between.slice(0, 120)}" - was code inserted in the resolve window?`);
});

test('S3. sendMsg does NOT open the login modal while authLoading is true: the early return happens before setOpen/setShowLoginModal', () => {
  const loadingAt = source.indexOf('if (authLoading) return;');
  const modalAt = source.indexOf('setShowLoginModal(true);');
  assert.ok(loadingAt > 0 && modalAt > loadingAt, 'setShowLoginModal(true) is not reachable only after the authLoading return - order changed');
});

test('S4. authLoading is a dependency of the sendMsg callback, so a stale closure cannot ignore a change from loading to resolved', () => {
  const depsLine = source.split('\n').find((l) => l.includes('geoEvents, user, authLoading, usage'));
  assert.ok(depsLine, 'sendMsg\'s useCallback dependency array does not list authLoading next to user');
});

/* ── the header render: spinner branch comes first, and unconditionally on authLoading ── */

test('S5. the header ternary checks authLoading FIRST, ahead of the `user ? ... : ...` branch, and renders a spinner, not the sign-in prompt', () => {
  const at = anchorOnce(source, '{authLoading ? (', 'the header ternary');
  const spinnerBlock = source.slice(at, source.indexOf(') : user ? (', at));
  assert.match(spinnerBlock, /className="login-spinner"/, 'the authLoading branch does not render the spinner');
  assert.doesNotMatch(spinnerBlock, /Sign in/i, 'the authLoading branch still mentions signing in');
  const userBranchAt = source.indexOf(') : user ? (', at);
  assert.ok(userBranchAt > at, 'the user branch is not the ternary\'s second arm - authLoading is no longer checked first');
});

test('S6. CONTROL: without the fix, the header would go straight to `user ? ... : <ask them to sign in>` - confirm that branch still exists as the fallback (so S5 is checking real branching, not a renamed dead end)', () => {
  const at = source.indexOf('{authLoading ? (');
  const tail = source.slice(at, at + 2000);
  assert.match(tail, /\) : user \? \(/, 'the user-branch fallback is missing entirely - the ternary structure changed shape');
});

