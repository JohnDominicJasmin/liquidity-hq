/* #2428: settings saves are serialised (C1), an edit made before the account is known is carried to the account (C2), and a patch the server refuses is not retried for ever (C4).
 * SettingsProvider is a React provider with effects and no DOM harness here, so the wiring is pinned by source anchors; the rendered proof of C1 and C4 is qa/e2e/settings-saves-one-at-a-time.spec.ts
 * (a deployed build, Free fixture B). C2 has no browser cell (it needs control of auth timing): its anchors are the only guard, stated plainly.
 * A control proves the matcher first: the provider's flush function and chain are found before anything is asserted about them. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = code(readFileSync(new URL('../components/SettingsProvider.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
const once = (needle: string, label: string) => assert.equal(src.split(needle).length - 1, 1, `${label}: anchor occurs ${src.split(needle).length - 1} time(s), expected exactly 1`);

test('C1. every save goes through ONE promise chain: a save starts only when the one before it has finished, and a failed save does not break the chain', () => {
  once('const flushNow = useCallback(async (partial: Partial<UserSettings>) => {', 'CONTROL: the real flush function');
  once('const flushChainRef = useRef<Promise<unknown>>(Promise.resolve());', 'the chain');
  once('const run = flushChainRef.current.then(() => flushNow(partial));', 'a save waits for the previous one');
  once('flushChainRef.current = run.catch(() => false);', 'a rejected save is swallowed on the chain so the next still runs');
  assert.equal(/flushNow\(/.test(src.replace('flushChainRef.current.then(() => flushNow(partial))', '')), false, 'something calls flushNow directly, outside the chain (two saves can overlap again)');
});
test('C4. a 4xx other than 401/408/429 is a PERMANENT refusal: no retry, the keys are released, the error shows, and "Try again" is not offered', () => {
  once('if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408 && res.status !== 429) permanentRefusal = true;', 'the refusal test (401, 408, 429 stay retryable)');
  once('isCancelled: () => permanentRefusal,', 'the retry loop stops at once on a refusal');
  const at = src.indexOf('if (permanentRefusal) {'); assert.ok(at > 0, 'CONTROL: the refusal block was not found');
  const block = src.slice(at, src.indexOf('return false;', at) + 14);
  for (const [needle, label] of [['for (const key of Object.keys(partial)) delete stuck[key];', 'the refused keys lose their unconfirmed protection'], ['lastFailedRef.current = null;', 'no Try again for a patch the server refuses every time'], ["setSaveStatus('error');", 'the existing error state still shows'], ['return false;', 'the save reports failure']] as const) assert.ok(block.includes(needle), `inside the refusal block: ${label}`);
});
test('C2. on sign-in the anon unconfirmed bucket is moved into the account\'s own set, emptied, and saved once the account row has been read', () => {
  once("const anon = loadUnconfirmed('anon');", 'the bucket is read');
  once('for (const [k, v] of Object.entries(anon)) if (!(k in own)) own[k] = v;', 'an existing account value is not overwritten by the anon one');
  once("saveUnconfirmed('anon', {});", 'the bucket is emptied');
  once('if (anonPatch && !error) void flushToDb(anonPatch as Partial<UserSettings>);', 'saved only after a successful read of the account row, through the chain');
});
