/* QA: PR #2660, a refused settings save puts the server's value back (on screen and in this device's cache) instead of leaving the refused one.
 * components/SettingsProvider.tsx is a React provider with no DOM harness here (see settingsProviderSaveRules.test.mts), so the refusal branch is EXTRACTED from the source,
 * type-stripped and RUN against stand-ins for setSettings / saveLocalSettings; the rest is anchored in the source with a control first.
 *   S1  CONTROL: the refusal block, the server-row ref and its writers are found before anything is asserted about them
 *   S2  which statuses are a refusal: 4xx except 401/408/429 (extracted condition, table-tested); 5xx, 429, 401, 408, 2xx and 3xx stay retryable
 *   S3  the refusal block: refused keys go back to the confirmed row, on screen AND in the cache (signed-in flag), other keys are untouched, the error status is set, no "Try again"
 *   S4  a retryable failure (network, 5xx, 429, a 200 without accepted/rejected) still ends in the error status with "Try again" and the value kept protected: never "saved"
 *   S5  RED BY DESIGN: the confirmed row must advance after a SUCCESSFUL save (the ref is only written at sign-in / refresh today), or a later refusal reverts to a stale value
 *   S6  RED BY DESIGN: the revert must not overwrite a NEWER edit of the same key made while the refused save was in flight (the success branch has this guard, the refusal branch has not)
 * WHAT THIS CANNOT PROVE: the rendered behaviour (the stubbed-400 reload in a browser) and the toast text; no browser here. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const stripTypeScriptTypes = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

const raw = readFileSync(new URL('../components/SettingsProvider.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = code(raw);
const count = (s: string, needle: string) => s.split(needle).length - 1;

const REFUSAL_AT = src.indexOf('if (permanentRefusal) {');
const REFUSAL = src.slice(REFUSAL_AT, src.indexOf('return false;', REFUSAL_AT) + 'return false;'.length);
const SUCCESS = src.slice(src.indexOf('if (!result.failed) {'), src.indexOf("setSaveStatus(result.rejected.length > 0 ? 'conflict' : 'saved');"));

test('S1. CONTROL: the refusal block, the server-row ref and its writers are found', () => {
  assert.ok(REFUSAL_AT > 0, 'refusal block not found');
  assert.ok(REFUSAL.includes("setSaveStatus('error')"), 'the refusal block no longer reaches the error status');
  assert.ok(SUCCESS.length > 200, 'success branch not found');
  assert.equal(count(src, 'const serverSettingsRef = useRef<UserSettings | null>(null);'), 1, 'serverSettingsRef declared once');
  assert.ok(count(src, 'serverSettingsRef.current = dbSettings;') === 1, 'applyDbSettings writes the ref');
  const ad = src.indexOf('const applyDbSettings = useCallback(');
  assert.ok(ad > 0 && src.indexOf('serverSettingsRef.current = dbSettings;') > ad, 'the sign-in / refresh writer sits inside applyDbSettings');
  assert.equal(count(src, 'applyDbSettings(user.id, s);'), 2, 'applyDbSettings is called by the sign-in read AND refresh()');
});

test('S2. which statuses are a permanent refusal (the extracted condition, table-tested)', () => {
  const cond = /(res\.status >= 400 && .*?!== 429)\) permanentRefusal = true/.exec(src.replace(/\n\s+/g, ' '))![1];
  const isRefusal = (status: number) => new Function('res', `return ${cond};`)({ status }) as boolean;
  for (const s of [400, 402, 403, 404, 405, 409, 410, 413, 415, 422, 451, 499]) assert.equal(isRefusal(s), true, `${s} should be a refusal`);
  for (const s of [200, 201, 204, 301, 302, 304, 401, 408, 429, 500, 502, 503, 504]) assert.equal(isRefusal(s), false, `${s} must stay retryable / non-refusal`);
});

/* run the refusal revert exactly as written: from `const confirmed` to the line before `lastFailedRef.current = null;` */
function revert(confirmedRow: Record<string, unknown> | null, partial: Record<string, unknown>, prev: Record<string, unknown>) {
  const a = REFUSAL.indexOf('const confirmed = serverSettingsRef.current');
  const b = REFUSAL.indexOf('lastFailedRef.current = null;', a);
  assert.ok(a > 0 && b > a, 'the revert statements were not found in the refusal block');
  const snippet = REFUSAL.slice(a, b);
  const fn = new Function('serverSettingsRef', 'partial', 'setSettings', 'saveLocalSettings', stripTypeScriptTypes(snippet));
  const cache: Array<{ s: Record<string, unknown>; signedIn: unknown }> = []; let updater: ((p: Record<string, unknown>) => Record<string, unknown>) | null = null; let screen: Record<string, unknown> = prev;
  fn({ current: confirmedRow }, partial, (u: typeof updater) => { updater = u; screen = u!(prev); }, (s: Record<string, unknown>, signedIn: unknown) => cache.push({ s, signedIn }));
  return { screen, cache, called: updater !== null };
}

test('S3. the refusal block puts the confirmed values back on screen and in the cache, and nothing else', () => {
  const confirmed = { timezone: 'UTC', daily_summary_hour: 8, theme: 'dark', arena_strategy: 'ema' };
  const prev = { timezone: 'Not/AZone', daily_summary_hour: 8, theme: 'light', arena_strategy: 'ema' };
  const r = revert(confirmed, { timezone: 'Not/AZone' }, prev);
  assert.equal(r.screen.timezone, 'UTC', 'the refused value must be replaced by the server value');
  assert.equal(r.screen.theme, 'light', 'a key that was not refused must not be touched');
  assert.equal(r.screen.daily_summary_hour, 8);
  assert.equal(r.cache.length, 1, 'the cache is written once');
  assert.equal((r.cache[0].s as Record<string, unknown>).timezone, 'UTC', 'the cached value is the server one, not the refused one');
  assert.equal(r.cache[0].signedIn, true, 'written as a signed-in cache (the arena strategy key is kept)');
  /* several keys in one refused patch */
  const r2 = revert(confirmed, { timezone: 'x', daily_summary_hour: 99 }, { ...prev, timezone: 'x', daily_summary_hour: 99 });
  assert.equal(r2.screen.timezone, 'UTC'); assert.equal(r2.screen.daily_summary_hour, 8);
  /* the state object is replaced, not mutated in place (React would not re-render a mutated object) */
  assert.notEqual(r.screen, prev, 'the updater returned the same object it was given');
  assert.equal(prev.timezone, 'Not/AZone', 'the previous state object was mutated');
  /* no confirmed row yet (never read): nothing is reverted and nothing throws; the error status below still shows */
  const none = revert(null, { timezone: 'Not/AZone' }, prev);
  assert.equal(none.called, false);
  /* the rest of the block: error status, no Try again, the 3 s settle */
  assert.ok(REFUSAL.indexOf("setSaveStatus('error')") > REFUSAL.indexOf('const confirmed = serverSettingsRef.current'), 'the error status comes after the revert');
  assert.match(REFUSAL, /lastFailedRef\.current = null;[\s\S]*setSaveStatus\('error'\);[\s\S]*settleToIdle\(3000\);[\s\S]*return false;/);
  assert.match(REFUSAL, /for \(const key of Object\.keys\(partial\)\) delete stuck\[key\];/, 'the refused keys still lose their unconfirmed protection');
});

test('S4. a retryable failure still ends in the error status with Try again (never "saved"), and "saved" needs an answer with both lists', () => {
  assert.match(src, /lastFailedRef\.current = partial;\s*setSaveStatus\('error'\);\s*settleToIdle\(3000\);\s*return false;\s*\}, \[user\]\);/, 'the all-attempts-failed tail must keep the patch for Try again and show the error');
  assert.match(src, /if \(!Array\.isArray\(body\.accepted\) \|\| !Array\.isArray\(body\.rejected\)\) return \{ failed: true \};/, 'a 200 without accepted/rejected must count as a failed attempt');
  assert.equal(count(src, "'saved'"), 2, '"saved" is only reachable in the status type and in the success ternary');
  assert.ok(SUCCESS.length > 0 && !/setSaveStatus\('saved'\)/.test(REFUSAL), 'a refusal must never set the saved status');
  assert.match(src, /const \{ result \} = await retryWithBackoff\(attemptSave, \{\s*maxAttempts: SETTINGS_SAVE_MAX_ATTEMPTS,\s*backoffMs: SETTINGS_SAVE_RETRY_BACKOFF_MS,\s*isCancelled: \(\) => permanentRefusal,/);
});

test('S5. the server-confirmed row advances after a successful save, so a later refusal reverts to what the server holds NOW', () => {
  /* Scenario: sign-in reads timezone UTC; the user saves Asia/Tokyo (200, server holds Tokyo); then saves a bad value (400). serverSettingsRef still holds the sign-in row
     (UTC), so the revert puts UTC on screen and in the cache while the server holds Tokyo: a wrong value shown until the next read, and the cache is poisoned with it. */
  assert.ok(/serverSettingsRef\.current/.test(SUCCESS), 'the success branch never updates serverSettingsRef: after a saved change, a refused one reverts to the OLD sign-in value instead of the saved one');
});

test('S6. the revert does not overwrite a newer edit of the same key made while the refused save was in flight', () => {
  /* update() sets the screen value at once; saves run one at a time, so an edit made while the refused save was sending is queued behind it. The success branch guards this
     ("only if the stored value still equals what THIS attempt sent"); the refusal revert must too, or the screen and the cache show the server value while the newer edit is
     then saved: the server ends up holding the newer value and the screen does not. */
  const confirmed = { timezone: 'UTC' };
  const r = revert(confirmed, { timezone: 'Bad/Zone' }, { timezone: 'Europe/Paris' });   // the user has since picked Europe/Paris
  assert.equal(r.screen.timezone, 'Europe/Paris', 'a newer edit was overwritten by the revert of an older refused one');
});
