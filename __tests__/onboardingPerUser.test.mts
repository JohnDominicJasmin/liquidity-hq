/* #2431: the onboarding state is per user. OnboardingProvider is a React provider (no DOM harness here), so the wiring is pinned by source anchors; the rendered proof (no wizard flash after signing in without a
 * reload; user B does not inherit user A's flags) is a browser run on a deployed build.
 *   O1  EMPTY_ONBOARDING is all-false and is the initial state AND what every user change resets to, BEFORE the signed-out check
 *   O2  loaded goes false until THIS user's row has been read (so the wizard cannot flash on a stale false profileComplete); a signed-out visitor is loaded at once
 *   O3  the effect is keyed on the user ID, not the user object: a token refresh (a new object for the same user) must not reset the state
 *   O4  FINDING (todo): loadError is not cleared on the signed-out path, so a failed read for user A can leave an error showing for the signed-out visitor / next screen */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../components/OnboardingProvider.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const once = (needle: string, label: string) => assert.equal(src.split(needle).length - 1, 1, `${label}: anchor occurs ${src.split(needle).length - 1} time(s), expected exactly 1`);

test('O1. EMPTY_ONBOARDING is all false, is the initial state, and is what the effect resets to before it looks at the user', () => {
  const m = /const EMPTY_ONBOARDING: OnboardingState = \{([^}]*)\};/.exec(src); assert.ok(m, 'CONTROL: EMPTY_ONBOARDING not found');
  assert.equal(/true/.test(m![1]), false, 'the empty state has a true flag: a new user would inherit it');
  assert.equal((m![1].match(/: false/g) ?? []).length, 6, 'the empty state does not cover all six flags');
  once('useState<OnboardingState>(EMPTY_ONBOARDING);', 'the initial state');
  assert.ok(src.indexOf('setState(EMPTY_ONBOARDING);') > 0 && src.indexOf('setState(EMPTY_ONBOARDING);') < src.indexOf('if (!user) { setLoaded(true); return; }'), 'the reset must run before the signed-out check (user B must not see user A\'s flags)');
});
test('O2. loaded is false until this user\'s row is read; a signed-out visitor is loaded at once', () => {
  once('if (!user) { setLoaded(true); return; }', 'signed out: nothing to wait for');
  assert.ok(src.indexOf('setLoaded(false);') > src.indexOf('if (!user) { setLoaded(true); return; }') && src.indexOf('setLoaded(false);') < src.indexOf('.from(T.user_onboarding)'), 'loaded is not set false before THIS user\'s read starts (the wizard flashes on a stale false profileComplete)');
});
test('O3. the effect is keyed on user?.id and authLoading, not the user object (a token refresh must not reset)', () => {
  once('}, [user?.id, authLoading]);', 'the dependency list');
  assert.equal(/\[user, authLoading\]/.test(src), false, 'the effect depends on the whole user object again');
});
test('O4. a signed-out visitor / a new user starts with no load error from the previous user\'s failed read', { todo: true }, () => {
  const at = src.indexOf('if (!user) { setLoaded(true); return; }');
  const before = src.slice(src.indexOf('setState(EMPTY_ONBOARDING);'), at + 40);
  assert.ok(before.includes('setLoadError(false)'), 'loadError survives a user change on the signed-out path');
});
