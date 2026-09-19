import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* #1167 (tracker #1173): app/alerts/page.tsx's mute-preferences load treated
 * "getAuthToken() returned nothing" as "signed out, nothing to load". Since #1165
 * bounded getAuthToken() with an 8s timeout, "nothing" ALSO means "signed in, but
 * the auth backend timed out" - two different facts that collapsed into one silent
 * empty-mute default. The fix gates on AuthProvider's own answer (`user`), so the
 * page can tell them apart, and surfaces the timeout as a labelled failure with a
 * retry instead of presenting the default as the user's real settings.
 *
 * THE CODE WAS FIXED AND THAT PATH WAS NEVER EXERCISED. Two halves, because
 * neither alone carries the claim and there is no DOM test library in the repo
 * (adding one is not QA's call):
 *
 *   1. BEHAVIOUR - getAuthToken() really does return `undefined` when getSession()
 *      never settles, and only after AUTH_TOKEN_TIMEOUT_MS. This is the premise:
 *      at THIS layer a timeout is indistinguishable from "signed out", which is
 *      exactly why the page must not decide from the token alone. Real code, real
 *      timer path, mock clock so it does not wait 8s.
 *   2. STRUCTURE - the page maps "signed in (`user`) + no token" to the labelled
 *      failure state and "no user" to the quiet signed-out path, and never the
 *      reverse. Read from source, with controls: the same predicates are run
 *      against mutated copies of the source and MUST fail, so a check that cannot
 *      fail is caught here.
 *
 * WHAT THIS DOES NOT PROVE: that the failure banner is RENDERED. That needs a
 * browser; qa/e2e/alerts-mute-load-timeout-state.spec.ts does it. */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://qa-stub.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'qa-stub-anon-key';
const { getSupabase, getAuthToken } = await import('../lib/supabase.ts');

const TIMEOUT_MS = 8000;

test('getAuthToken returns undefined only AFTER the timeout when getSession never settles (a timeout looks like "signed out" at this layer)', async (t) => {
  const sb = getSupabase()!;
  assert.ok(sb, 'getSupabase() returned null - the env stub did not take');
  t.after(() => { void sb.auth.stopAutoRefresh?.(); });
  const realGetSession = sb.auth.getSession.bind(sb.auth);
  t.after(() => { sb.auth.getSession = realGetSession; });

  // getSession that hangs, as supabase-js does when it tries to refresh an
  // expired token against a dead backend and neither resolves nor rejects.
  sb.auth.getSession = () => new Promise(() => {}) as ReturnType<typeof sb.auth.getSession>;

  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = false;
  const pending = getAuthToken().then(v => { settled = true; return v; });

  t.mock.timers.tick(TIMEOUT_MS - 1);
  await Promise.resolve();
  assert.equal(settled, false, 'getAuthToken settled BEFORE the timeout - the bound is shorter than documented, or it is not waiting on getSession');

  t.mock.timers.tick(1);
  assert.equal(await pending, undefined, 'a hung getSession must resolve to "no token" once the bound fires');
});

test('CONTROL: when getSession answers, getAuthToken returns the real token, and a genuinely signed-out session ALSO returns undefined', async (t) => {
  const sb = getSupabase()!;
  t.after(() => { void sb.auth.stopAutoRefresh?.(); });
  const realGetSession = sb.auth.getSession.bind(sb.auth);
  t.after(() => { sb.auth.getSession = realGetSession; });

  sb.auth.getSession = (async () => ({ data: { session: { access_token: 'tok-123' } }, error: null })) as unknown as typeof sb.auth.getSession;
  assert.equal(await getAuthToken(), 'tok-123');

  sb.auth.getSession = (async () => ({ data: { session: null }, error: null })) as unknown as typeof sb.auth.getSession;
  assert.equal(await getAuthToken(), undefined,
    'signed out and timed out are the same value at this layer - which is the whole reason the page has to ask AuthProvider (`user`) rather than infer from the token');
});

/* ── Structure of the page ─────────────────────────────────────────────────── */

const pageSrc = readFileSync(new URL('../app/alerts/page.tsx', import.meta.url), 'utf8');

/** Returns a list of what is wrong; empty means the mapping is right. */
function muteLoadProblems(src: string): string[] {
  const problems: string[] = [];
  const start = src.indexOf('const loadMutePrefs = useCallback(');
  if (start < 0) return ['loadMutePrefs not found'];
  const body = src.slice(start, src.indexOf('}, [user]);', start));

  const signedOut = body.match(/if\s*\(\s*!user\s*\)\s*\{([^}]*)\}/);
  if (!signedOut) problems.push('no `if (!user)` guard - signed-out is not decided from AuthProvider');
  else {
    if (/setMuteLoadFailed\(\s*true\s*\)/.test(signedOut[1])) problems.push('the SIGNED-OUT branch raises the failure state - a visitor would be told their load failed');
    if (!/setMutedLoaded\(\s*true\s*\)/.test(signedOut[1])) problems.push('the signed-out branch never releases the loading skeleton');
  }

  const guardAt = body.search(/if\s*\(\s*!user\s*\)/);
  const tokenAt = body.indexOf('getAuthToken()');
  if (guardAt < 0 || tokenAt < 0 || guardAt > tokenAt) problems.push('the `!user` decision must come BEFORE getAuthToken() is called');

  const noToken = body.match(/if\s*\(\s*!token\s*\)\s*\{([^}]*)\}/);
  if (!noToken) problems.push('no `!token` branch after getAuthToken()');
  else {
    if (!/setMuteLoadFailed\(\s*true\s*\)/.test(noToken[1])) problems.push('signed in + no token does NOT raise the failure state - the timeout is silently treated as "nothing configured"');
    if (!/setMutedLoaded\(\s*true\s*\)/.test(noToken[1])) problems.push('the timeout branch never releases the loading skeleton');
  }

  const banner = src.match(/\{muteLoadFailed && \(([\s\S]*?)\n\s{8}\)\}/);
  if (!banner) problems.push('no `muteLoadFailed &&` banner in the JSX');
  else {
    if (!banner[1].includes("t('ALERTS_MUTE_LOAD_FAILED')")) problems.push('the banner does not render ALERTS_MUTE_LOAD_FAILED');
    if (!/onClick=\{loadMutePrefs\}/.test(banner[1])) problems.push('the banner has no retry wired to loadMutePrefs');
  }
  return problems;
}

test('the alerts page maps signed-in-without-a-token to the labelled failure, and signed-out to the quiet path', () => {
  assert.deepEqual(muteLoadProblems(pageSrc), []);
});

test('CONTROL: the checks can fail - each mutation of the page is caught', () => {
  const mutations: Array<[string, string, string]> = [
    ['drop the !user guard', "if (!user) { setMutedLoaded(true); return; }", ''],
    ['timeout treated as signed-out (no failure state)', 'if (!token) { setMuteLoadFailed(true); setMutedLoaded(true); return; }', 'if (!token) { setMutedLoaded(true); return; }'],
    ['signed-out raises the failure', "if (!user) { setMutedLoaded(true); return; }", 'if (!user) { setMuteLoadFailed(true); setMutedLoaded(true); return; }'],
    ['banner loses its label', "t('ALERTS_MUTE_LOAD_FAILED')", "'failed'"],
    ['banner loses its retry', 'onClick={loadMutePrefs}', 'onClick={() => {}}'],
  ];
  for (const [name, from, to] of mutations) {
    assert.ok(pageSrc.includes(from), `mutation "${name}" does not apply - the page source changed, update this control`);
    const problems = muteLoadProblems(pageSrc.replace(from, to));
    assert.ok(problems.length > 0, `mutation "${name}" was NOT caught - the structural check cannot fail on it`);
  }
});

test('the failure labels exist in the shipped defaults (so a missing DB row cannot render a raw key)', () => {
  const defaults = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;
  for (const key of ['ALERTS_MUTE_LOAD_FAILED', 'ALERTS_MUTE_LOAD_RETRY']) {
    assert.ok(defaults[key] && defaults[key].length > 3, `${key} missing from labelDefaults.en.json`);
  }
});
