const fs = require('fs');
const BS = String.fromCharCode(92);
const f = '__tests__/cancelSubscription.test.mts';
let s = fs.readFileSync(f, 'utf8');
// the rebase rewrote the file with CRLF endings (autocrlf); the multi-line anchors below are LF
s = s.split(String.fromCharCode(13) + String.fromCharCode(10)).join(String.fromCharCode(10));
const rep = (from, to) => { const n = s.split(from).length - 1; if (n !== 1) throw new Error(`anchor x${n}: ${from.slice(0, 70)}`); s = s.replace(from, () => to); };

// ---- imports
rep("import { cancelSubscription, isLsApiConfigured } from '../lib/lemonsqueezyApi.ts';",
"import { readFileSync } from 'node:fs';\nimport { cancelSubscription, isLsApiConfigured } from '../lib/lemonsqueezyApi.ts';\nimport { subscriptionPanelView, futureDateOrNull, type SubPanelInput } from '../lib/subscriptionPanel.ts';");

// ---- header note about the revision
rep(" * Every expectation is written from the design in the PR",
" * REVISED for fcdc62ce, the fixes for the review of e9216cd1: `reason` no longer carries the upstream body (it moved\n * to `bodyRedacted`, logged on success too), the route refuses a non-Pro row (`not_pro`) as GET's canCancel does, the\n * outbound call has a 10 s timeout, and the panel's state-to-text choice is the pure `subscriptionPanelView`. Each\n * test that changed did so because the DESIGN changed, and the change is listed in the commit.\n *\n * Every expectation is written from the design in the PR");

// ---- L1 / L2
rep("assert.deepEqual([r.ok, r.reason, r.status], [false, 'ls_api_key_unset', 0]);", "assert.deepEqual([r.ok, r.reason, r.status, r.bodyRedacted], [false, 'ls_api_key_unset', 0, '']);");
rep("assert.deepEqual([r.ok, r.reason], [false, 'no_subscription_id']);", "assert.deepEqual([r.ok, r.reason, r.bodyRedacted], [false, 'no_subscription_id', '']);");

// ---- L5: the body is kept for the capture
rep("assert.deepEqual([r.ok, r.reason, r.status, r.lsStatus, r.endsAt], [true, 'cancelled', 200, 'cancelled', '2098-10-08T05:26:55.000000Z']);",
"assert.deepEqual([r.ok, r.reason, r.status, r.lsStatus, r.endsAt], [true, 'cancelled', 200, 'cancelled', '2098-10-08T05:26:55.000000Z']);\n  assert.match(r.bodyRedacted, /cancelled/, 'a success must carry its (redacted) body for the capture log');");

// ---- L9: reason is the status only, the body is separate
rep("    assert.match(r.reason, new RegExp(`^ls_status_${status}:`));",
"    assert.equal(r.reason, `ls_status_${status}`, 'the upstream body must not ride in `reason`');\n    assert.match(r.bodyRedacted, /stand-in refusal/, 'the body is kept, redacted, in bodyRedacted');");

// ---- L11 / L12 / L13 look at bodyRedacted now
rep("test('L11. redaction: a Bearer token, a JWT and an api_key echoed in an error body never reach `reason`', async () => {",
    "test('L11. redaction: a Bearer token, a JWT and an api_key echoed in an error body reach neither `reason` nor `bodyRedacted`', async () => {");
rep("  for (const s of secrets) assert.equal(r.reason.includes(s), false, `\"${s.slice(0, 12)}...\" leaked into the reason`);\n  assert.match(r.reason, /" + BS + "[redacted/);",
    "  for (const s of secrets) {\n    assert.equal(r.reason.includes(s), false, `\"${s.slice(0, 12)}...\" leaked into the reason`);\n    assert.equal(r.bodyRedacted.includes(s), false, `\"${s.slice(0, 12)}...\" leaked into bodyRedacted`);\n  }\n  assert.match(r.bodyRedacted, /" + BS + "[redacted/);");
rep("test('L12. the configured key, echoed back by a server, is not in `reason` (JWT-shaped, as Lemon Squeezy keys are)', async () => {",
    "test('L12. the configured key, echoed back by a server, is in neither `reason` nor `bodyRedacted` (JWT-shaped, as Lemon Squeezy keys are)', async () => {");
rep("  assert.equal(r.reason.includes(LS_KEY), false);\n  assert.equal(r.reason.includes('stand-in-payload'), false);",
    "  for (const field of [r.reason, r.bodyRedacted]) {\n    assert.equal(field.includes(LS_KEY), false);\n    assert.equal(field.includes('stand-in-payload'), false);\n  }");
rep("test('L13. `reason` is length-capped: a huge error body cannot flood a log', async () => {", "test('L13. the captured body is length-capped: a huge error body cannot flood a log', async () => {");
rep("  assert.ok(r.reason.length <= 'ls_status_500:'.length + 600, `reason is ${r.reason.length} chars`);",
    "  assert.ok(r.bodyRedacted.length <= 600, `bodyRedacted is ${r.bodyRedacted.length} chars`);\n  assert.ok(r.reason.length < 40, 'reason must stay a short machine string');");

// ---- P5: a missing row is now `not_pro`
rep("test('P5. a user with no subscription row: \"no_subscription\", nothing sent', async () => {\n  reset();\n  const r = await cancelRoute(TOKEN_A);\n  assert.deepEqual([r.status, r.body], [200, { ok: false, reason: 'no_subscription' }]);",
    "test('P5. a user with no subscription row: \"not_pro\", nothing sent', async () => {\n  reset();\n  const r = await cancelRoute(TOKEN_A);\n  assert.deepEqual([r.status, r.body], [200, { ok: false, reason: 'not_pro' }]);");

// ---- P8: the capture log carries the redacted body
rep("    assert.match(logged, new RegExp(`LS cancel failed for user=${UID_A} - reason=ls_status_${status}`));",
    "    assert.match(logged, new RegExp(`LS cancel failed for user=${UID_A} - reason=ls_status_${status} http=${status} body=`));");

// ---- the stand-in can now hang (timeout test) and remembers the abort signal it was given
rep("  lsThrows: false,\n  ls: lsSuccess()", "  lsThrows: false,\n  lsHangs: false,\n  lastSignal: undefined as AbortSignal | undefined,\n  ls: lsSuccess()");
rep("  world.lsThrows = false;\n", "  world.lsThrows = false;\n  world.lsHangs = false;\n  world.lastSignal = undefined;\n");
rep("    if (world.lsThrows) throw new TypeError('fetch failed (stand-in)');\n",
    "    if (world.lsThrows) throw new TypeError('fetch failed (stand-in)');\n    world.lastSignal = (init as { signal?: AbortSignal }).signal;\n    if (world.lsHangs) {\n      return new Promise<Response>((_, reject) => {\n        world.lastSignal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')));\n      });\n    }\n");
rep("globalThis.fetch = (async (input: unknown, init: { method?: string; headers?: HeadersInit; body?: unknown } = {}) => {",
    "globalThis.fetch = (async (input: unknown, init: { method?: string; headers?: HeadersInit; body?: unknown; signal?: AbortSignal } = {}) => {");

// ---- D1: the todo becomes real tests, plus the button-vs-guard property
const d1Start = s.indexOf('/* ── FINDING (#1435 review): the comment says the button and the route');
if (d1Start < 0) throw new Error('D1 block not found');
s = s.slice(0, d1Start) + fs.readFileSync(process.argv[2], 'utf8');
fs.writeFileSync(f, s);
console.log('edited');
